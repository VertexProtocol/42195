"use server"

import { createClient } from "@/lib/supabase/server"
import type { Goal, GoalCategory } from "@/lib/types"

function mapRow(row: Record<string, unknown>): Goal {
  return {
    id: row.id as string,
    goal_category: (row.goal_category ?? "performance") as GoalCategory,
    name: row.name as string,
    target_distance_km: Number(row.target_distance_km),
    start_date: (row.start_date as string | null) ?? null,
    target_time_seconds: (row.target_time_seconds as number | null) ?? null,
    target_date: row.target_date as string,
    current_distance_km: Number(row.current_distance_km),
    is_active: row.is_active as boolean,
    created_at: row.created_at as string,
  }
}

const GOAL_FIELDS =
  "id, goal_category, name, target_distance_km, start_date, target_time_seconds, target_date, current_distance_km, is_active, created_at"

export async function getGoals(userId: string): Promise<Goal[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("goals")
    .select(GOAL_FIELDS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })

  if (error) throw error

  return (data ?? []).map(mapRow)
}

export async function createGoal(
  userId: string,
  data: {
    goal_category: GoalCategory
    name: string
    target_distance_km: number
    start_date: string | null
    target_time_seconds: number | null
    target_date: string
  },
): Promise<Goal> {
  const supabase = await createClient()

  const { data: row, error } = await supabase
    .from("goals")
    .insert({
      user_id: userId,
      goal_category: data.goal_category,
      name: data.name,
      target_distance_km: data.target_distance_km,
      start_date: data.start_date,
      target_time_seconds: data.target_time_seconds,
      target_date: data.target_date,
      current_distance_km: 0,
      is_active: false,
    })
    .select(GOAL_FIELDS)
    .single()

  if (error) throw error

  return mapRow(row)
}

export async function updateGoal(
  goalId: string,
  data: Partial<{
    goal_category: GoalCategory
    name: string
    target_distance_km: number
    start_date: string | null
    target_time_seconds: number | null
    target_date: string
    current_distance_km: number
    is_active: boolean
  }>,
): Promise<Goal> {
  const supabase = await createClient()

  const { data: row, error } = await supabase
    .from("goals")
    .update(data)
    .eq("id", goalId)
    .select(GOAL_FIELDS)
    .single()

  if (error) throw error

  return mapRow(row)
}

export async function deleteGoal(goalId: string): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase.from("goals").delete().eq("id", goalId)

  if (error) throw error
}

/**
 * Toggles the is_active flag for a single goal.
 * Multiple goals can be active simultaneously — no deactivation of others.
 */
export async function toggleGoalActive(goalId: string): Promise<Goal> {
  const supabase = await createClient()

  // Read current state first
  const { data: current, error: readError } = await supabase
    .from("goals")
    .select(GOAL_FIELDS)
    .eq("id", goalId)
    .single()

  if (readError || !current) throw readError ?? new Error("Goal not found")

  const { data: row, error } = await supabase
    .from("goals")
    .update({ is_active: !current.is_active })
    .eq("id", goalId)
    .select(GOAL_FIELDS)
    .single()

  if (error) throw error

  return mapRow(row)
}
