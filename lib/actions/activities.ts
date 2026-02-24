"use server"

import { startOfWeek, endOfWeek } from "date-fns"
import { createClient } from "@/lib/supabase/server"
import type { Activity, WeeklySummary } from "@/lib/types"

/**
 * Returns all activities for a user, ordered by date descending.
 */
export async function getActivities(userId: string): Promise<Activity[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("activities")
    .select(
      "id, type, name, date, distance_km, duration_seconds, pace_min_per_km, elevation_gain_m, avg_heart_rate, calories",
    )
    .eq("user_id", userId)
    .order("date", { ascending: false })

  if (error) throw error

  return (data ?? []).map((row) => ({
    id: row.id,
    type: row.type,
    name: row.name,
    date: row.date,
    distance_km: Number(row.distance_km),
    duration_seconds: row.duration_seconds,
    pace_min_per_km: Number(row.pace_min_per_km),
    elevation_gain_m: row.elevation_gain_m != null ? Number(row.elevation_gain_m) : null,
    avg_heart_rate: row.avg_heart_rate,
    calories: row.calories,
  }))
}

/**
 * Returns an aggregate summary of activities for the current week (Mon–Sun).
 */
export async function getWeeklySummary(userId: string): Promise<WeeklySummary> {
  const supabase = await createClient()

  const now = new Date()
  const weekStart = startOfWeek(now, { weekStartsOn: 1 })
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 })

  const { data, error } = await supabase
    .from("activities")
    .select("distance_km, duration_seconds")
    .eq("user_id", userId)
    .gte("date", weekStart.toISOString())
    .lte("date", weekEnd.toISOString())

  if (error) throw error

  const rows = data ?? []

  return {
    total_distance_km: rows.reduce((sum, r) => sum + Number(r.distance_km), 0),
    total_time_seconds: rows.reduce((sum, r) => sum + r.duration_seconds, 0),
    run_count: rows.length,
  }
}
