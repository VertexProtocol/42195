/** Activity type — matches display names mapped from Strava sport_type */
export type ActivityType = string

export interface Activity {
  id: string
  user_id: string
  strava_id: number | null
  type: ActivityType
  name: string
  date: string
  distance_km: number
  duration_seconds: number
  pace_min_per_km: number | null
  elevation_gain_m: number | null
  avg_heart_rate: number | null
  calories: number | null
  map_polyline: string | null
  created_at: string
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

export type TabId = "home" | "activities" | "goals" | "coach" | "profile"

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

// ---- AI Training Plan types ----

export type TrainingFocus = "volume" | "workouts" | "balanced"
export type PlanMode = "block" | "full_cycle"

export interface GoalPreferences {
  goal_id: string
  sessions_per_week: number
  focus: TrainingFocus
  notes: string | null
  weekly_increase_pct: number   // e.g. 10 = 10% volume increase per week
  block_weeks: number           // total weeks per training block (2/3/4/6)
  regenerate_every_weeks: number // how often user plans to regenerate (2/4/6/8)
  plan_mode?: PlanMode          // "block" (default) or "full_cycle" for complete race prep
}

export interface TrainingSession {
  type: string        // e.g. "Long run", "Tempo run", "Easy run(s)"
  distance: string    // e.g. "20 km"
  effort: string      // e.g. "Easy — conversational pace"
  purpose: string     // e.g. "Build endurance base"
}

export interface TrainingWeek {
  weekNumber: number
  theme: string
  targetKm: number
  sessions: TrainingSession[]
  coachNote: string | null
}

export interface TrainingPlan {
  summary: string
  weeks: TrainingWeek[]
  keyPrinciples: string[]
  watchOut: string | null
}

export interface PlanSnapshot {
  plan: TrainingPlan
  generated_at: string
  adjust_note: string | null
  block_start_date: string
}

export interface AiTrainingPlan {
  goal_id: string
  plan: TrainingPlan
  block_start_date: string
  generated_at: string
  previous_plans: PlanSnapshot[]
}
