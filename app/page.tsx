import { Suspense } from "react"
import { AppShell } from "@/components/app-shell"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import type { GoalCategory, SyncStatus } from "@/lib/types"
import { fetchAllActivities } from "@/lib/activities-query"

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

  const [activitiesRes, goalsRes, weeklyGoalsRes, profileRes, testRunsRes, stravaTokenRes, syncStatusRes] =
    await Promise.all([
      fetchAllActivities(supabase),
      supabase
        .from("goals")
        .select("*")
        .order("display_order", { ascending: true }),
      supabase
        .from("weekly_goals")
        .select("id, metric, label, target, current, week_start, is_recurring, session_min_duration_minutes, session_min_distance_km, display_order")
        .order("display_order", { ascending: true }),
      supabase.from("profiles").select("id, display_name, email, avatar_url, locale, max_hr, resting_hr, hr_analysis_cache, onboarding_dismissed_at").eq("id", authUser.id).single(),
      // Which activities are test runs. Fetched here rather than from the
      // Activities screen on mount: that screen unmounts on every tab change,
      // so its filter chip appeared a round-trip late each time the tab was
      // opened, shifting the row it sits in.
      supabase.from("test_runs").select("activity_id").eq("user_id", authUser.id),
      service.from("strava_tokens").select("user_id").eq("user_id", authUser.id).maybeSingle(),
      supabase.from("sync_status").select("state, last_sync_at, error_message").eq("user_id", authUser.id).maybeSingle(),
    ])

  const initialData = {
    activities: activitiesRes,
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
      display_order: (g as any).display_order ?? 0, // [DND]
      is_starred: (g as any).is_starred ?? false, // [STAR]
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
      display_order: (wg as any).display_order ?? 0, // [DND]
    })),
    user: profileRes.data
      ? {
          id: profileRes.data.id,
          display_name: profileRes.data.display_name ?? authUser.email ?? "Runner",
          email: profileRes.data.email ?? authUser.email ?? "",
          avatar_url: profileRes.data.avatar_url ?? null,
          locale: profileRes.data.locale ?? null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          max_hr: (profileRes.data as any).max_hr ?? null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          resting_hr: (profileRes.data as any).resting_hr ?? null,
          // The cache is selected above but was never passed through, so the
          // profile screen re-ran the HR analysis on every visit.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          hr_analysis_cache: (profileRes.data as any).hr_analysis_cache ?? null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onboarding_dismissed_at: (profileRes.data as any).onboarding_dismissed_at ?? null,
        }
      : {
          id: authUser.id,
          display_name: authUser.email ?? "Runner",
          email: authUser.email ?? "",
          avatar_url: null,
          locale: null,
          max_hr: null,
          resting_hr: null,
          onboarding_dismissed_at: null,
        },
    testRunActivityIds: (testRunsRes.data ?? []).map((tr) => tr.activity_id as string),
    stravaConnected: !!stravaTokenRes.data,
    syncStatus: syncStatusRes.data
      ? {
          state: syncStatusRes.data.state as SyncStatus["state"],
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
