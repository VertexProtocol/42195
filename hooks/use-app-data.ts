"use client"

import { useState, useCallback, useEffect, useTransition, useMemo, useRef } from "react"
import { signOut } from "@/lib/actions/auth"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import type { Activity, Goal, GoalCategory, WeeklyGoal, SyncStatus, UserProfile } from "@/lib/types"

const supabase = createClient()

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapActivityRow(a: any): Activity {
  return {
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
  }
}

export interface InitialData {
  activities: Activity[]
  goals: Goal[]
  weeklyGoals: WeeklyGoal[]
  user: UserProfile
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

  // Refs to latest state — avoids stale closures in useCallback without
  // putting mutable arrays in dependency lists (which would recreate every callback on each change).
  const goalsRef = useRef(goals)
  goalsRef.current = goals
  const weeklyGoalsRef = useRef(weeklyGoals)
  weeklyGoalsRef.current = weeklyGoals

  const [, startTransition] = useTransition()

  // ----- Fetch data from Supabase on mount -----
  // If we have SSR data, only fetch sync status (lightweight).
  // If no SSR data (e.g. user not authenticated server-side), do full client fetch.
  useEffect(() => {
    async function loadData() {
      if (hasInitial) {
        // SSR data already includes sync status — nothing to fetch
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
          fetch("/api/sync-status").then((r) => r.json()).catch(() => null),
        ])

      if (activitiesRes.data) {
        setActivities(activitiesRes.data.map(mapActivityRow))
      }

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
            current: Number(wg.current),
            week_start: wg.week_start,
            is_recurring: wg.is_recurring ?? false,
            session_min_duration_minutes: wg.session_min_duration_minutes ?? null,
            session_min_distance_km: wg.session_min_distance_km ? Number(wg.session_min_distance_km) : null,
          }))
        )
      }

      if (profileRes.data) {
        setUser({
          id: profileRes.data.id,
          display_name: profileRes.data.display_name ?? authUser.email ?? "Runner",
          email: profileRes.data.email ?? authUser.email ?? "",
          avatar_url: profileRes.data.avatar_url ?? null,
        })
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
  const activeGoals = useMemo(() => goals.filter((g) => g.is_active), [goals])

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
    return weeklyGoals.filter((wg) => wg.is_recurring || wg.week_start === mondayStr)
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
      console.error("Failed to toggle goal active state:", error)
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
          console.error("Failed to update goal:", error)
          setGoals((prev) => prev.map((g) => (g.id === saved.id ? exists : g)))
          toast.error("Failed to save goal")
          return false
        }
        toast.success("Goal updated")
      } else {
        const { data: authData } = await supabase.auth.getUser()
        const userId = authData.user?.id
        if (!userId) {
          console.error("No authenticated user — cannot save goal")
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
          })
          .select()
          .single()

        if (error) {
          console.error("Failed to create goal:", error)
          toast.error("Failed to create goal")
          return false
        }

        toast.success("Goal created")
        if (data) {
          setGoals((prev) => [
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
            },
            ...prev,
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
      console.error("Failed to delete goal:", error)
      setGoals(snapshot)
      toast.error("Failed to delete goal")
    } else {
      toast.success("Goal deleted")
    }
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
            current: saved.current,
            week_start: saved.week_start,
            is_recurring: saved.is_recurring,
            session_min_duration_minutes: saved.session_min_duration_minutes ?? null,
            session_min_distance_km: saved.session_min_distance_km ?? null,
          })
          .eq("id", saved.id)
        if (error) {
          console.error("Failed to update weekly goal:", error)
          setWeeklyGoals((prev) =>
            prev.map((g) => (g.id === saved.id ? exists : g))
          )
          toast.error("Failed to save weekly goal")
          return false
        }
        toast.success("Weekly goal updated")
      } else {
        const { data: authData } = await supabase.auth.getUser()
        const userId = authData.user?.id
        if (!userId) {
          console.error("No authenticated user found — cannot save weekly goal")
          return false
        }

        const { data, error } = await supabase
          .from("weekly_goals")
          .insert({
            user_id: userId,
            metric: saved.metric,
            label: saved.label,
            target: saved.target,
            current: 0,
            week_start: saved.week_start,
            is_recurring: saved.is_recurring,
            session_min_duration_minutes: saved.session_min_duration_minutes ?? null,
            session_min_distance_km: saved.session_min_distance_km ?? null,
          })
          .select()
          .single()

        if (error) {
          console.error("Failed to create weekly goal:", error)
          toast.error("Failed to create weekly goal")
          return false
        }

        toast.success("Weekly goal created")
        if (data) {
          setWeeklyGoals((prev) => [
            {
              id: data.id,
              metric: data.metric,
              label: data.label,
              target: Number(data.target),
              current: Number(data.current),
              week_start: data.week_start,
              is_recurring: data.is_recurring ?? false,
              session_min_duration_minutes: data.session_min_duration_minutes ?? null,
              session_min_distance_km: data.session_min_distance_km ? Number(data.session_min_distance_km) : null,
            },
            ...prev,
          ])
        }
      }

      return true
    },
    []
  )

  const deleteWeeklyGoal = useCallback(async (goalId: string) => {
    const snapshot = weeklyGoalsRef.current
    setWeeklyGoals((prev) => prev.filter((g) => g.id !== goalId))

    const { error } = await supabase.from("weekly_goals").delete().eq("id", goalId)
    if (error) {
      console.error("Failed to delete weekly goal:", error)
      setWeeklyGoals(snapshot)
      toast.error("Failed to delete weekly goal")
    } else {
      toast.success("Weekly goal deleted")
    }
  }, [])

  // ----- Add manual activity -----
  const addActivity = useCallback(async (activity: Omit<Activity, "id" | "user_id" | "strava_id" | "created_at">): Promise<boolean> => {
    const { data: authData } = await supabase.auth.getUser()
    const userId = authData.user?.id
    if (!userId) return false

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
      console.error("Failed to add activity:", error)
      toast.error("Failed to add activity")
      return false
    }

    toast.success("Activity added")
    if (data) {
      setActivities((prev) => [mapActivityRow(data), ...prev])
    }
    return true
  }, [])

  // ----- Delete activity (from app only, not from Strava) -----
  const activitiesRef = useRef(activities)
  activitiesRef.current = activities

  const deleteActivity = useCallback(async (activityId: string) => {
    const snapshot = activitiesRef.current
    setActivities((prev) => prev.filter((a) => a.id !== activityId))

    const { error } = await supabase.from("activities").delete().eq("id", activityId)
    if (error) {
      console.error("Failed to delete activity:", error)
      setActivities(snapshot)
      toast.error("Failed to delete activity")
      return false
    }
    toast.success("Activity deleted")
    return true
  }, [])

  // ----- Strava Sync -----
  const doSync = useCallback(async (full = false) => {
    setSyncStatus((prev) => ({ ...prev, state: "syncing", error_message: null }))

    try {
      const url = full ? "/api/sync-strava?full=1" : "/api/sync-strava"
      const res = await fetch(url, { method: "POST" })
      const data = await res.json()

      if (!res.ok) {
        if (
          data.error?.includes("No Strava account connected") ||
          data.error?.includes("connect Strava")
        ) {
          window.location.href = "/api/auth/strava"
          return
        }
        setSyncStatus((prev) => ({
          ...prev,
          state: "error",
          error_message: data.error ?? "Sync failed",
        }))
        toast.error(data.error ?? "Sync failed")
        return
      }

      setSyncStatus({
        state: "success",
        last_sync_at: new Date().toISOString(),
        error_message: null,
      })
      toast.success("Activities synced from Strava")

      const { data: freshActivities } = await supabase
        .from("activities")
        .select("id, user_id, strava_id, type, name, date, distance_km, duration_seconds, pace_min_per_km, elevation_gain_m, avg_heart_rate, calories, map_polyline, created_at")
        .order("date", { ascending: false })

      if (freshActivities) {
        setActivities(freshActivities.map(mapActivityRow))
      }
    } catch {
      setSyncStatus((prev) => ({
        ...prev,
        state: "error",
        error_message: "Network error. Please try again.",
      }))
      toast.error("Network error. Please try again.")
    }
  }, [])

  const sync = useCallback(() => doSync(false), [doSync])
  const fullSync = useCallback(() => doSync(true), [doSync])

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

    // Derived
    activeGoals,
    currentWeekMonday,
    weeklySummary,
    currentWeekGoals,

    // Goal operations
    toggleActiveGoal,
    saveGoal,
    deleteGoal,

    // Weekly goal operations
    saveWeeklyGoal,
    deleteWeeklyGoal,

    // Activities
    addActivity,
    deleteActivity,

    // Sync
    sync,
    fullSync,

    // Auth
    signOut: handleSignOut,
  }
}
