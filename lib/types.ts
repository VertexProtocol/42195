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
  avg_cadence: number | null
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
  // [DND] drag-and-drop display order (set by scripts/007_add_goal_display_order.sql)
  display_order?: number
  // [STAR] whether this goal is pinned to the home screen
  is_starred?: boolean
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
  // [DND] drag-and-drop display order
  display_order?: number
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
  locale?: string | null
  hr_analysis_cache?: import("@/lib/hr-analysis-engine").HrAnalysisResult | null
  warning_state?: import("@/lib/training-warnings").WarningState | null
}

export type TabId = "home" | "activities" | "goals" | "insights" | "profile"

/** Second-by-second activity data point from Strava streams */
export interface StreamPoint {
  /** Elapsed time in seconds since activity start */
  time: number
  /** Heart rate in beats per minute (bpm) */
  hr: number | null
  /** Pace in minutes per kilometre (min/km) — lower = faster */
  pace: number | null
  /** Altitude in metres above sea level */
  altitude: number | null
  /** Running cadence in steps per minute (spm) */
  cadence: number | null
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
  injury_notes: string | null   // injury history / recurring issues for safety context
  notes_history: import("./notes-history").NoteHistoryEntry[]
  weekly_increase_pct: number   // e.g. 10 = 10% volume increase per week
  block_weeks: number           // total weeks per training block (2/3/4/6)
  regenerate_every_weeks: number // how often user plans to regenerate (2/4/6/8)
  plan_mode?: PlanMode          // "block" (default) or "full_cycle" for complete race prep
}

export interface TrainingSession {
  type: string              // e.g. "Long run", "Tempo run", "Easy run(s)"
  distance: string          // e.g. "20 km"
  effort: string            // e.g. "Easy — conversational pace"
  purpose: string           // e.g. "Build endurance base"
  suggestedPace?: string    // e.g. "5:20–5:30 /km" — computed deterministically post-AI
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

export interface PlanWeekSummary {
  weekNumber: number
  theme: string
  targetKm: number
  sessionCount: number
}

export interface PlanSnapshot {
  // New format: stripped week summaries + session completion history
  summary: string
  weeks: PlanWeekSummary[]
  sessionCompletions?: Record<string, string>
  // Legacy field present only on snapshots archived before the format change
  plan?: TrainingPlan
  // Common fields
  generated_at: string
  adjust_note: string | null
  block_start_date: string
}

// ---- Test Run types ----

export type TestRunType =
  | "5k_time_trial"
  | "10k_time_trial"
  | "max_effort"
  | "threshold_test"
  | "custom"

export const TEST_RUN_TYPES: { value: TestRunType; label: string }[] = [
  { value: "5k_time_trial", label: "5K Time Trial" },
  { value: "10k_time_trial", label: "10K Time Trial" },
  { value: "max_effort", label: "Max Effort Run" },
  { value: "threshold_test", label: "Threshold Test" },
  { value: "custom", label: "Custom Test Run" },
]

export interface DerivedMetrics {
  estimated_vo2max: number | null
  threshold_pace: number | null       // min/km
  threshold_hr: number | null         // bpm
  running_efficiency: number | null   // speed per bpm: (m/min)/bpm × 1000 — higher = more efficient
  aerobic_capacity: number | null     // km per hour per bpm × 100 — higher = better aerobic fitness
}

export type PredictionValidationResult =
  | "validated"
  | "slightly_optimistic"
  | "too_aggressive"
  | "too_conservative"

export interface PredictionValidation {
  prediction_distance_km: number
  prediction_distance_label: string
  predicted_seconds: number
  predicted_pace: number            // min/km
  actual_seconds: number
  actual_pace: number               // min/km
  pace_diff: number                 // min/km (positive = slower than predicted)
  time_diff_seconds: number         // positive = slower than predicted
  result: PredictionValidationResult
}

export interface TestRun {
  id: string
  user_id: string
  activity_id: string
  test_type: TestRunType
  distance_km: number
  time_seconds: number
  avg_pace: number | null
  avg_hr: number | null
  max_hr: number | null
  elevation_m: number | null
  derived_metrics: DerivedMetrics
  prediction_validation: PredictionValidation | null
  notes: string | null
  created_at: string
}

export interface AiTrainingPlan {
  goal_id: string
  plan: TrainingPlan
  block_start_date: string
  generated_at: string
  previous_plans: PlanSnapshot[]
  mid_block_checkpoint?: MidBlockCheckpoint | null
}

// ---- Mid-block checkpoint types ----

export interface WeekAdherence {
  weekNumber: number
  plannedKm: number
  actualKm: number
  adherencePct: number
}

// ---- Shared Goals (social) ----

export type GoalShareMemberStatus = "pending" | "accepted" | "declined"
export type GoalShareMemberRole = "owner" | "member"

export interface GoalShare {
  id: string
  name: string
  target_date: string
  target_distance_km: number
  created_by: string
  created_at: string
}

export interface GoalShareMember {
  id: string
  goal_share_id: string
  user_id: string
  goal_id: string | null
  status: GoalShareMemberStatus
  role: GoalShareMemberRole
  invited_by: string | null
  invited_at: string
  responded_at: string | null
  /** Joined display data (server-side only) */
  display_name?: string
  avatar_url?: string | null
}

export interface GoalShareWithMembers extends GoalShare {
  members: GoalShareMember[]
  /** My own membership row, if any (convenience for the client) */
  my_membership: GoalShareMember | null
}

export interface MidBlockCheckpoint {
  checkedAt: string
  blockStartDate: string
  blockWeeks: number
  /** 1-based week number when the checkpoint was evaluated */
  checkpointWeek: number
  completedWeeks: WeekAdherence[]
  /** Weeks excluded from adherence calculation (actual km < 20% of planned) */
  missedWeekCount: number
  overallAdherencePct: number
  isWayOff: boolean
  direction: "under" | "over" | "on_track"
  adjustmentApplied: boolean
  adjustmentNote: string | null
  /** Fatigue signal from HR/pace drift at checkpoint time, if analysed */
  fatigueSignal?: "none" | "hr_elevated" | "pace_declining" | "both"
  /** True if the scale was tightened beyond adherence because fatigue was detected */
  fatigueAdjustmentApplied?: boolean
}
