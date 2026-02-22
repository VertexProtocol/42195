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

export function formatPace(minPerKm: number): string {
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
