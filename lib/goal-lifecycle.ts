import type { Activity, Goal } from "@/lib/types"
import { evaluatePerformanceGoal, isDatePast } from "@/lib/format"
export function isHistoricalGoal(goal: Goal, activities: Activity[]): boolean {
  return isDatePast(goal.target_date) || (goal.goal_category === "performance" && evaluatePerformanceGoal(activities, goal.target_distance_km, goal.target_time_seconds).reached)
}
