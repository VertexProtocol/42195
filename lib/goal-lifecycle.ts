import { eventResult } from "@/lib/event-result"
import type { Activity, Goal } from "@/lib/types"
import { evaluatePerformanceGoal, isDatePast } from "@/lib/format"
export function isHistoricalGoal(goal: Goal, activities: Activity[]): boolean {
  return !!eventResult(goal, activities).activity || isDatePast(goal.target_date) || (goal.goal_category === "performance" && evaluatePerformanceGoal(activities, goal.target_distance_km, goal.target_time_seconds).reached)
}
