"use client"

import { useState, useCallback, useEffect, useTransition, useMemo, useRef } from "react"
import { signOut } from "@/lib/actions/auth"
import { createClient } from "@/lib/supabase/client"
// import { toast } from "sonner" // Temporarily disabled
import type {
  Activity,
  Goal,
  GoalCategory,
  WeeklyGoal,
  WeeklyGoalMetric,
  SyncStatus,
  UserProfile,
  PlanSessionStatus,
  WeeklySuggestionDismissal,
} from "@/lib/types"
import { deriveCurrentPlanWeeks, type CurrentPlanWeek, type PlanWeekRow } from "@/lib/plan-today"
import { fetchAllActivities, mapActivityRow } from "@/lib/activities-query"
import type { Warning } from "@/lib/training-warnings"
import { derivePlanBadges, type PlanBadge, type PlanBadgeRow } from "@/lib/plan-badges"
import { parseTargetHistory } from "@/lib/weekly-goal-history"
import {
  derivePlanDigests,
  type GoalPlanningPrefs,
  type PlanDigest,
  type PlanDigestRow,
} from "@/lib/weekly-suggestions"
import type { SharedGoalSummary } from "@/app/api/shared-goals/route"
import { logError } from "@/lib/log"

const supabase = createClient()

// The server pulls Strava history in chunks so no single request runs long
// enough to be killed by the platform timeout. Each response says whether it
// finished; if it did not, the client asks for the next chunk. This is the
// safety stop — 25 × 800 activities is far beyond any real history.
const MAX_SYNC_CHUNKS = 25

export interface InitialData {
  activities: Activity[]
  goals: Goal[]
  weeklyGoals: WeeklyGoal[]
  user: UserProfile
  /** Activity IDs that have been logged as test runs. */
  testRunActivityIds: string[]
  /** Proactive training warnings, derived during the page render. */
  warnings: Warning[]
  /** Plan badges keyed by goal id, derived during the page render. */
  planBadges: Record<string, PlanBadge>
  /** Stripped block weeks per goal, for the weekly targets Plan suggests. */
  planDigests: PlanDigest[]
  /** Planning settings by goal id, for the same. */
  goalPrefs: Record<string, GoalPlanningPrefs>
  /** The week each goal's plan is in, trimmed during the page render. */
  currentPlanWeeks: Record<string, CurrentPlanWeek>
  /** Manual session statuses per goal, keyed `W3-1`. */
  planSessionStatuses: Record<string, Record<string, PlanSessionStatus>>
  /** Weekly suggestions the runner has turned down. */
  dismissals: WeeklySuggestionDismissal[]
  /** The group each goal belongs to, keyed by goal id. */
  sharedGoals: Record<string, SharedGoalSummary>
  stravaConnected: boolean
  syncStatus: SyncStatus | null
}

export function useAppData(initialData?: InitialData | null) {
  const hasInitial = initialData != null

  // Core data state — seed from server-side data when available
  const [activities, setActivities] = useState<Activity[]>(initialData?.activities ?? [])
  const [goals, setGoals] = useState<Goal[]>(initialData?.goals ?? [])
  const [weeklyGoals, setWeeklyGoals] = useState<WeeklyGoal[]>(initialData?.weeklyGoals ?? [])
  const [user, setUser] = useState<UserProfile | null>(initialData?.user ?? null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(
    initialData?.syncStatus ?? { state: "never", last_sync_at: null, error_message: null }
  )
  const [stravaConnected, setStravaConnected] = useState(initialData?.stravaConnected ?? false)
  const [isLoading, setIsLoading] = useState(!hasInitial)

  // Held here rather than in the Activities screen: that screen unmounts on
  // every tab change, so owning the fetch made its test-run filter chip
  // appear late on each visit.
  const [testRunActivityIds, setTestRunActivityIds] = useState<Set<string>>(
    () => new Set(initialData?.testRunActivityIds ?? []),
  )

  // Seeded from the page render so Today paints them immediately, then kept
  // fresh from the same session-scoped state rather than refetched per visit.
  const [warnings, setWarnings] = useState<Warning[]>(initialData?.warnings ?? [])
  // Seeded from the page render for the same reason as the plan badges: the
  // goal detail screen unmounts on every tab change, so a fetch it owned meant
  // a round trip — and a flash of the wrong card — on each visit.
  const [sharedGoals, setSharedGoals] = useState<Record<string, SharedGoalSummary>>(
    initialData?.sharedGoals ?? {},
  )
  const [planBadges, setPlanBadges] = useState<Record<string, PlanBadge>>(
    initialData?.planBadges ?? {},
  )
  // Seeded and refreshed alongside the badges — both are read from the same
  // plan rows, and a suggestion built on a block the runner has just
  // regenerated has to describe the new block, not the one it replaced.
  const [planDigests, setPlanDigests] = useState<PlanDigest[]>(
    initialData?.planDigests ?? [],
  )
  const [goalPrefs] = useState<Record<string, GoalPlanningPrefs>>(
    initialData?.goalPrefs ?? {},
  )
  // Today shows the plan's current week, so both of these are seeded by the
  // page render for the same reason the badges are.
  const [currentPlanWeeks, setCurrentPlanWeeks] = useState<Record<string, CurrentPlanWeek>>(
    initialData?.currentPlanWeeks ?? {},
  )
  // Held at the shell rather than on the plan screen, which unmounts on every
  // tab change: ticking a session off in Plan has to be true on Today the
  // moment the runner gets there, not on the next page load.
  const [planSessionStatuses, setPlanSessionStatuses] = useState<
    Record<string, Record<string, PlanSessionStatus>>
  >(initialData?.planSessionStatuses ?? {})

  // A dismissal outlives the week it was made in, so it is held here with the
  // rest of the account's state rather than on the screen that shows the card.
  const [dismissals, setDismissals] = useState<WeeklySuggestionDismissal[]>(
    initialData?.dismissals ?? [],
  )

  const setPlanSessionStatus = useCallback(
    (goalId: string, key: string, status: PlanSessionStatus) => {
      setPlanSessionStatuses((prev) => ({
        ...prev,
        [goalId]: { ...(prev[goalId] ?? {}), [key]: status },
      }))
    },
    [],
  )

  // "Get started" checklist: dismissal belongs to the account, not the tab.
  const [onboardingDismissed, setOnboardingDismissedState] = useState(
    initialData?.user?.onboarding_dismissed_at != null
  )

  // Refs to latest state — avoids stale closures in useCallback without
  // putting mutable arrays in dependency lists (which would recreate every callback on each change).
  const goalsRef = useRef(goals)
  goalsRef.current = goals
  const weeklyGoalsRef = useRef(weeklyGoals)
  weeklyGoalsRef.current = weeklyGoals
  const dismissalsRef = useRef(dismissals)
  dismissalsRef.current = dismissals

  const [, startTransition] = useTransition()

  /**
   * Re-derive the starred-goal plan badges. Called when a plan actually
   * changes — generated, regenerated, or a checkpoint applied — rather than on
   * every visit to Today, which is what made them appear late.
   */
  const refreshPlanBadges = useCallback(async () => {
    const { data } = await supabase
      .from("ai_training_plans")
      .select("goal_id, block_start_date, plan, mid_block_checkpoint")
      // Matches the server read in app/page.tsx: only the live block feeds the
      // badges, Today's week and the weekly suggestions.
      .is("archived_at", null)
    if (!data) return
    setPlanBadges(derivePlanBadges(data as PlanBadgeRow[]))
    setPlanDigests(derivePlanDigests(data as PlanDigestRow[]))
    // The week Today shows comes out of the same rows, so a regenerated block
    // must not leave last block's session on the screen a runner is about to
    // go out on.
    setCurrentPlanWeeks(deriveCurrentPlanWeeks(data as PlanWeekRow[]))
  }, [])

  /** Called when a group is created, joined or left — not on every visit. */
  const refreshSharedGoals = useCallback(async () => {
    try {
      const res = await fetch("/api/shared-goals")
      if (!res.ok) return
      const body = (await res.json()) as { groups?: Record<string, SharedGoalSummary> }
      if (body.groups) setSharedGoals(body.groups)
    } catch {
      // The last known set stays on screen; the next page load re-seeds it.
    }
  }, [])

  /** Warnings are a function of the activity list, so a sync invalidates them. */
  const refreshWarnings = useCallback(async () => {
    try {
      const res = await fetch("/api/warnings")
      if (!res.ok) return
      const data = await res.json()
      if (data?.warnings) setWarnings(data.warnings as Warning[])
    } catch {
      // Warnings are advisory; a failure leaves the last known set in place.
    }
  }, [])

  /** Reflect a test-run tag being added or removed, without a refetch. */
  const setTestRunTag = useCallback((activityId: string, isTestRun: boolean) => {
    setTestRunActivityIds((prev) => {
      if (prev.has(activityId) === isTestRun) return prev
      const next = new Set(prev)
      if (isTestRun) next.add(activityId)
      else next.delete(activityId)
      return next
    })
  }, [])

  // Without SSR data there is nothing to seed from, so fetch once here — still
  // once per session rather than once per visit to the tab that shows it.
  useEffect(() => {
    if (hasInitial) return
    let cancelled = false
    fetch("/api/test-runs")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.test_runs) {
          setTestRunActivityIds(
            new Set(data.test_runs.map((tr: { activity_id: string }) => tr.activity_id)),
          )
        }
      })
      .catch(() => {})
    refreshWarnings()
    refreshPlanBadges()
    return () => {
      cancelled = true
    }
  }, [hasInitial, refreshWarnings, refreshPlanBadges])

  // A sync rewrites the activity list, and the warning engine reads exactly
  // that — so the seeded set is stale the moment new activities land.
  const prevSyncStateForWarnings = useRef(syncStatus.state)
  useEffect(() => {
    const prev = prevSyncStateForWarnings.current
    prevSyncStateForWarnings.current = syncStatus.state
    if (prev === "syncing" && syncStatus.state === "success") refreshWarnings()
  }, [syncStatus.state, refreshWarnings])

  // ----- Fetch data from Supabase on mount -----
  // If we have SSR data, only fetch sync status (lightweight).
  // If no SSR data (e.g. user not authenticated server-side), do full client fetch.
  useEffect(() => {
    async function loadData() {
      if (hasInitial) {
        // After a fresh Strava OAuth connection the callback redirects to
        // /?strava_connected=1. Detect this and auto-trigger a full sync.
        const params = new URLSearchParams(window.location.search)
        const justConnected = params.get("strava_connected") === "1"

        if (justConnected) {
          // Take the flag out of the URL so a reload does not sync again —
          // and put back everything else it arrived with. This used to hand
          // over `url.pathname` alone, which dropped the rest of the query:
          // an invite followed through a Strava sign-in arrives as
          // ?invite=…&strava_connected=1, and lost the invite here.
          const url = new URL(window.location.href)
          url.searchParams.delete("strava_connected")
          window.history.replaceState({}, "", `${url.pathname}${url.search}`)
          setStravaConnected(true)
        }

        if (
          (justConnected || (initialData?.stravaConnected && initialData.activities.length === 0))
        ) {
          doSync(true)
        }
        return
      }

      // Full client-side fetch (fallback when no SSR data)
      setIsLoading(true)

      const {
        data: { user: authUser },
      } = await supabase.auth.getUser()

      if (!authUser) {
        setIsLoading(false)
        return
      }

      const [activitiesRes, goalsRes, weeklyGoalsRes, profileRes, syncApiRes] =
        await Promise.all([
          fetchAllActivities(supabase),
          supabase
            .from("goals")
            // [DND] include display_order; order by it so the array arrives pre-sorted
            // [STAR] include is_starred for home screen pinned cards
            .select("*")
            .order("display_order", { ascending: true }),
          supabase
            .from("weekly_goals")
            // [DND] include display_order; order by it so the array arrives pre-sorted
            .select("id, metric, label, target, week_start, is_recurring, session_min_duration_minutes, session_min_distance_km, display_order, source, source_goal_id, suggested_target, target_history")
            .order("display_order", { ascending: true }),
          supabase.from("profiles").select("id, display_name, email, avatar_url, onboarding_dismissed_at").eq("id", authUser.id).single(),
          fetch("/api/sync-status").then((r) => r.json()).catch(() => null),
        ])

      setActivities(activitiesRes)

      if (goalsRes.data) {
        setGoals(
          goalsRes.data.map((g) => ({
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
            display_order: g.display_order ?? 0, // [DND]
            is_starred: (g as any).is_starred ?? false, // [STAR]
          }))
        )
      }

      if (weeklyGoalsRes.data) {
        setWeeklyGoals(
          weeklyGoalsRes.data.map((wg) => ({
            id: wg.id,
            metric: wg.metric,
            label: wg.label,
            target: Number(wg.target),
            week_start: wg.week_start,
            is_recurring: wg.is_recurring ?? false,
            session_min_duration_minutes: wg.session_min_duration_minutes ?? null,
            session_min_distance_km: wg.session_min_distance_km ? Number(wg.session_min_distance_km) : null,
            display_order: wg.display_order ?? 0, // [DND]
            // Selected here as well as in the page render: without them a
            // client-side reload would drop "adjusted from" off every card and
            // silence a plan that had moved, until the next full page load.
            source: wg.source ?? "manual",
            source_goal_id: wg.source_goal_id ?? null,
            suggested_target: wg.suggested_target != null ? Number(wg.suggested_target) : null,
            target_history: parseTargetHistory(wg.target_history),
          }))
        )
      }

      if (profileRes.data) {
        setUser({
          id: profileRes.data.id,
          display_name: profileRes.data.display_name ?? authUser.email ?? "Runner",
          email: profileRes.data.email ?? authUser.email ?? "",
          avatar_url: profileRes.data.avatar_url ?? null,
          onboarding_dismissed_at: profileRes.data.onboarding_dismissed_at ?? null,
        })
        setOnboardingDismissedState(profileRes.data.onboarding_dismissed_at != null)
      } else {
        setUser({
          id: authUser.id,
          display_name: authUser.email ?? "Runner",
          email: authUser.email ?? "",
          avatar_url: null,
        })
      }

      if (syncApiRes?.sync_status) {
        setSyncStatus({
          state: syncApiRes.sync_status.state,
          last_sync_at: syncApiRes.sync_status.last_sync_at,
          error_message: syncApiRes.sync_status.error_message,
        })
      }

      setStravaConnected(!!syncApiRes?.strava_connected)
      setIsLoading(false)
    }

    loadData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ----- Derived data -----
  // [STAR] Event goals pinned to the home screen, sorted by user-defined display_order
  const starredGoals = useMemo(
    () =>
      goals
        .filter((g) => g.is_starred)
        .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0)),
    [goals],
  )

  const { currentWeekMonday, weeklySummary } = useMemo(() => {
    const now = new Date()
    const day = now.getDay()
    const diff = day === 0 ? -6 : 1 - day
    const monday = new Date(now)
    monday.setDate(now.getDate() + diff)
    monday.setHours(0, 0, 0, 0)

    const weekActivities = activities.filter(
      (a) => new Date(a.date) >= monday
    )
    return {
      currentWeekMonday: monday,
      weeklySummary: {
        total_distance_km: weekActivities.reduce((s, a) => s + a.distance_km, 0),
        total_time_seconds: weekActivities.reduce(
          (s, a) => s + a.duration_seconds,
          0
        ),
        run_count: weekActivities.length,
      },
    }
  }, [activities])

  const currentWeekGoals = useMemo(() => {
    const p = (n: number) => String(n).padStart(2, "0")
    const mondayStr = `${currentWeekMonday.getFullYear()}-${p(currentWeekMonday.getMonth() + 1)}-${p(currentWeekMonday.getDate())}`
    // Same rule as Plan's week list: a recurring target applies from the week
    // it was set in onwards. It matters here too now that a target can be
    // accepted for next week — a standing goal starting next Monday is not
    // one of this week's.
    return weeklyGoals.filter((wg) =>
      wg.is_recurring ? wg.week_start <= mondayStr : wg.week_start === mondayStr,
    )
  }, [weeklyGoals, currentWeekMonday])

  // ----- Goal CRUD -----
  const toggleActiveGoal = useCallback(async (goalId: string) => {
    const target = goalsRef.current.find((g) => g.id === goalId)
    if (!target) return

    const newActive = !target.is_active
    setGoals((prev) =>
      prev.map((g) => (g.id === goalId ? { ...g, is_active: newActive } : g))
    )

    const { error } = await supabase
      .from("goals")
      .update({ is_active: newActive })
      .eq("id", goalId)

    if (error) {
      logError("Failed to toggle goal active state", error)
      setGoals((prev) =>
        prev.map((g) => (g.id === goalId ? { ...g, is_active: !newActive } : g))
      )
    }
  }, [])

  const saveGoal = useCallback(
    async (saved: Goal): Promise<boolean> => {
      const exists = goalsRef.current.find((g) => g.id === saved.id)

      if (exists) {
        setGoals((prev) => prev.map((g) => (g.id === saved.id ? saved : g)))
        const { error } = await supabase
          .from("goals")
          .update({
            goal_category: saved.goal_category,
            name: saved.name,
            target_distance_km: saved.target_distance_km,
            start_date: saved.start_date,
            target_time_seconds: saved.target_time_seconds,
            target_date: saved.target_date,
            current_distance_km: saved.current_distance_km,
            is_active: saved.is_active,
          })
          .eq("id", saved.id)
        if (error) {
          logError("Failed to update goal", error)
          setGoals((prev) => prev.map((g) => (g.id === saved.id ? exists : g)))
          // toast.error("Failed to save goal")
          return false
        }
        // toast.success("Goal updated")
      } else {
        const { data: authData } = await supabase.auth.getUser()
        const userId = authData.user?.id
        if (!userId) {
          logError("No authenticated user — cannot save goal")
          return false
        }

        const { data, error } = await supabase
          .from("goals")
          .insert({
            goal_category: saved.goal_category,
            name: saved.name,
            user_id: userId,
            target_distance_km: saved.target_distance_km,
            start_date: saved.start_date,
            target_time_seconds: saved.target_time_seconds,
            target_date: saved.target_date,
            current_distance_km: saved.current_distance_km,
            is_active: saved.is_active,
            display_order: goalsRef.current.length + 1, // [DND] new goals go to the end
          })
          .select()
          .single()

        if (error) {
          logError("Failed to create goal", error)
          // toast.error("Failed to create goal")
          return false
        }

        // toast.success("Goal created")
        if (data) {
          setGoals((prev) => [
            ...prev,
            {
              id: data.id,
              goal_category: (data.goal_category ?? "performance") as GoalCategory,
              name: data.name,
              target_distance_km: Number(data.target_distance_km),
              start_date: data.start_date ?? null,
              target_time_seconds: data.target_time_seconds ?? null,
              target_date: data.target_date,
              current_distance_km: Number(data.current_distance_km),
              is_active: data.is_active,
              created_at: data.created_at,
              display_order: data.display_order ?? prev.length + 1, // [DND]
            },
          ])
        }
      }

      return true
    },
    []
  )

  const deleteGoal = useCallback(async (goalId: string) => {
    const snapshot = goalsRef.current
    setGoals((prev) => prev.filter((g) => g.id !== goalId))

    const { error } = await supabase.from("goals").delete().eq("id", goalId)
    if (error) {
      logError("Failed to delete goal", error)
      setGoals(snapshot)
      // toast.error("Failed to delete goal")
    } else {
      // toast.success("Goal deleted")
    }
  }, [])

  // [STAR] Toggle is_starred on a goal (optimistic update)
  const toggleStarGoal = useCallback(async (goalId: string) => {
    const target = goalsRef.current.find((g) => g.id === goalId)
    if (!target) return

    const newStarred = !target.is_starred
    setGoals((prev) =>
      prev.map((g) => (g.id === goalId ? { ...g, is_starred: newStarred } : g))
    )

    const { error } = await supabase
      .from("goals")
      .update({ is_starred: newStarred })
      .eq("id", goalId)

    if (error) {
      logError("Failed to toggle goal star", error)
      setGoals((prev) =>
        prev.map((g) => (g.id === goalId ? { ...g, is_starred: !newStarred } : g))
      )
    }
  }, [])

  // [DND] Reorder race goals by persisting a new display_order for each goal
  const reorderGoals = useCallback(async (orderedIds: string[]) => {
    // Optimistic update: reassign display_order values in the local state
    setGoals((prev) => {
      const byId = new Map(prev.map((g) => [g.id, g]))
      const reordered = orderedIds
        .map((id, i) => {
          const g = byId.get(id)
          return g ? { ...g, display_order: i + 1 } : null
        })
        .filter(Boolean) as Goal[]
      const reorderedSet = new Set(orderedIds)
      return [...reordered, ...prev.filter((g) => !reorderedSet.has(g.id))]
    })
    // Persist to Supabase
    const results = await Promise.all(
      orderedIds.map((id, i) =>
        supabase.from("goals").update({ display_order: i + 1 }).eq("id", id)
      )
    )
    const failed = results.filter((r) => r.error)
    if (failed.length > 0) logError("reorderGoals: failed to persist order", failed.map((r) => r.error))
  }, [])

  // ----- Weekly Goal CRUD -----
  const saveWeeklyGoal = useCallback(
    async (saved: WeeklyGoal): Promise<boolean> => {
      const exists = weeklyGoalsRef.current.find((g) => g.id === saved.id)

      if (exists) {
        setWeeklyGoals((prev) =>
          prev.map((g) => (g.id === saved.id ? saved : g))
        )
        const { error } = await supabase
          .from("weekly_goals")
          .update({
            metric: saved.metric,
            label: saved.label,
            target: saved.target,
            week_start: saved.week_start,
            is_recurring: saved.is_recurring,
            session_min_duration_minutes: saved.session_min_duration_minutes ?? null,
            session_min_distance_km: saved.session_min_distance_km ?? null,
            source: saved.source ?? "manual",
            source_goal_id: saved.source_goal_id ?? null,
            // Carried through an edit rather than cleared. A runner who takes
            // the plan's 42 km and sets 45 has adjusted the suggestion, not
            // replaced it, and the card says so.
            suggested_target: saved.suggested_target ?? null,
            target_history: saved.target_history ?? [],
          })
          .eq("id", saved.id)
        if (error) {
          logError("Failed to update weekly goal", error)
          setWeeklyGoals((prev) =>
            prev.map((g) => (g.id === saved.id ? exists : g))
          )
          // toast.error("Failed to save weekly goal")
          return false
        }
        // toast.success("Weekly goal updated")
      } else {
        const { data: authData } = await supabase.auth.getUser()
        const userId = authData.user?.id
        if (!userId) {
          logError("No authenticated user found — cannot save weekly goal")
          return false
        }

        const { data, error } = await supabase
          .from("weekly_goals")
          .insert({
            user_id: userId,
            metric: saved.metric,
            label: saved.label,
            target: saved.target,
            week_start: saved.week_start,
            is_recurring: saved.is_recurring,
            session_min_duration_minutes: saved.session_min_duration_minutes ?? null,
            session_min_distance_km: saved.session_min_distance_km ?? null,
            source: saved.source ?? "manual",
            source_goal_id: saved.source_goal_id ?? null,
            suggested_target: saved.suggested_target ?? null,
            target_history: saved.target_history ?? [],
          })
          .select()
          .single()

        if (error) {
          logError("Failed to create weekly goal", error)
          // toast.error("Failed to create weekly goal")
          return false
        }

        // toast.success("Weekly goal created")
        if (data) {
          setWeeklyGoals((prev) => [
            {
              id: data.id,
              metric: data.metric,
              label: data.label,
              target: Number(data.target),
              week_start: data.week_start,
              is_recurring: data.is_recurring ?? false,
              session_min_duration_minutes: data.session_min_duration_minutes ?? null,
              session_min_distance_km: data.session_min_distance_km ? Number(data.session_min_distance_km) : null,
              source: data.source ?? "manual",
              source_goal_id: data.source_goal_id ?? null,
              suggested_target: data.suggested_target != null ? Number(data.suggested_target) : null,
              target_history: parseTargetHistory(data.target_history),
            },
            ...prev,
          ])
        }
      }

      return true
    },
    []
  )

  /**
   * Turn down a suggested weekly target for good.
   *
   * Stored against the metric and the race it came from, never the week, so
   * the same offer does not reappear next Monday. Applied to local state
   * first: a card that lingers while the write goes out reads as a dismissal
   * that did not take, and the runner taps it again.
   */
  const dismissSuggestion = useCallback(
    async (metric: WeeklyGoalMetric, sourceGoalId: string | null) => {
      const already = dismissalsRef.current.some(
        (d) => d.metric === metric && d.source_goal_id === sourceGoalId,
      )
      if (already) return

      setDismissals((prev) => [...prev, { metric, source_goal_id: sourceGoalId }])

      const { data: authData } = await supabase.auth.getUser()
      const userId = authData.user?.id
      if (!userId) {
        logError("No authenticated user found — cannot dismiss suggestion")
        setDismissals((prev) =>
          prev.filter((d) => !(d.metric === metric && d.source_goal_id === sourceGoalId)),
        )
        return
      }

      const { error } = await supabase.from("weekly_suggestion_dismissals").insert({
        user_id: userId,
        metric,
        source_goal_id: sourceGoalId,
      })

      if (error) {
        logError("Failed to dismiss weekly suggestion", error)
        setDismissals((prev) =>
          prev.filter((d) => !(d.metric === metric && d.source_goal_id === sourceGoalId)),
        )
      }
    },
    [],
  )

  const deleteWeeklyGoal = useCallback(async (goalId: string) => {
    const snapshot = weeklyGoalsRef.current
    setWeeklyGoals((prev) => prev.filter((g) => g.id !== goalId))

    const { error } = await supabase.from("weekly_goals").delete().eq("id", goalId)
    if (error) {
      logError("Failed to delete weekly goal", error)
      setWeeklyGoals(snapshot)
      // toast.error("Failed to delete weekly goal")
    } else {
      // toast.success("Weekly goal deleted")
    }
  }, [])

  // [DND] Reorder weekly goals by persisting a new display_order for each goal
  const reorderWeeklyGoals = useCallback(async (orderedIds: string[]) => {
    setWeeklyGoals((prev) => {
      const byId = new Map(prev.map((g) => [g.id, g]))
      const reordered = orderedIds
        .map((id, i) => {
          const g = byId.get(id)
          return g ? { ...g, display_order: i + 1 } : null
        })
        .filter(Boolean) as import("@/lib/types").WeeklyGoal[]
      const reorderedSet = new Set(orderedIds)
      return [...reordered, ...prev.filter((g) => !reorderedSet.has(g.id))]
    })
    const results = await Promise.all(
      orderedIds.map((id, i) =>
        supabase.from("weekly_goals").update({ display_order: i + 1 }).eq("id", id)
      )
    )
    const failed = results.filter((r) => r.error)
    if (failed.length > 0) logError("reorderWeeklyGoals: failed to persist order", failed.map((r) => r.error))
  }, [])

  // ----- Add manual activity -----
  const addActivity = useCallback(async (activity: Omit<Activity, "id" | "user_id" | "strava_id" | "created_at">): Promise<boolean> => {
    const { data: authData } = await supabase.auth.getUser()
    const userId = authData.user?.id
    if (!userId) return false

    // Defensive validation — the manual-activity form already checks these,
    // but this hook is also called from other flows and we don't want bad
    // rows landing in the DB (they'd break aggregates and plan generation).
    // The same bounds are enforced by DB CHECK constraints (migration 022)
    // so we fail fast with a clear log rather than relying on the insert
    // error text.
    if (!(activity.distance_km > 0 && activity.distance_km <= 500)) {
      logError("Rejected activity: distance_km out of range", activity.distance_km)
      return false
    }
    if (!(activity.duration_seconds > 0)) {
      logError("Rejected activity: duration_seconds must be positive", activity.duration_seconds)
      return false
    }
    if (
      activity.avg_heart_rate != null &&
      (activity.avg_heart_rate < 30 || activity.avg_heart_rate > 230)
    ) {
      logError("Rejected activity: avg_heart_rate out of range", activity.avg_heart_rate)
      return false
    }
    if (activity.elevation_gain_m != null && activity.elevation_gain_m < 0) {
      logError("Rejected activity: elevation_gain_m negative", activity.elevation_gain_m)
      return false
    }

    const { data, error } = await supabase
      .from("activities")
      .insert({
        user_id: userId,
        strava_id: null,
        type: activity.type,
        name: activity.name,
        date: activity.date,
        distance_km: activity.distance_km,
        duration_seconds: activity.duration_seconds,
        pace_min_per_km: activity.pace_min_per_km,
        elevation_gain_m: activity.elevation_gain_m,
        avg_heart_rate: activity.avg_heart_rate,
        calories: activity.calories,
        map_polyline: null,
      })
      .select()
      .single()

    if (error) {
      logError("Failed to add activity", error)
      // toast.error("Failed to add activity")
      return false
    }

    // toast.success("Activity added")
    if (data) {
      setActivities((prev) => [mapActivityRow(data), ...prev])
    }
    return true
  }, [])

  // ----- Delete activity -----
  const deleteActivity = useCallback(async (activityId: string) => {
    // Optimistic update — remove immediately, rollback on error
    const snapshot = activities
    setActivities((prev) => prev.filter((a) => a.id !== activityId))

    const { error } = await supabase.from("activities").delete().eq("id", activityId)
    if (error) {
      logError("Failed to delete activity", error)
      setActivities(snapshot)
      // toast.error("Failed to delete activity")
      return false
    }

    // toast.success("Activity deleted")
    return true
  }, [activities])

  // ----- Strava Sync -----
  // One sync at a time from this document. The chunk loop below can run for
  // a while on a first full history, and a second caller — the auto-sync on
  // arrival from Strava, a press of Sync now that slipped in before the
  // button disabled itself — would race it into the server's own concurrency
  // guard and surface as an error over a sync that was working.
  const syncing = useRef(false)

  const doSync = useCallback(async (full = false) => {
    if (syncing.current) return
    syncing.current = true
    setSyncStatus((prev) => ({ ...prev, state: "syncing", error_message: null }))

    const url = full ? "/api/sync-strava?full=1" : "/api/sync-strava"

    try {
      for (let chunk = 0; chunk < MAX_SYNC_CHUNKS; chunk++) {
        const res = await fetch(url, { method: "POST" })
        const data = await res.json()

        if (!res.ok) {
          // Strava switched the app's API access off. The athlete's tokens are
          // fine, so sending them through OAuth again would just loop them back
          // to the same 403 — show what is actually wrong instead.
          if (data.code === "STRAVA_APP_INACTIVE") {
            setSyncStatus((prev) => ({
              ...prev,
              state: "error",
              error_message: data.error ?? "Strava has deactivated this app's API access.",
            }))
            return
          }
          if (
            data.code === "STRAVA_NOT_CONNECTED" ||
            data.code === "STRAVA_DISCONNECTED"
          ) {
            setSyncStatus((prev) => ({
              ...prev,
              state: "error",
              error_message: "Strava account disconnected. Reconnecting…",
            }))
            window.location.href = "/api/auth/strava"
            return
          }
          // Someone else got there first. Theirs will finish and its
          // activities are the same ones this run was going to fetch, so
          // this is a state, not a failure — and never a red line.
          if (data.code === "SYNC_IN_PROGRESS") {
            setSyncStatus((prev) => ({ ...prev, state: "syncing", error_message: null }))
            return
          }
          // The last sync finished less than the cooldown ago. Nothing failed
          // and nothing is missing — there has been no time for anything new to
          // appear. Report it as the state it is: synced, just now.
          if (data.code === "SYNC_TOO_SOON") {
            setSyncStatus((prev) => ({
              ...prev,
              state: "success",
              last_sync_at: (data.last_sync_at as string) ?? prev.last_sync_at,
              error_message: null,
            }))
            return
          }
          if (data.code === "STRAVA_RATE_LIMITED") {
            setSyncStatus((prev) => ({
              ...prev,
              state: "rate_limited",
              error_message:
                "Strava is rate limiting the app. The rest of your history arrives shortly — sync again in a few minutes.",
            }))
            setActivities(await fetchAllActivities(supabase))
            return
          }
          setSyncStatus((prev) => ({
            ...prev,
            state: "error",
            error_message: data.error ?? "Sync failed",
          }))
          // toast.error(data.error ?? "Sync failed")
          return
        }

        // The run stopped on Strava's rate limit. What it managed to pull is
        // already saved; the rest needs the next 15-minute window.
        if (data.resumeAt) {
          setSyncStatus((prev) => ({
            ...prev,
            state: "rate_limited",
            error_message:
              "Strava is rate limiting the app. The rest of your history arrives shortly — sync again in a few minutes.",
          }))
          setActivities(await fetchAllActivities(supabase))
          return
        }

        if (data.done === false) {
          // More history to go. Show what has landed so far, then continue.
          setActivities(await fetchAllActivities(supabase))
          continue
        }

        setSyncStatus({
          state: "success",
          last_sync_at: new Date().toISOString(),
          error_message: null,
        })
        // toast.success("Activities synced from Strava")

        setActivities(await fetchAllActivities(supabase))
        return
      }

      // Ran out of chunks without finishing — treat as unfinished, not failed.
      setSyncStatus((prev) => ({
        ...prev,
        state: "partial",
        error_message: "Still catching up on your history. Sync again to continue.",
      }))
    } catch (err) {
      logError("Sync fetch error", err)
      setSyncStatus((prev) => ({
        ...prev,
        state: "error",
        error_message: "Network error. Please try again.",
      }))
      // toast.error("Network error. Please try again.")
    } finally {
      // In a finally, not on each of the loop's several exits: a run that
      // returns early still has to hand the next one its turn.
      syncing.current = false
    }
  }, [])

  const sync = useCallback(() => doSync(false), [doSync])
  const fullSync = useCallback(() => doSync(true), [doSync])

  // ----- Connect Strava via OAuth -----
  const connectStrava = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    // Always use the full OAuth flow so each user authorises their own Strava
    // account. The old bootstrap endpoint (/api/auth/strava/setup) used a
    // single shared refresh token and would bind the wrong athlete to new users.
    window.location.href = "/api/auth/strava"
    return { ok: true }
  }, [])

  // ----- "Get started" checklist -----
  // The write is fire-and-forget on purpose: a failed update must not put the
  // checklist back under the runner's thumb mid-tap. It is a hint about what
  // to show, not training data, so the worst case is that it returns on the
  // next load and has to be closed again.
  const setOnboardingDismissed = useCallback(async (dismissed: boolean) => {
    setOnboardingDismissedState(dismissed)

    const { data: authData } = await supabase.auth.getUser()
    const userId = authData.user?.id
    if (!userId) return

    const dismissedAt = dismissed ? new Date().toISOString() : null
    setUser((prev) => (prev ? { ...prev, onboarding_dismissed_at: dismissedAt } : prev))

    const { error } = await supabase
      .from("profiles")
      .update({ onboarding_dismissed_at: dismissedAt })
      .eq("id", userId)

    if (error) logError("Failed to save the get-started checklist state", error)
  }, [])

  const dismissOnboarding = useCallback(
    () => setOnboardingDismissed(true),
    [setOnboardingDismissed],
  )
  const resumeOnboarding = useCallback(
    () => setOnboardingDismissed(false),
    [setOnboardingDismissed],
  )

  const handleSignOut = useCallback(() => {
    startTransition(async () => {
      await signOut()
    })
  }, [])

  return {
    // Data
    activities,
    goals,
    weeklyGoals,
    user,
    syncStatus,
    stravaConnected,
    isLoading,
    onboardingDismissed,
    testRunActivityIds,
    setTestRunTag,
    warnings,
    planBadges,
    planDigests,
    goalPrefs,
    refreshPlanBadges,
    currentPlanWeeks,
    planSessionStatuses,
    setPlanSessionStatus,
    sharedGoals,
    refreshSharedGoals,
    dismissals,

    // Derived
    starredGoals, // [STAR]
    currentWeekMonday,
    weeklySummary,
    currentWeekGoals,

    // Goal operations
    toggleActiveGoal,
    toggleStarGoal, // [STAR]
    saveGoal,
    deleteGoal,
    reorderGoals, // [DND]

    // Weekly goal operations
    saveWeeklyGoal,
    deleteWeeklyGoal,
    reorderWeeklyGoals, // [DND]
    dismissSuggestion,

    // Activities
    addActivity,
    deleteActivity,

    // Sync
    sync,
    fullSync,
    connectStrava,

    // Get started
    dismissOnboarding,
    resumeOnboarding,

    // Auth
    signOut: handleSignOut,
  }
}
