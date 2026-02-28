import { NextResponse } from "next/server"
import { startOfWeek, endOfWeek } from "date-fns"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { getStravaAccessToken } from "@/lib/strava"

// ---------------------------------------------------------------------------
// Strava type definitions
// ---------------------------------------------------------------------------

interface StravaActivity {
  id: number
  name: string
  type: string
  sport_type: string
  workout_type?: number // 0=default, 1=race, 2=long run, 3=workout
  start_date: string
  distance: number // metres
  moving_time: number // seconds
  average_speed: number // m/s
  total_elevation_gain: number // metres
  average_heartrate?: number
  calories?: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strava sport_type values that are running activities. */
const RUNNING_SPORT_TYPES = new Set(["Run", "TrailRun", "VirtualRun", "Treadmill", "Walk"])

/**
 * Maps a Strava sport_type / workout_type to our constrained ActivityType.
 */
function mapActivityType(sport_type: string, workout_type?: number): string {
  if (sport_type === "TrailRun") return "Trail Run"
  if (sport_type === "Walk") return "Walk"
  if (sport_type === "Run" && workout_type === 1) return "Race"
  return "Run"
}

/**
 * Converts Strava average_speed (m/s) to pace in min/km.
 * Returns null when speed is zero or missing (e.g. manual entries).
 */
function speedToPace(averageSpeedMs: number): number | null {
  if (averageSpeedMs <= 0) return null
  return 1000 / averageSpeedMs / 60
}

/**
 * Fetches activities from Strava, paginating until an empty page.
 *
 * @param accessToken  Strava access token
 * @param after        Optional Unix timestamp — only fetch activities after
 *                     this point in time (used for incremental syncs).
 *                     Omit on the first / full sync.
 */
async function fetchStravaActivities(
  accessToken: string,
  after?: number,
): Promise<StravaActivity[]> {
  const allActivities: StravaActivity[] = []
  let page = 1
  const perPage = 100

  while (true) {
    const url = new URL("https://www.strava.com/api/v3/athlete/activities")
    url.searchParams.set("per_page", String(perPage))
    url.searchParams.set("page", String(page))
    if (after !== undefined) url.searchParams.set("after", String(after))

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!res.ok) {
      const body = await res.text()
      console.error(`Strava activities fetch failed (${res.status}):`, body)
      throw new Error(`Strava activities fetch failed: ${res.status}`)
    }

    const batch = (await res.json()) as StravaActivity[]
    if (batch.length === 0) break

    allActivities.push(...batch)
    if (batch.length < perPage) break
    page++
  }

  return allActivities
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function POST() {
  // 1. Authenticate the calling user
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = user.id
  const service = createServiceClient()

  // 2. Read previous sync time BEFORE overwriting sync_status.
  //    We use last_sync_at as the `after` cursor for incremental fetches.
  //    If null (never synced), we perform a full fetch from Strava.
  const { data: prevSync } = await service
    .from("sync_status")
    .select("last_sync_at, state, updated_at")
    .eq("user_id", userId)
    .maybeSingle()

  // Rate limit: prevent sync within 30 seconds of last sync
  if (prevSync?.last_sync_at) {
    const lastSync = new Date(prevSync.last_sync_at).getTime()
    if (Date.now() - lastSync < 30_000) {
      return NextResponse.json(
        { error: "Please wait at least 30 seconds before syncing again" },
        { status: 429 },
      )
    }
  }

  // Prevent concurrent syncs (allow recovery if stuck > 2 minutes)
  if (prevSync?.state === "syncing") {
    const stuckThreshold = 2 * 60 * 1000
    if (prevSync.updated_at && Date.now() - new Date(prevSync.updated_at).getTime() < stuckThreshold) {
      return NextResponse.json(
        { error: "A sync is already in progress" },
        { status: 409 },
      )
    }
  }

  const lastSyncAt: string | null = prevSync?.last_sync_at ?? null

  // 3. Mark sync as in-progress
  await service.from("sync_status").upsert(
    { user_id: userId, state: "syncing", error_message: null, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  )

  try {
    // 4–5. Load Strava token (refreshes automatically if expired)
    const accessToken = await getStravaAccessToken(userId)

    // 6. Fetch activities from Strava.
    //    - First sync (lastSyncAt = null): fetch all activities.
    //    - Subsequent syncs: only fetch activities newer than last_sync_at,
    //      saving Strava API quota (100 req/15 min, 1000/day).
    const afterTimestamp = lastSyncAt
      ? Math.floor(new Date(lastSyncAt).getTime() / 1000)
      : undefined

    const stravaActivities = await fetchStravaActivities(accessToken, afterTimestamp)

    // 7. Filter to running sport types and upsert into activities
    const runningActivities = stravaActivities.filter((a) =>
      RUNNING_SPORT_TYPES.has(a.sport_type),
    )

    const rows = runningActivities.map((a) => ({
      user_id: userId,
      strava_id: a.id,
      type: mapActivityType(a.sport_type, a.workout_type),
      name: a.name,
      date: a.start_date,
      distance_km: a.distance / 1000,
      duration_seconds: Math.round(a.moving_time),
      pace_min_per_km: speedToPace(a.average_speed),
      elevation_gain_m: a.total_elevation_gain,
      avg_heart_rate: a.average_heartrate != null ? Math.round(a.average_heartrate) : null,
      calories: a.calories != null ? Math.round(a.calories) : null,
    }))

    if (rows.length > 0) {
      const { error: upsertError } = await service
        .from("activities")
        .upsert(rows, { onConflict: "strava_id" })

      if (upsertError) throw upsertError
    }

    // 8. Recalculate current_distance_km for every active goal.
    //    Multiple goals can now be active simultaneously, so we iterate all.
    //    Each goal's distance is scoped to its own [start_date, target_date]
    //    window so activities before a goal was set up don't inflate the count.
    const { data: activeGoals } = await service
      .from("goals")
      .select("id, start_date, target_date")
      .eq("user_id", userId)
      .eq("is_active", true)

    for (const goal of activeGoals ?? []) {
      let query = service
        .from("activities")
        .select("distance_km")
        .eq("user_id", userId)
        .lte("date", goal.target_date)

      if (goal.start_date) {
        query = query.gte("date", goal.start_date)
      }

      const { data: distRows } = await query
      const totalKm = (distRows ?? []).reduce((sum, r) => sum + Number(r.distance_km), 0)

      await service
        .from("goals")
        .update({ current_distance_km: totalKm })
        .eq("id", goal.id)
    }

    // 9. Recalculate weekly goals progress for the current week.
    //    Includes both one-off goals for this specific week AND recurring goals
    //    (which can have any week_start but should appear in every week).
    const now = new Date()
    const weekStart = startOfWeek(now, { weekStartsOn: 1 })
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 })
    const weekStartStr = weekStart.toISOString().split("T")[0]

    const { data: weeklyGoals } = await service
      .from("weekly_goals")
      .select("id, metric, is_recurring, session_min_duration_minutes, session_min_distance_km")
      .eq("user_id", userId)
      .or(`week_start.eq.${weekStartStr},is_recurring.eq.true`)

    if (weeklyGoals && weeklyGoals.length > 0) {
      // Fetch this week's activities once and reuse for all goals
      const { data: weekActivities } = await service
        .from("activities")
        .select("distance_km, duration_seconds, elevation_gain_m")
        .eq("user_id", userId)
        .gte("date", weekStart.toISOString())
        .lte("date", weekEnd.toISOString())

      const acts = weekActivities ?? []

      for (const wg of weeklyGoals) {
        let current = 0

        if (wg.metric === "sessions") {
          // Apply session thresholds when counting qualifying sessions
          current = acts.filter((a) => {
            if (wg.session_min_duration_minutes && a.duration_seconds / 60 < wg.session_min_duration_minutes) return false
            if (wg.session_min_distance_km && Number(a.distance_km) < Number(wg.session_min_distance_km)) return false
            return true
          }).length
        } else if (wg.metric === "distance_km") {
          current = acts.reduce((sum: number, a) => sum + Number(a.distance_km), 0)
        } else if (wg.metric === "duration_minutes") {
          current = acts.reduce((sum: number, a) => sum + a.duration_seconds / 60, 0)
        } else if (wg.metric === "elevation_m") {
          current = acts.reduce((sum: number, a) => sum + Number(a.elevation_gain_m ?? 0), 0)
        }

        await service.from("weekly_goals").update({ current }).eq("id", wg.id)
      }
    }

    // 10. Mark sync as success
    await service.from("sync_status").upsert(
      {
        user_id: userId,
        state: "success",
        last_sync_at: new Date().toISOString(),
        error_message: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )

    return NextResponse.json({
      ok: true,
      synced: rows.length,
      skipped: stravaActivities.length - runningActivities.length,
      incremental: afterTimestamp !== undefined,
    })
  } catch (err: unknown) {
    console.error("Strava sync error:", err)

    const message =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : "Unknown sync error"

    await service.from("sync_status").upsert(
      {
        user_id: userId,
        state: "error",
        error_message: message,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
