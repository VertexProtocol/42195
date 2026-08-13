import type { Activity, WeeklyGoalMetric } from "@/lib/types"
import { BEST_RELEVANT_RUN_WINDOW } from "@/lib/training-constants"
import { weekRange } from "@/lib/week"

export function formatDistance(km: number): string {
  return km.toFixed(1) + " km"
}

export function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}min`
  return `${m} min`
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60

  if (hours > 0) {
    return `${hours}h ${mins.toString().padStart(2, "0")}m`
  }
  return `${mins}m ${secs.toString().padStart(2, "0")}s`
}

export function formatPace(minPerKm: number | null): string {
  if (minPerKm === null || minPerKm <= 0) return "—"
  const mins = Math.floor(minPerKm)
  const secs = Math.round((minPerKm - mins) * 60)
  return `${mins}:${secs.toString().padStart(2, "0")} /km`
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

/**
 * How long ago something happened, as a number and the unit it is in.
 *
 * Returns parts rather than a formatted string because both callers put the
 * result inside a translated sentence, and a function in here cannot reach the
 * dictionary. It used to return "54m ago" whatever the locale, which read as
 * "Synkronisert 54m ago" to a Norwegian runner.
 */
export function timeAgoParts(dateStr: string): { value: number; unit: "m" | "h" | "d" } {
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 60) return { value: diffMins, unit: "m" }
  if (diffHours < 24) return { value: diffHours, unit: "h" }
  return { value: diffDays, unit: "d" }
}

export function daysUntil(dateStr: string): number {
  const now = new Date()
  const target = new Date(dateStr)
  const diffMs = target.getTime() - now.getTime()
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
}

/**
 * Whole days since a date that has passed. The mirror of daysUntil, which
 * floors at zero and so reports a race last spring and one tomorrow with the
 * same "0 days left".
 */
export function daysSince(dateStr: string): number {
  const diffMs = Date.now() - new Date(dateStr).getTime()
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)))
}

export function progressPercentage(current: number, target: number): number {
  if (target <= 0) return 0
  return Math.min(100, Math.round((current / target) * 100))
}

/** Returns percentage of the training period that has elapsed (0-100) */
export function timeElapsedPercentage(startDate: string | null, targetDate: string): number {
  const now = Date.now()
  const end = new Date(targetDate).getTime()
  const start = startDate ? new Date(startDate).getTime() : end - (end - now) * 2
  const total = end - start
  if (total <= 0) return 100
  const elapsed = now - start
  return Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)))
}

export function formatWeeklyMetric(value: number, metric: string): string {
  switch (metric) {
    case "distance_km":
      return `${value % 1 === 0 ? value : value.toFixed(1)} km`
    case "sessions":
      return `${value}`
    case "duration_minutes":
      return `${Math.round(value)} min`
    case "elevation_m":
      return `${Math.round(value)} m`
    default:
      return `${value}`
  }
}

export function formatTargetTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
  }
  return `${m}:${s.toString().padStart(2, "0")}`
}

/**
 * Compute total distance (km) from activities whose date falls within [startDate, endDate].
 * When startDate is null, falls back to fallbackStart (e.g. goal.created_at) so that
 * only activity logged since the goal was created counts, rather than all history.
 */
export function computeDistanceInRange(
  activities: Activity[],
  startDate: string | null,
  endDate: string,
  fallbackStart?: string,
): number {
  const start = startDate
    ? new Date(startDate).getTime()
    : fallbackStart
      ? new Date(fallbackStart).getTime()
      : 0
  const end = new Date(endDate).getTime()
  return activities
    .filter((a) => {
      const d = new Date(a.date).getTime()
      return d >= start && d <= end
    })
    .reduce((sum, a) => sum + a.distance_km, 0)
}

/**
 * Compute the current value of a weekly goal metric directly from the activities
 * array, using the goal's week_start as the Monday boundary.
 * This avoids relying on the stale `current` field stored in the DB.
 *
 * The window is local, via `weekRange`. It used to be `new Date(weekStart)`,
 * which reads a date-only string as UTC midnight — so for a runner at UTC+2 the
 * week ran Monday 02:00 to Monday 02:00, and an early Monday run counted
 * toward the week before. The `week_start` it was being compared against is
 * built from local time, so the two never agreed.
 *
 * For metric="sessions", optional thresholds filter which activities qualify:
 *   - sessionMinDurationMinutes: session must be >= this many minutes
 *   - sessionMinDistanceKm: session must be >= this many km
 * If both are provided, a session must satisfy both (AND logic).
 */
export function computeWeeklyProgress(
  activities: Activity[],
  metric: WeeklyGoalMetric,
  weekStart: string,
  sessionMinDurationMinutes?: number | null,
  sessionMinDistanceKm?: number | null,
): number {
  const { start, end } = weekRange(weekStart)
  const weekActivities = activities.filter((a) => {
    const d = new Date(a.date).getTime()
    return d >= start.getTime() && d < end.getTime()
  })
  switch (metric) {
    case "distance_km":
      return weekActivities.reduce((s, a) => s + a.distance_km, 0)
    case "sessions": {
      const qualifying = weekActivities.filter((a) => {
        if (sessionMinDurationMinutes && a.duration_seconds / 60 < sessionMinDurationMinutes) return false
        if (sessionMinDistanceKm && a.distance_km < sessionMinDistanceKm) return false
        return true
      })
      return qualifying.length
    }
    case "duration_minutes":
      return weekActivities.reduce((s, a) => s + a.duration_seconds / 60, 0)
    case "elevation_m":
      return weekActivities.reduce((s, a) => s + (a.elevation_gain_m ?? 0), 0)
    default:
      return 0
  }
}

/**
 * Returns true if the date string represents a calendar day before today
 * (in local time). Uses noon to avoid timezone edge-cases with date-only strings.
 */
export function isDatePast(dateStr: string): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(dateStr.split("T")[0] + "T12:00:00")
  return d < today
}

export interface PerformanceGoalStatus {
  reached: boolean
  /** The best qualifying activity (or best attempt if not yet reached) */
  bestActivity: Activity | null
  /**
   * Pace-adjusted time in seconds for exactly target_distance_km.
   * Only set when the goal has a target_time_seconds.
   */
  bestTimeSeconds: number | null
  /** 0–100 progress toward the goal */
  progress: number
}

/**
 * Evaluates a performance goal against the user's activity history.
 *
 * Timed goal (target_time_seconds set):
 *   - Finds all runs with distance >= target_distance_km
 *   - Computes pace-adjusted time for exactly the target distance
 *   - reached = adjusted time <= target_time_seconds
 *   - progress = min(100, targetTime / bestAdjustedTime * 100)
 *
 * Distance-only goal (target_time_seconds null, e.g. "First 20 km"):
 *   - reached = any single run with distance >= target_distance_km
 *   - progress = min(100, longestRun / targetDistance * 100)
 *
 * ── DESIGN CHOICE ─────────────────────────────────────────────────────────
 * No date filtering against target_date. A performance goal asks "can you
 * do this?" not "did you do this by X?", so a marathon completed a week
 * after the planned race date still counts as reached. The target_date
 * drives plan timing, not achievement validation. If a use case needs
 * time-bounded evaluation (e.g. "first marathon in 2026"), add a separate
 * before-date filter at the call site rather than baking it in here.
 * ─────────────────────────────────────────────────────────────────────────
 */
export type GoalOutcome = "reached" | "ended"

/**
 * How a goal that has run its course went, in one word.
 *
 * Only a goal with a measurable mark can be said to have been reached. An
 * event goal has none — a marathon is not passed or failed by the app — so it
 * ends, which is a statement about the calendar and not about the runner.
 *
 * Shared by the goal's own result card and by the group's closing rows,
 * because those two showing a runner different verdicts about the same race
 * would be worse than either of them being wrong.
 */
export function goalOutcome(
  goalCategory: string | null | undefined,
  activities: Activity[],
  targetDistanceKm: number,
  targetTimeSeconds: number | null,
): GoalOutcome {
  if (goalCategory !== "performance") return "ended"
  return evaluatePerformanceGoal(activities, targetDistanceKm, targetTimeSeconds).reached
    ? "reached"
    : "ended"
}

export function evaluatePerformanceGoal(
  activities: Activity[],
  targetDistanceKm: number,
  targetTimeSeconds: number | null,
): PerformanceGoalStatus {
  if (targetTimeSeconds !== null) {
    const qualifying = activities.filter(
      (a) => a.distance_km >= targetDistanceKm && a.duration_seconds > 0,
    )
    if (qualifying.length === 0) {
      return { reached: false, bestActivity: null, bestTimeSeconds: null, progress: 0 }
    }
    // Best = smallest pace-adjusted time for exactly target_distance_km
    const best = qualifying.reduce((b, a) => {
      const tA = (targetDistanceKm / a.distance_km) * a.duration_seconds
      const tB = (targetDistanceKm / b.distance_km) * b.duration_seconds
      return tA < tB ? a : b
    })
    const bestTimeSeconds = Math.round(
      (targetDistanceKm / best.distance_km) * best.duration_seconds,
    )
    const reached = bestTimeSeconds <= targetTimeSeconds
    // Progress: how close best time is to target (higher = closer)
    const progress = Math.min(100, Math.round((targetTimeSeconds / bestTimeSeconds) * 100))
    return { reached, bestActivity: best, bestTimeSeconds, progress }
  } else {
    // Distance-only goal
    const allRuns = activities.filter((a) => a.distance_km > 0)
    if (allRuns.length === 0) {
      return { reached: false, bestActivity: null, bestTimeSeconds: null, progress: 0 }
    }
    const longest = allRuns.reduce((b, a) => (a.distance_km > b.distance_km ? a : b))
    const reached = longest.distance_km >= targetDistanceKm
    const progress = Math.min(
      100,
      Math.round((longest.distance_km / targetDistanceKm) * 100),
    )
    return { reached, bestActivity: longest, bestTimeSeconds: null, progress }
  }
}

/**
 * Best run within ±BEST_RELEVANT_RUN_WINDOW of the goal distance, ranked by
 * fastest time. Used to surface a "best run at this distance" indicator on
 * event-training goal cards.
 */
export function bestRelevantRun(
  activities: Activity[],
  targetDistanceKm: number,
  startDate?: string | null,
  endDate?: string | null,
): Activity | null {
  const lo = targetDistanceKm * (1 - BEST_RELEVANT_RUN_WINDOW)
  const hi = targetDistanceKm * (1 + BEST_RELEVANT_RUN_WINDOW)
  const from = startDate ? new Date(startDate).getTime() : 0
  const to = endDate ? new Date(endDate).getTime() : Infinity
  const candidates = activities.filter((a) => {
    const t = new Date(a.date).getTime()
    return a.distance_km >= lo && a.distance_km <= hi && a.duration_seconds > 0 && t >= from && t <= to
  })
  if (candidates.length === 0) return null
  return candidates.reduce((best, a) =>
    a.duration_seconds < best.duration_seconds ? a : best,
  )
}

/** Longest single run within a date range */
export function longestRun(
  activities: Activity[],
  startDate: string | null,
  endDate?: string | null,
): Activity | null {
  const from = startDate ? new Date(startDate).getTime() : 0
  const to = endDate ? new Date(endDate).getTime() : Infinity
  const relevant = activities.filter((a) => {
    const t = new Date(a.date).getTime()
    return t >= from && t <= to
  })
  if (relevant.length === 0) return null
  return relevant.reduce((best, a) =>
    a.distance_km > best.distance_km ? a : best,
  )
}

export function weeklyMetricUnit(metric: string): string {
  switch (metric) {
    case "distance_km":
      return "km"
    case "sessions":
      return "sessions"
    case "duration_minutes":
      return "min"
    case "elevation_m":
      return "m"
    default:
      return ""
  }
}

/**
 * True for any running-flavored activity type (Run, Trail Run, Virtual Run,
 * Treadmill, Race). Used to scope training stats and the calendar to runs
 * only, excluding rides, swims, walks, etc.
 */
export function isRunActivity(type: string): boolean {
  const t = type.toLowerCase()
  return t.includes("run") || t === "race" || t === "treadmill"
}
