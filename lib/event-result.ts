import type { Activity, Goal } from "@/lib/types"

type EventGoal = Pick<Goal, "goal_category" | "target_date" | "target_distance_km" | "target_time_seconds" | "event_activity_id" | "event_match_dismissed">
const outdoorRuns = new Set(["Run", "Race", "Trail Run"])
const day = (date: string) => Date.parse(date.slice(0, 10) + "T12:00:00Z")

/** Conservative suggestions; a date/distance match is evidence, not an official race result. */
export function eventCandidates(goal: EventGoal, activities: Activity[]): Activity[] {
  if (goal.goal_category !== "event_training" || !(goal.target_distance_km > 0)) return []
  return activities.filter(a => a.strava_id != null && outdoorRuns.has(a.type) &&
    a.duration_seconds > 0 && Date.parse(a.date) <= Date.now() &&
    Math.abs(day(a.local_date ?? a.date) - day(goal.target_date)) <= 86400000 &&
    Math.abs(a.distance_km / goal.target_distance_km - 1) <= 0.03)
    .sort((a, b) => Math.abs(a.distance_km - goal.target_distance_km) - Math.abs(b.distance_km - goal.target_distance_km))
}

export function eventResult(goal: EventGoal, activities: Activity[]) {
  const candidates = eventCandidates(goal, activities)
  const confirmed = candidates.find(a => a.id === goal.event_activity_id)
  // Missing local dates in old imports are suggestions only: UTC can fall on another date.
  const clear = candidates.filter(a => a.local_date === goal.target_date &&
    Math.abs(a.distance_km / goal.target_distance_km - 1) <= 0.01 &&
    (a.type === "Race" || goal.target_distance_km >= 20))
  const activity = goal.event_match_dismissed ? null : confirmed ?? (clear.length === 1 ? clear[0] : null)
  const elapsed = activity?.elapsed_seconds
  const timeReached = activity && goal.target_time_seconds != null && elapsed != null &&
    elapsed > 0 && elapsed >= activity.duration_seconds ? elapsed <= goal.target_time_seconds : null
  return { activity, candidates, timeReached, automatic: !!activity && !confirmed }
}
