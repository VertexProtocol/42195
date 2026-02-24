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
  }
}

/**
 * Returns weekly goals for a user for a specific week.
 * @param weekStart ISO date string for the Monday of the week (e.g. "2026-02-23")
 */
export async function getWeeklyGoals(userId: string, weekStart: string): Promise<WeeklyGoal[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("weekly_goals")
    .select("id, metric, label, target, current, week_start")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
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
    })
    .select("id, metric, label, target, current, week_start")
    .single()

  if (error) throw error

  return mapRow(row)
}

export async function updateWeeklyGoal(
  goalId: string,
  data: Partial<{ label: string; target: number; current: number }>,
): Promise<WeeklyGoal> {
  const supabase = await createClient()

  const { data: row, error } = await supabase
    .from("weekly_goals")
    .update(data)
    .eq("id", goalId)
    .select("id, metric, label, target, current, week_start")
    .single()

  if (error) throw error

  return mapRow(row)
}

export async function deleteWeeklyGoal(goalId: string): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase.from("weekly_goals").delete().eq("id", goalId)

  if (error) throw error
}
