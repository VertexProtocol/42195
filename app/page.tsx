import { Suspense } from "react"
import { AppShell } from "@/components/app-shell"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import type { GoalCategory } from "@/lib/types"

export default async function Page() {
  const supabase = await createClient()
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser()

  if (!authUser) {
    return (
      <Suspense>
        <AppShell initialData={null} />
      </Suspense>
    )
  }

  const service = createServiceClient()

  const [activitiesRes, goalsRes, weeklyGoalsRes, profileRes, stravaTokenRes, syncStatusRes] =
    await Promise.all([
      supabase
        .from("activities")
        .select("id, user_id, strava_id, type, name, date, distance_km, duration_seconds, pace_min_per_km, elevation_gain_m, avg_heart_rate, calories, map_polyline, created_at")
        .order("date", { ascending: false }),
      supabase
        .from("goals")
        .select("id, goal_category, name, target_distance_km, start_date, target_time_seconds, target_date, current_distance_km, is_active, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("weekly_goals")
        .select("id, metric, label, target, current, week_start, is_recurring, session_min_duration_minutes, session_min_distance_km")
        .order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, display_name, email, avatar_url").eq("id", authUser.id).single(),
      service.from("strava_tokens").select("user_id").eq("user_id", authUser.id).maybeSingle(),
      supabase.from("sync_status").select("state, last_sync_at, error_message").eq("user_id", authUser.id).maybeSingle(),
    ])

  const initialData = {
    activities: (activitiesRes.data ?? []).map((a) => ({
      id: a.id,
      user_id: a.user_id,
      strava_id: a.strava_id,
      type: a.type,
      name: a.name,
      date: a.date,
      distance_km: Number(a.distance_km),
      duration_seconds: a.duration_seconds,
      pace_min_per_km: a.pace_min_per_km ? Number(a.pace_min_per_km) : null,
      elevation_gain_m: a.elevation_gain_m ? Number(a.elevation_gain_m) : null,
      avg_heart_rate: a.avg_heart_rate,
      calories: a.calories,
      map_polyline: a.map_polyline,
      created_at: a.created_at,
    })),
    goals: (goalsRes.data ?? []).map((g) => ({
      id: g.id,
      goal_category: (g.goal_category ?? "performance") as GoalCategory,
      name: g.name,
      target_distance_km: Number(g.target_distance_km),
      start_date: g.start_date ?? null,
      target_time_seconds: g.target_time_seconds ?? null,
      target_date: g.target_date,
      current_distance_km: Number(g.current_distance_km),
      is_active: g.is_active,
      created_at: g.created_at,
    })),
    weeklyGoals: (weeklyGoalsRes.data ?? []).map((wg) => ({
      id: wg.id,
      metric: wg.metric,
      label: wg.label,
      target: Number(wg.target),
      current: Number(wg.current),
      week_start: wg.week_start,
      is_recurring: wg.is_recurring ?? false,
      session_min_duration_minutes: wg.session_min_duration_minutes ?? null,
      session_min_distance_km: wg.session_min_distance_km ? Number(wg.session_min_distance_km) : null,
    })),
    user: profileRes.data
      ? {
          id: profileRes.data.id,
          display_name: profileRes.data.display_name ?? authUser.email ?? "Runner",
          email: profileRes.data.email ?? authUser.email ?? "",
          avatar_url: profileRes.data.avatar_url ?? null,
        }
      : {
          id: authUser.id,
          display_name: authUser.email ?? "Runner",
          email: authUser.email ?? "",
          avatar_url: null,
        },
    stravaConnected: !!stravaTokenRes.data,
    syncStatus: syncStatusRes.data
      ? {
          state: syncStatusRes.data.state as string,
          last_sync_at: syncStatusRes.data.last_sync_at as string | null,
          error_message: syncStatusRes.data.error_message as string | null,
        }
      : null,
  }

  return (
    <Suspense>
      <AppShell initialData={initialData} />
    </Suspense>
  )
}
