import type { Activity, WeeklyGoalMetric } from "@/lib/types"

export function formatDistance(km: number): string {
  return km.toFixed(1) + " km"
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

export function formatTimeAgo(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return `${diffDays}d ago`
}

export function daysUntil(dateStr: string): number {
  const now = new Date()
  const target = new Date(dateStr)
  const diffMs = target.getTime() - now.getTime()
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
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
      return `${value} min`
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
 */
export function computeWeeklyProgress(
  activities: Activity[],
  metric: WeeklyGoalMetric,
  weekStart: string,
): number {
  const start = new Date(weekStart).getTime()
  const end = start + 7 * 24 * 60 * 60 * 1000
  const weekActivities = activities.filter((a) => {
    const d = new Date(a.date).getTime()
    return d >= start && d < end
  })
  switch (metric) {
    case "distance_km":
      return weekActivities.reduce((s, a) => s + a.distance_km, 0)
    case "sessions":
      return weekActivities.length
    case "duration_minutes":
      return weekActivities.reduce((s, a) => s + a.duration_seconds / 60, 0)
    case "elevation_m":
      return weekActivities.reduce((s, a) => s + (a.elevation_gain_m ?? 0), 0)
    default:
      return 0
  }
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
