import { Suspense } from "react"
import { AppShell } from "@/components/app-shell"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import type {
  GoalCategory,
  SharedGoalMetric,
  SyncStatus,
  WeeklyGoalMetric,
  WeeklyGoalSource,
} from "@/lib/types"
import { fetchAllActivities } from "@/lib/activities-query"
import {
  deriveWarningContext,
  evaluateWarnings,
  type WarningActivity,
  type WarningState,
} from "@/lib/training-warnings"
import { derivePlanBadges, type PlanBadgeRow } from "@/lib/plan-badges"
import { parseTargetHistory } from "@/lib/weekly-goal-history"
import {
  derivePlanDigests,
  type GoalPlanningPrefs,
  type PlanDigestRow,
} from "@/lib/weekly-suggestions"
import { deriveCurrentPlanWeeks, type PlanWeekRow } from "@/lib/plan-today"
import type { PlanSessionStatus } from "@/lib/types"
import { RUN_TYPES } from "@/lib/training-constants"
import { initialOf, type SharedGoalSummary } from "@/app/api/shared-goals/route"

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

  const [activitiesRes, goalsRes, weeklyGoalsRes, profileRes, testRunsRes, planRowsRes, sessionStatusRes, goalPrefsRes, dismissalsRes, sharedRes, stravaTokenRes, syncStatusRes] =
    await Promise.all([
      fetchAllActivities(supabase),
      supabase
        .from("goals")
        .select("*")
        .order("display_order", { ascending: true }),
      supabase
        .from("weekly_goals")
        .select("id, metric, label, target, week_start, is_recurring, session_min_duration_minutes, session_min_distance_km, display_order, source, source_goal_id, suggested_target, target_history")
        .order("display_order", { ascending: true }),
      supabase.from("profiles").select("id, display_name, email, avatar_url, locale, max_hr, resting_hr, hr_analysis_cache, warning_state, onboarding_dismissed_at").eq("id", authUser.id).single(),
      // Which activities are test runs. Fetched here rather than from the
      // Activities screen on mount: that screen unmounts on every tab change,
      // so its filter chip appeared a round-trip late each time the tab was
      // opened, shifting the row it sits in.
      supabase.from("test_runs").select("activity_id").eq("user_id", authUser.id),
      // Plan badges for the starred-goal cards. Selected here rather than on
      // Today so the plan JSON — kilobytes per goal, read only to count the
      // block's weeks — stays on the server, and so the badges are present on
      // first paint instead of appearing after a query on every visit.
      supabase
        .from("ai_training_plans")
        .select("goal_id, block_start_date, plan, mid_block_checkpoint")
        .eq("user_id", authUser.id)
        // A block put away when the runner generated one for another race is
        // history, not what they are training on. It must not put a session on
        // Today or a badge on a goal card.
        .is("archived_at", null),
      // What the runner has said by hand about their planned sessions. Read
      // here so Today can show the plan's current week on first paint: the
      // week is a function of the plan, the activities and these, and the
      // other two are already on this page.
      supabase
        .from("session_completions")
        .select("goal_id, session_key, status")
        .eq("user_id", authUser.id),
      // Planning settings, for the weekly targets suggested on Plan. Read here
      // because a suggestion has to be right on first paint — a target that
      // arrives a round trip after the screen does is a number that changes
      // under the runner while they are reading it.
      supabase
        .from("goal_preferences")
        .select("goal_id, sessions_per_week, weekly_increase_pct, block_weeks")
        .eq("user_id", authUser.id),
      // Suggestions the runner has turned down. Read alongside the settings
      // above because it decides whether a card appears at all: fetched a
      // round trip later, a dismissed suggestion would flash back onto the
      // screen on every visit, which is the nagging the dismissal was for.
      supabase
        .from("weekly_suggestion_dismissals")
        .select("metric, source_goal_id")
        .eq("user_id", authUser.id),
      // The group a goal belongs to, so its row on the goal's detail screen is
      // there on first paint. Fetched here for the same reason the plan badges
      // are: that screen unmounts on every tab change, so owning the query
      // meant a round trip — and a flash of "create a group" — on each visit.
      supabase
        .from("shared_goal_members")
        .select("goal_id, position_pct, shared_goals(id, name, race_date, metric)")
        // Own rows only. A member may read everyone's row in their groups, so
        // without this a runner was seeded an entry keyed by another member's
        // goal id, carrying that member's position as "mine". The API that
        // re-reads this always filtered; the page render did not.
        .eq("user_id", authUser.id),
      service.from("strava_tokens").select("user_id").eq("user_id", authUser.id).maybeSingle(),
      supabase.from("sync_status").select("state, last_sync_at, error_message").eq("user_id", authUser.id).maybeSingle(),
    ])

  // Proactive training warnings. Today fetched these on mount, and it unmounts
  // on every tab change — so the cards dropped in a round-trip late each time
  // the runner came back. Deriving them here costs no extra query: the engine
  // reads the activity list that was already fetched above.
  const warningActivities: WarningActivity[] = activitiesRes
    .filter((a) => RUN_TYPES.has(a.type))
    .map((a) => ({
      date: a.date,
      distance_km: a.distance_km,
      duration_seconds: a.duration_seconds,
      pace_min_per_km: a.pace_min_per_km,
      avg_heart_rate: a.avg_heart_rate,
      elevation_gain_m: a.elevation_gain_m,
    }))
  const warningState =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (((profileRes.data as any)?.warning_state as WarningState | null) ?? {}) as WarningState
  const { newWarnings } = evaluateWarnings(
    deriveWarningContext(warningActivities),
    warningState,
  )

  // An account made from a Strava sign-in has no password until it asks for
  // one. Read from the auth user rather than the profile row: it is a fact
  // about the credential, not about the runner.
  const metadata = authUser.user_metadata ?? {}
  const needsPassword = metadata.auth_source === "strava" && metadata.has_password !== true

  // Keyed by goal so Today can pick out the one it is showing, and so a runner
  // with two races pinned does not have the second one's ticks counted against
  // the first one's week.
  const planSessionStatuses: Record<string, Record<string, PlanSessionStatus>> = {}
  for (const row of sessionStatusRes.data ?? []) {
    const forGoal = (planSessionStatuses[row.goal_id] ??= {})
    forGoal[row.session_key] = row.status as PlanSessionStatus
  }

  const initialData = {
    activities: activitiesRes,
    warnings: newWarnings,
    planBadges: derivePlanBadges((planRowsRes.data ?? []) as PlanBadgeRow[]),
    planDigests: derivePlanDigests((planRowsRes.data ?? []) as PlanDigestRow[]),
    goalPrefs: Object.fromEntries(
      (goalPrefsRes.data ?? []).map((p) => [
        p.goal_id as string,
        {
          sessionsPerWeek: Number(p.sessions_per_week ?? 3),
          weeklyIncreasePct: Number(p.weekly_increase_pct ?? 10),
          blockWeeks: Number(p.block_weeks ?? 4),
        } satisfies GoalPlanningPrefs,
      ]),
    ),
    // Trimmed to the current week here rather than shipped whole: the plan JSON
    // is kilobytes per goal, and Today shows one session out of it.
    currentPlanWeeks: deriveCurrentPlanWeeks((planRowsRes.data ?? []) as PlanWeekRow[]),
    planSessionStatuses,
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
      week_start: wg.week_start,
      is_recurring: wg.is_recurring ?? false,
      session_min_duration_minutes: wg.session_min_duration_minutes ?? null,
      session_min_distance_km: wg.session_min_distance_km ? Number(wg.session_min_distance_km) : null,
      display_order: (wg as any).display_order ?? 0, // [DND]
      source: ((wg as any).source ?? "manual") as WeeklyGoalSource,
      source_goal_id: (wg as any).source_goal_id ?? null,
      suggested_target:
        (wg as any).suggested_target != null ? Number((wg as any).suggested_target) : null,
      target_history: parseTargetHistory((wg as any).target_history),
    })),
    dismissals: ((dismissalsRes.data ?? []) as { metric: string; source_goal_id: string | null }[]).map(
      (d) => ({
        metric: d.metric as WeeklyGoalMetric,
        source_goal_id: d.source_goal_id ?? null,
      }),
    ),
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
          needs_password: needsPassword,
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
          needs_password: needsPassword,
        },
    sharedGoals: await buildSharedGoalSummaries(supabase, authUser.id, sharedRes.data ?? []),
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

/**
 * The group each of the runner's goals belongs to, keyed by goal id.
 *
 * Names come from the definer function rather than a join, because `profiles`
 * is select-own and stays that way — it returns the display names of the
 * people you share a goal with and nobody else. Most runners are in no groups
 * or one, so the per-group call is a loop over zero or one.
 */
async function buildSharedGoalSummaries(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  rows: Array<{ goal_id: string; position_pct: number | null; shared_goals: unknown }>,
): Promise<Record<string, SharedGoalSummary>> {
  const out: Record<string, SharedGoalSummary> = {}
  if (rows.length === 0) return out

  await Promise.all(
    rows.map(async (row) => {
      const embed = row.shared_goals
      const goal = (Array.isArray(embed) ? embed[0] : embed) as {
        id: string
        name: string
        race_date: string
        metric: SharedGoalMetric
      } | null
      if (!goal) return

      const { data: names } = await supabase.rpc("shared_goal_member_names", { g: goal.id })
      const members = (names ?? []) as Array<{ user_id: string; display_name: string | null }>

      out[row.goal_id] = {
        id: goal.id,
        name: goal.name,
        race_date: goal.race_date,
        metric: goal.metric,
        memberCount: members.length,
        initials: members
          .filter((m) => m.user_id !== userId)
          .map((m) => initialOf(m.display_name))
          .slice(0, 3),
        myPositionPct: row.position_pct == null ? null : Number(row.position_pct),
      }
    }),
  )

  return out
}
