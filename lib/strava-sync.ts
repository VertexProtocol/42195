import { createServiceClient } from "@/lib/supabase/service"
import {
  withStravaRetry,
  stravaApiFetch,
  StravaRateLimitError,
  StravaUnauthorizedError,
} from "@/lib/strava"

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
  max_heartrate?: number
  average_cadence?: number
  calories?: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps a Strava sport_type to a human-readable display name.
 * Keeps known running types as before; everything else gets a
 * readable label derived from the PascalCase sport_type.
 */
const SPORT_TYPE_LABELS: Record<string, string> = {
  Run: "Run",
  TrailRun: "Trail Run",
  VirtualRun: "Virtual Run",
  Treadmill: "Treadmill",
  Walk: "Walk",
  Ride: "Ride",
  VirtualRide: "Virtual Ride",
  EBikeRide: "E-Bike Ride",
  GravelRide: "Gravel Ride",
  MountainBikeRide: "Mountain Bike Ride",
  EMountainBikeRide: "E-Mountain Bike Ride",
  Handcycle: "Handcycle",
  Velomobile: "Velomobile",
  Swim: "Swim",
  Hike: "Hike",
  RockClimbing: "Rock Climbing",
  AlpineSki: "Alpine Ski",
  BackcountrySki: "Backcountry Ski",
  NordicSki: "Nordic Ski",
  Snowboard: "Snowboard",
  Snowshoe: "Snowshoe",
  IceSkate: "Ice Skate",
  InlineSkate: "Inline Skate",
  RollerSki: "Roller Ski",
  Kayaking: "Kayaking",
  Canoeing: "Canoeing",
  Rowing: "Rowing",
  VirtualRow: "Virtual Row",
  StandUpPaddling: "Stand Up Paddling",
  Surfing: "Surfing",
  Kitesurf: "Kitesurf",
  Windsurf: "Windsurf",
  Sail: "Sail",
  Crossfit: "CrossFit",
  Elliptical: "Elliptical",
  StairStepper: "Stair Stepper",
  WeightTraining: "Weight Training",
  Yoga: "Yoga",
  Pilates: "Pilates",
  HighIntensityIntervalTraining: "HIIT",
  Workout: "Workout",
  Soccer: "Soccer",
  Tennis: "Tennis",
  TableTennis: "Table Tennis",
  Squash: "Squash",
  Racquetball: "Racquetball",
  Badminton: "Badminton",
  Pickleball: "Pickleball",
  Golf: "Golf",
  Skateboard: "Skateboard",
  Wheelchair: "Wheelchair",
}

/** Convert PascalCase to spaced words as fallback for unknown sport types */
function pascalToWords(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
}

function mapActivityType(sport_type: string, workout_type?: number): string {
  if (sport_type === "Run" && workout_type === 1) return "Race"
  return SPORT_TYPE_LABELS[sport_type] ?? pascalToWords(sport_type)
}

/**
 * Converts Strava average_speed (m/s) to pace in min/km.
 * Returns null when speed is zero or missing (e.g. manual entries).
 */
function speedToPace(averageSpeedMs: number): number | null {
  if (averageSpeedMs <= 0) return null
  return 1000 / averageSpeedMs / 60
}

/** Unix seconds for a Strava ISO start_date. */
function toEpochSeconds(startDate: string): number {
  return Math.floor(new Date(startDate).getTime() / 1000)
}

/**
 * Peak HR for the row, or null.
 *
 * Strava occasionally reports a max below the average (sensor dropouts on
 * their side). The `activities_max_hr_gte_avg` constraint would reject the
 * whole upsert batch for one such row, so an inconsistent pair is stored as
 * "no peak recorded" rather than failing the sync.
 */
function peakHeartRate(a: StravaActivity): number | null {
  if (a.max_heartrate == null) return null
  const max = Math.round(a.max_heartrate)
  if (max <= 0) return null
  const avg = a.average_heartrate != null ? Math.round(a.average_heartrate) : null
  if (avg != null && max < avg) return null
  return max
}

/** Maps a Strava activity onto an `activities` row. */
function toActivityRow(userId: string, a: StravaActivity) {
  return {
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
    max_heart_rate: peakHeartRate(a),
    avg_cadence: a.average_cadence != null ? Math.round(a.average_cadence) : null,
    calories: a.calories != null ? Math.round(a.calories) : null,
  }
}

const PER_PAGE = 100

/**
 * Reads one page of the athlete's activity list, newest first, older than
 * `before` (unix seconds).
 */
async function fetchActivityPage(
  accessToken: string,
  before: number,
  page: number,
): Promise<StravaActivity[]> {
  const url = new URL("https://www.strava.com/api/v3/athlete/activities")
  url.searchParams.set("per_page", String(PER_PAGE))
  url.searchParams.set("page", String(page))
  url.searchParams.set("before", String(before))

  const res = await stravaApiFetch(url.toString(), accessToken)

  if (res.status === 401) throw new StravaUnauthorizedError()
  if (!res.ok) {
    const body = await res.text()
    console.error(`Strava activities fetch failed (${res.status}):`, body)
    throw new Error(`Strava activities fetch failed: ${res.status}`)
  }

  return (await res.json()) as StravaActivity[]
}

/**
 * Fetches a single activity from Strava by ID.
 */
async function fetchSingleStravaActivity(
  accessToken: string,
  activityId: number,
): Promise<StravaActivity | null> {
  const res = await stravaApiFetch(
    `https://www.strava.com/api/v3/activities/${activityId}`,
    accessToken,
  )

  if (res.status === 404) return null
  if (!res.ok) {
    const body = await res.text()
    console.error(`Strava activity fetch failed (${res.status}):`, body)
    throw new Error(`Strava activity fetch failed: ${res.status}`)
  }

  return (await res.json()) as StravaActivity
}

// ---------------------------------------------------------------------------
// Goal recalculation (shared by manual sync + webhook)
// ---------------------------------------------------------------------------

export async function recalculateGoals(userId: string) {
  const service = createServiceClient()
  const errors: string[] = []

  // Recalculate lifetime goals
  try {
    const { data: activeGoals } = await service
      .from("goals")
      .select("id, start_date, target_date")
      .eq("user_id", userId)
      .eq("is_active", true)

    if (activeGoals && activeGoals.length > 0) {
      // Fetch activities once, compute all goal totals, then batch update
      const { data: allActivities } = await service
        .from("activities")
        .select("date, distance_km")
        .eq("user_id", userId)

      const acts = allActivities ?? []

      const updates = activeGoals.map((goal) => {
        const totalKm = acts
          .filter((a) => {
            if (a.date > goal.target_date) return false
            if (goal.start_date && a.date < goal.start_date) return false
            return true
          })
          .reduce((sum, a) => sum + Number(a.distance_km), 0)
        return { id: goal.id, totalKm }
      })

      // Update each goal (individual updates to avoid partial failure blocking all)
      await Promise.all(
        updates.map(async ({ id, totalKm }) => {
          const { error } = await service
            .from("goals")
            .update({ current_distance_km: totalKm })
            .eq("id", id)
          if (error) {
            console.error(`[recalcGoals] Failed to update goal ${id}:`, error)
            errors.push(`goal ${id}: ${error.message}`)
          }
        })
      )
    }
  } catch (err) {
    console.error("[recalcGoals] Lifetime goal recalculation failed:", err)
    errors.push(`lifetime goals: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Recalculate weekly goals for the current week
  // Use UTC-based week boundaries for consistency regardless of server timezone
  try {
    const now = new Date()
    // Compute Monday of the current week in UTC
    const utcDay = now.getUTCDay() // 0=Sun, 1=Mon, ..., 6=Sat
    const daysSinceMonday = utcDay === 0 ? 6 : utcDay - 1
    const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday))
    const weekEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday + 6, 23, 59, 59, 999))
    const weekStartStr = weekStart.toISOString().split("T")[0]

    const { data: weeklyGoals } = await service
      .from("weekly_goals")
      .select("id, metric, is_recurring, session_min_duration_minutes, session_min_distance_km")
      .eq("user_id", userId)
      .or(`week_start.eq.${weekStartStr},is_recurring.eq.true`)

    if (weeklyGoals && weeklyGoals.length > 0) {
      const { data: weekActivities } = await service
        .from("activities")
        .select("distance_km, duration_seconds, elevation_gain_m")
        .eq("user_id", userId)
        .gte("date", weekStart.toISOString())
        .lte("date", weekEnd.toISOString())

      const acts = weekActivities ?? []

      await Promise.all(
        weeklyGoals.map(async (wg) => {
          let current = 0

          if (wg.metric === "sessions") {
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

          const { error } = await service.from("weekly_goals").update({ current }).eq("id", wg.id)
          if (error) {
            console.error(`[recalcGoals] Failed to update weekly goal ${wg.id}:`, error)
            errors.push(`weekly goal ${wg.id}: ${error.message}`)
          }
        })
      )
    }
  } catch (err) {
    console.error("[recalcGoals] Weekly goal recalculation failed:", err)
    errors.push(`weekly goals: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (errors.length > 0) {
    console.warn(`[recalcGoals] Completed with ${errors.length} error(s):`, errors)
  }
}

// ---------------------------------------------------------------------------
// Full incremental sync for a user (used by /api/sync-strava)
// ---------------------------------------------------------------------------

export interface SyncResult {
  synced: number
  skipped: number
  incremental: boolean
  /** False when history is left to fetch — call again to continue. */
  done: boolean
  /** Where the next run resumes from (unix seconds), null when finished. */
  resumeCursor: number | null
  /** Set when the run stopped because Strava's rate limit was spent. */
  resumeAt: string | null
}

export interface SyncOptions {
  fullSync: boolean
  /** Cursor left by a previous partial run, from sync_status.cursor_before. */
  resumeCursor?: number | null
}

/**
 * How much of the athlete's history one request is allowed to pull.
 *
 * The Strava rate limit (100 reads per 15 minutes) is per application, shared
 * by every athlete using it, and a serverless function has a hard timeout. So a
 * long history is walked in chunks: each request pulls what it can, saves a
 * cursor, and the caller comes back for the rest.
 */
const MAX_PAGES_PER_RUN = 8 // 8 × 100 = 800 activities per request
const TIME_BUDGET_MS = 40_000

/**
 * Pulls activities from Strava into `activities`.
 *
 * Pagination walks backwards in time from `resumeCursor` (or now), because a
 * page cursor cannot survive across requests — activities recorded meanwhile
 * would shift the pages. An incremental sync stops as soon as it reaches
 * activities older than the last successful sync; a full sync stops when Strava
 * runs out of history.
 *
 * Each page is written before the next is fetched, so an interrupted run keeps
 * everything it had already pulled.
 */
export async function syncUserActivities(
  userId: string,
  options: SyncOptions,
): Promise<SyncResult> {
  const { fullSync, resumeCursor = null } = options
  const service = createServiceClient()
  const startedAt = Date.now()

  const { data: prevSync } = await service
    .from("sync_status")
    .select("last_sync_at")
    .eq("user_id", userId)
    .maybeSingle()

  const lastSyncAt: string | null = prevSync?.last_sync_at ?? null

  // Subtract 1 second so an activity recorded in the same second as
  // last_sync_at is still picked up.
  const stopAt = !fullSync && lastSyncAt
    ? Math.floor(new Date(lastSyncAt).getTime() / 1000) - 1
    : undefined

  // An hour of headroom covers clock skew and activities backdated by a device.
  const before = resumeCursor ?? Math.floor(Date.now() / 1000) + 3600

  let synced = 0
  let cursor: number | null = resumeCursor
  let done = false
  let resumeAt: string | null = null
  let page = 1

  try {
    while (page <= MAX_PAGES_PER_RUN && Date.now() - startedAt < TIME_BUDGET_MS) {
      const batch = await withStravaRetry(userId, (token) =>
        fetchActivityPage(token, before, page),
      )

      if (batch.length === 0) {
        done = true
        break
      }

      const reachedKnownHistory =
        stopAt !== undefined && batch.some((a) => toEpochSeconds(a.start_date) <= stopAt)

      const fresh =
        stopAt === undefined
          ? batch
          : batch.filter((a) => toEpochSeconds(a.start_date) > stopAt)

      if (fresh.length > 0) {
        const { error: upsertError } = await service
          .from("activities")
          .upsert(fresh.map((a) => toActivityRow(userId, a)), {
            onConflict: "user_id,strava_id",
          })
        if (upsertError) throw upsertError
        synced += fresh.length
      }

      if (reachedKnownHistory || batch.length < PER_PAGE) {
        done = true
        break
      }

      // The oldest activity on this page is where the next run picks up.
      cursor = batch.reduce(
        (oldest, a) => Math.min(oldest, toEpochSeconds(a.start_date)),
        Number.POSITIVE_INFINITY,
      )
      page++
    }
  } catch (err) {
    if (err instanceof StravaRateLimitError) {
      // Keep what was written, tell the caller when to come back.
      resumeAt = err.resetAt.toISOString()
    } else {
      throw err
    }
  }

  if (synced > 0 || done) {
    await recalculateGoals(userId)
  }

  return {
    synced,
    skipped: 0,
    incremental: stopAt !== undefined,
    done,
    resumeCursor: done ? null : cursor,
    resumeAt,
  }
}

// ---------------------------------------------------------------------------
// Single activity sync (used by webhook)
// ---------------------------------------------------------------------------

export async function syncSingleActivity(
  userId: string,
  stravaActivityId: number,
): Promise<{ synced: boolean }> {
  const service = createServiceClient()
  const activity = await withStravaRetry(userId, (token) =>
    fetchSingleStravaActivity(token, stravaActivityId)
  )

  if (!activity) {
    return { synced: false }
  }

  const { error } = await service
    .from("activities")
    .upsert([toActivityRow(userId, activity)], { onConflict: "user_id,strava_id" })
  if (error) throw error

  // Update sync timestamp — unless a chunked history sync is still unfinished.
  // Moving last_sync_at forward while older pages are outstanding would make
  // the next incremental run stop before it ever reaches them.
  const { data: syncRow } = await service
    .from("sync_status")
    .select("state")
    .eq("user_id", userId)
    .maybeSingle()

  const historySyncPending =
    syncRow != null && ["syncing", "partial", "rate_limited"].includes(syncRow.state as string)

  if (!historySyncPending) {
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
  }

  await recalculateGoals(userId)

  return { synced: true }
}

// ---------------------------------------------------------------------------
// Delete activity (used by webhook on activity.delete)
// ---------------------------------------------------------------------------

export async function deleteSyncedActivity(
  userId: string,
  stravaActivityId: number,
): Promise<void> {
  const service = createServiceClient()

  await service
    .from("activities")
    .delete()
    .eq("user_id", userId)
    .eq("strava_id", stravaActivityId)

  await recalculateGoals(userId)
}
