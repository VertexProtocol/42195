"use server"

import { createClient } from "@/lib/supabase/server"
import type { Goal } from "@/lib/types"

function mapRow(row: Record<string, unknown>): Goal {
  return {
    id: row.id as string,
    name: row.name as string,
    target_distance_km: Number(row.target_distance_km),
    target_date: row.target_date as string,
    current_distance_km: Number(row.current_distance_km),
    is_active: row.is_active as boolean,
    created_at: row.created_at as string,
  }
}

export async function getGoals(userId: string): Promise<Goal[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("goals")
    .select("id, name, target_distance_km, target_date, current_distance_km, is_active, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })

  if (error) throw error

  return (data ?? []).map(mapRow)
}

export async function createGoal(
  userId: string,
  data: { name: string; target_distance_km: number; target_date: string },
): Promise<Goal> {
  const supabase = await createClient()

  const { data: row, error } = await supabase
    .from("goals")
    .insert({
      user_id: userId,
      name: data.name,
      target_distance_km: data.target_distance_km,
      target_date: data.target_date,
      current_distance_km: 0,
      is_active: false,
    })
    .select("id, name, target_distance_km, target_date, current_distance_km, is_active, created_at")
    .single()

  if (error) throw error

  return mapRow(row)
}

export async function updateGoal(
  goalId: string,
  data: Partial<{
    name: string
    target_distance_km: number
    target_date: string
    current_distance_km: number
  }>,
): Promise<Goal> {
  const supabase = await createClient()

  const { data: row, error } = await supabase
    .from("goals")
    .update(data)
    .eq("id", goalId)
    .select("id, name, target_distance_km, target_date, current_distance_km, is_active, created_at")
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
 * Sets one goal as the active goal for a user.
 * Deactivates any currently-active goal first, then activates the target.
 * Respects the partial unique index (only one is_active=true per user).
 */
export async function setActiveGoal(userId: string, goalId: string): Promise<void> {
  const supabase = await createClient()

  // Deactivate all goals for this user
  const { error: deactivateError } = await supabase
    .from("goals")
    .update({ is_active: false })
    .eq("user_id", userId)
    .eq("is_active", true)

  if (deactivateError) throw deactivateError

  // Activate the chosen goal
  const { error: activateError } = await supabase
    .from("goals")
    .update({ is_active: true })
    .eq("id", goalId)
    .eq("user_id", userId)

  if (activateError) throw activateError
}
