export type ActivityType = "Run" | "Trail Run" | "Race"

export interface Activity {
  id: string
  type: ActivityType
  name: string
  date: string
  distance_km: number
  duration_seconds: number
  pace_min_per_km: number | null
  elevation_gain_m: number | null
  avg_heart_rate: number | null
  calories: number | null
}

/**
 * 'performance'    – a timed/benchmark goal, e.g. "run 10 km in under 50 min"
 * 'event_training' – training toward a race/event, e.g. "marathon in September"
 */
export type GoalCategory = "performance" | "event_training"

export interface Goal {
  id: string
  name: string
  goal_category: GoalCategory
  target_distance_km: number
  target_date: string
  start_date: string | null
  target_time_seconds: number | null
  current_distance_km: number
  is_active: boolean
  created_at: string
}

export type WeeklyGoalMetric = "distance_km" | "sessions" | "duration_minutes" | "elevation_m"

export interface WeeklyGoal {
  id: string
  metric: WeeklyGoalMetric
  label: string
  target: number
  current: number
  week_start: string
  /** Recurring goals appear in every week; one-off goals are tied to week_start */
  is_recurring: boolean
  /** For metric="sessions": only count sessions >= this many minutes (null = no requirement) */
  session_min_duration_minutes?: number | null
  /** For metric="sessions": only count sessions >= this many km (null = no requirement) */
  session_min_distance_km?: number | null
}

export interface WeeklySummary {
  total_distance_km: number
  total_time_seconds: number
  run_count: number
}

export interface SyncStatus {
  last_sync_at: string | null
  state: "success" | "error" | "syncing" | "never"
  error_message: string | null
}

export interface UserProfile {
  id: string
  display_name: string
  email: string
  avatar_url: string | null
}

export type TabId = "home" | "activities" | "goals" | "plan" | "profile"

export interface StreamPoint {
  time: number
  hr: number | null
  pace: number | null
  altitude: number | null
}

export interface Lap {
  index: number
  distance_km: number
  duration_seconds: number
  pace_min_per_km: number
  avg_heart_rate: number | null
}
