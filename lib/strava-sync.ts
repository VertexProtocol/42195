import { startOfWeek, endOfWeek } from "date-fns"
import { createServiceClient } from "@/lib/supabase/service"
import { withStravaRetry, stravaApiFetch } from "@/lib/strava"

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

/**
 * Fetches activities from Strava, paginating until an empty page.
 */
const MAX_PAGES = 50 // 50 × 100 = 5 000 activities — sufficient for any real account

export async function fetchStravaActivities(
  accessToken: string,
  after?: number,
): Promise<StravaActivity[]> {
  const allActivities: StravaActivity[] = []
  let page = 1
  const perPage = 100

  while (page <= MAX_PAGES) {
    const url = new URL("https://www.strava.com/api/v3/athlete/activities")
    url.searchParams.set("per_page", String(perPage))
    url.searchParams.set("page", String(page))
    if (after !== undefined) url.searchParams.set("after", String(after))

    const res = await stravaApiFetch(url.toString(), accessToken)

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
  try {
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
}

export async function syncUserActivities(
  userId: string,
  fullSync: boolean,
): Promise<SyncResult> {
  const service = createServiceClient()

  const { data: prevSync } = await service
    .from("sync_status")
    .select("last_sync_at")
    .eq("user_id", userId)
    .maybeSingle()

  const lastSyncAt: string | null = prevSync?.last_sync_at ?? null

  // Subtract 1 second to avoid missing activities recorded at the exact same
  // second as last_sync_at (Strava's `after` param is exclusive).
  const afterTimestamp = !fullSync && lastSyncAt
    ? Math.floor(new Date(lastSyncAt).getTime() / 1000) - 1
    : undefined

  const stravaActivities = await withStravaRetry(userId, (token) =>
    fetchStravaActivities(token, afterTimestamp)
  )

  const rows = stravaActivities.map((a) => ({
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
    avg_cadence: a.average_cadence != null ? Math.round(a.average_cadence) : null,
    calories: a.calories != null ? Math.round(a.calories) : null,
  }))

  if (rows.length > 0) {
    const { error: upsertError } = await service
      .from("activities")
      .upsert(rows, { onConflict: "strava_id" })
    if (upsertError) throw upsertError
  }

  await recalculateGoals(userId)

  return {
    synced: rows.length,
    skipped: 0,
    incremental: afterTimestamp !== undefined,
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

  const row = {
    user_id: userId,
    strava_id: activity.id,
    type: mapActivityType(activity.sport_type, activity.workout_type),
    name: activity.name,
    date: activity.start_date,
    distance_km: activity.distance / 1000,
    duration_seconds: Math.round(activity.moving_time),
    pace_min_per_km: speedToPace(activity.average_speed),
    elevation_gain_m: activity.total_elevation_gain,
    avg_heart_rate: activity.average_heartrate != null ? Math.round(activity.average_heartrate) : null,
    avg_cadence: activity.average_cadence != null ? Math.round(activity.average_cadence) : null,
    calories: activity.calories != null ? Math.round(activity.calories) : null,
  }

  const { error } = await service
    .from("activities")
    .upsert([row], { onConflict: "strava_id" })
  if (error) throw error

  // Update sync timestamp
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
