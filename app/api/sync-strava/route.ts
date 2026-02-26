import { NextResponse } from "next/server"
import { startOfWeek, endOfWeek, parseISO, isWithinInterval } from "date-fns"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"

// ---------------------------------------------------------------------------
// Strava type definitions
// ---------------------------------------------------------------------------

interface StravaTokenRow {
  user_id: string
  athlete_id: number
  access_token: string
  refresh_token: string
  expires_at: string
}

interface StravaRefreshResponse {
  access_token: string
  refresh_token: string
  expires_at: number
}

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
const RUNNING_SPORT_TYPES = new Set(["Run", "TrailRun", "VirtualRun", "Treadmill"])

/**
 * Maps a Strava sport_type / workout_type to our constrained ActivityType.
 */
function mapActivityType(sport_type: string, workout_type?: number): string {
  if (sport_type === "TrailRun") return "Trail Run"
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
 * Refreshes a Strava access token and returns the new token data.
 */
async function refreshStravaToken(refreshToken: string): Promise<StravaRefreshResponse> {
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  })

  if (!res.ok) {
    throw new Error(`Strava token refresh failed: ${res.status} ${await res.text()}`)
  }

  return res.json() as Promise<StravaRefreshResponse>
}

/**
 * Fetches all activities from Strava (paginates until empty page).
 */
async function fetchStravaActivities(accessToken: string): Promise<StravaActivity[]> {
  const allActivities: StravaActivity[] = []
  let page = 1
  const perPage = 100

  while (true) {
    const res = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?per_page=${perPage}&page=${page}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )

    if (!res.ok) {
      throw new Error(`Strava activities fetch failed: ${res.status} ${await res.text()}`)
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

  // 2. Mark sync as in-progress
  await service.from("sync_status").upsert(
    { user_id: userId, state: "syncing", error_message: null, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  )

  try {
    // 3. Load Strava tokens (service client bypasses RLS on strava_tokens)
    const { data: tokenRow, error: tokenError } = await service
      .from("strava_tokens")
      .select("user_id, athlete_id, access_token, refresh_token, expires_at")
      .eq("user_id", userId)
      .single<StravaTokenRow>()

    if (tokenError || !tokenRow) {
      throw new Error("No Strava account connected. Please connect Strava first.")
    }

    // 4. Refresh token if expired (with 60-second buffer)
    let accessToken = tokenRow.access_token
    const expiresAt = new Date(tokenRow.expires_at)
    const nowPlusBuffer = new Date(Date.now() + 60_000)

    if (expiresAt <= nowPlusBuffer) {
      const refreshed = await refreshStravaToken(tokenRow.refresh_token)
      accessToken = refreshed.access_token

      await service.from("strava_tokens").update({
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        expires_at: new Date(refreshed.expires_at * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("user_id", userId)
    }

    // 5. Fetch activities from Strava
    const stravaActivities = await fetchStravaActivities(accessToken)

    // 6. Map and upsert activities — only running sport types
    const runningActivities = stravaActivities.filter((a) =>
      RUNNING_SPORT_TYPES.has(a.sport_type)
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

    // 7. Recalculate active goal's current_distance_km
    const { data: activeGoal } = await service
      .from("goals")
      .select("id")
      .eq("user_id", userId)
      .eq("is_active", true)
      .single()

    if (activeGoal) {
      const { data: distSum } = await service
        .from("activities")
        .select("distance_km")
        .eq("user_id", userId)

      const totalKm = (distSum ?? []).reduce((sum, r) => sum + Number(r.distance_km), 0)

      await service
        .from("goals")
        .update({ current_distance_km: totalKm })
        .eq("id", activeGoal.id)
    }

    // 8. Recalculate weekly goals for the current week
    const now = new Date()
    const weekStart = startOfWeek(now, { weekStartsOn: 1 })
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 })
    const weekStartStr = weekStart.toISOString().split("T")[0]

    const { data: weeklyGoals } = await service
      .from("weekly_goals")
      .select("id, metric, week_start")
      .eq("user_id", userId)
      .eq("week_start", weekStartStr)

    if (weeklyGoals && weeklyGoals.length > 0) {
      // Pull this week's activities once
      const { data: weekActivities } = await service
        .from("activities")
        .select("distance_km, duration_seconds, elevation_gain_m, date")
        .eq("user_id", userId)
        .gte("date", weekStart.toISOString())
        .lte("date", weekEnd.toISOString())

      const acts = weekActivities ?? []

      for (const wg of weeklyGoals) {
        let current = 0

        switch (wg.metric) {
          case "distance_km":
            current = acts.reduce((sum, a) => sum + Number(a.distance_km), 0)
            break
          case "sessions":
            current = acts.length
            break
          case "duration_minutes":
            current = acts.reduce((sum, a) => sum + a.duration_seconds / 60, 0)
            break
          case "elevation_m":
            current = acts.reduce((sum, a) => sum + Number(a.elevation_gain_m ?? 0), 0)
            break
        }

        await service
          .from("weekly_goals")
          .update({ current })
          .eq("id", wg.id)
      }
    }

    // 9. Mark sync as success
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
    })
  } catch (err: unknown) {
    console.error("[v0] Strava sync error:", err)

    let message = "Unknown sync error"
    if (err instanceof Error) {
      message = err.message
    } else if (typeof err === "object" && err !== null && "message" in err) {
      message = String((err as { message: unknown }).message)
    } else if (typeof err === "string") {
      message = err
    } else {
      message = JSON.stringify(err)
    }

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
