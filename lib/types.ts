export type ActivityType = "Run" | "Trail Run" | "Race"

export interface Activity {
  id: string
  type: ActivityType
  name: string
  date: string
  distance_km: number
  duration_seconds: number
  pace_min_per_km: number
  elevation_gain_m: number | null
  avg_heart_rate: number | null
  calories: number | null
}

export interface Goal {
  id: string
  name: string
  target_distance_km: number
  target_date: string
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

export type TabId = "home" | "activities" | "goals" | "profile"
