"use server"

import { createClient } from "@/lib/supabase/server"
import type { WeeklyGoal, WeeklyGoalMetric } from "@/lib/types"

function mapRow(row: Record<string, unknown>): WeeklyGoal {
  return {
    id: row.id as string,
    metric: row.metric as WeeklyGoalMetric,
    label: row.label as string,
    target: Number(row.target),
    current: Number(row.current),
    week_start: row.week_start as string,
    is_recurring: (row.is_recurring as boolean | null) ?? false,
  }
}

const WEEKLY_GOAL_FIELDS = "id, metric, label, target, current, week_start, is_recurring"

/**
 * Returns weekly goals visible for a given week:
 * - one-off goals whose week_start matches exactly, plus
 * - all recurring goals (they appear in every week regardless of week_start)
 *
 * @param weekStart ISO date string for the Monday of the week (e.g. "2026-02-23")
 */
export async function getWeeklyGoals(userId: string, weekStart: string): Promise<WeeklyGoal[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("weekly_goals")
    .select(WEEKLY_GOAL_FIELDS)
    .eq("user_id", userId)
    .or(`week_start.eq.${weekStart},is_recurring.eq.true`)
    .order("created_at", { ascending: true })

  if (error) throw error

  return (data ?? []).map(mapRow)
}

export async function createWeeklyGoal(
  userId: string,
  data: {
    metric: WeeklyGoalMetric
    label: string
    target: number
    week_start: string
    is_recurring: boolean
  },
): Promise<WeeklyGoal> {
  const supabase = await createClient()

  const { data: row, error } = await supabase
    .from("weekly_goals")
    .insert({
      user_id: userId,
      metric: data.metric,
      label: data.label,
      target: data.target,
      current: 0,
      week_start: data.week_start,
      is_recurring: data.is_recurring,
    })
    .select(WEEKLY_GOAL_FIELDS)
    .single()

  if (error) throw error

  return mapRow(row)
}

export async function updateWeeklyGoal(
  goalId: string,
  data: Partial<{
    label: string
    target: number
    current: number
    is_recurring: boolean
  }>,
): Promise<WeeklyGoal> {
  const supabase = await createClient()

  const { data: row, error } = await supabase
    .from("weekly_goals")
    .update(data)
    .eq("id", goalId)
    .select(WEEKLY_GOAL_FIELDS)
    .single()

  if (error) throw error

  return mapRow(row)
}

export async function deleteWeeklyGoal(goalId: string): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase.from("weekly_goals").delete().eq("id", goalId)

  if (error) throw error
}
