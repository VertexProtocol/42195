"use client"

import { useState, useCallback, useEffect, useTransition, useMemo } from "react"
import { TabBar } from "@/components/tab-bar"
import { HomeScreen } from "@/components/screens/home-screen"
import { ActivitiesScreen } from "@/components/screens/activities-screen"
import { ActivityDetailScreen } from "@/components/screens/activity-detail-screen"
import { GoalsScreen } from "@/components/screens/goals-screen"
import { GoalEditor } from "@/components/goal-editor"
import { WeeklyGoalEditor } from "@/components/weekly-goal-editor"
import { ProfileScreen } from "@/components/screens/profile-screen"
import { signOut } from "@/lib/actions/auth"
import { createClient } from "@/lib/supabase/client"
import type { TabId, Activity, Goal, WeeklyGoal, SyncStatus, UserProfile } from "@/lib/types"

const supabase = createClient()

export function AppShell() {
  const [activeTab, setActiveTab] = useState<TabId>("home")
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null)
  const [isDarkMode, setIsDarkMode] = useState(false)

  // Real data state (starts empty, loaded from Supabase)
  const [activities, setActivities] = useState<Activity[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [weeklyGoals, setWeeklyGoals] = useState<WeeklyGoal[]>([])
  const [user, setUser] = useState<UserProfile | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    state: "never",
    last_sync_at: null,
    error_message: null,
  })
  const [stravaConnected, setStravaConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  // Editor state
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [isNewGoal, setIsNewGoal] = useState(false)
  const [editingWeeklyGoal, setEditingWeeklyGoal] = useState<WeeklyGoal | null>(null)
  const [isWeeklyEditorOpen, setIsWeeklyEditorOpen] = useState(false)
  const [isNewWeeklyGoal, setIsNewWeeklyGoal] = useState(false)

  const [, startTransition] = useTransition()

  // ----- Fetch all data from Supabase on mount -----
  useEffect(() => {
    async function loadData() {
      setIsLoading(true)

      const {
        data: { user: authUser },
      } = await supabase.auth.getUser()

      if (!authUser) {
        setIsLoading(false)
        return
      }

      // Fetch everything in parallel
      const [activitiesRes, goalsRes, weeklyGoalsRes, profileRes, syncStatusRes, stravaRes] =
        await Promise.all([
          supabase
            .from("activities")
            .select("*")
            .order("date", { ascending: false }),
          supabase
            .from("goals")
            .select("*")
            .order("created_at", { ascending: false }),
          supabase
            .from("weekly_goals")
            .select("*")
            .order("created_at", { ascending: false }),
          supabase.from("profiles").select("*").eq("id", authUser.id).single(),
          supabase
            .from("sync_status")
            .select("*")
            .eq("user_id", authUser.id)
            .maybeSingle(),
          supabase
            .from("strava_tokens")
            .select("athlete_id")
            .eq("user_id", authUser.id)
            .maybeSingle(),
        ])

      if (activitiesRes.data) {
        setActivities(
          activitiesRes.data.map((a) => ({
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
          }))
        )
      }

      if (goalsRes.data) {
        setGoals(
          goalsRes.data.map((g) => ({
            id: g.id,
            user_id: g.user_id,
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
            user_id: wg.user_id,
            metric: wg.metric,
            label: wg.label,
            target: Number(wg.target),
            current: Number(wg.current),
            week_start: wg.week_start,
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
        // Fallback user from auth
        setUser({
          id: authUser.id,
          display_name: authUser.email ?? "Runner",
          email: authUser.email ?? "",
          avatar_url: null,
        })
      }

      if (syncStatusRes.data) {
        setSyncStatus({
          state: syncStatusRes.data.state,
          last_sync_at: syncStatusRes.data.last_sync_at,
          error_message: syncStatusRes.data.error_message,
        })
      }

      setStravaConnected(!!stravaRes.data)
      setIsLoading(false)
    }

    loadData()
  }, [])

  // ----- Dark mode -----
  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDarkMode)
  }, [isDarkMode])

  const handleToggleDarkMode = useCallback(() => {
    setIsDarkMode((prev) => !prev)
  }, [])

  // ----- Derived data -----
  const activeGoals = goals.filter((g) => g.is_active)

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

  // Only show weekly goals that belong to the current week (for HomeScreen)
  const currentWeekGoals = useMemo(() => {
    const p = (n: number) => String(n).padStart(2, "0")
    const mondayStr = `${currentWeekMonday.getFullYear()}-${p(currentWeekMonday.getMonth() + 1)}-${p(currentWeekMonday.getDate())}`
    return weeklyGoals.filter((wg) => wg.week_start === mondayStr)
  }, [weeklyGoals, currentWeekMonday])

  // ----- Navigation -----
  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab)
    setSelectedActivity(null)
  }, [])

  const handleSelectActivity = useCallback((activity: Activity) => {
    setSelectedActivity(activity)
  }, [])

  const handleBackFromDetail = useCallback(() => {
    setSelectedActivity(null)
  }, [])

  // ----- Goal CRUD (persisted to Supabase) -----
  const handleToggleActiveGoal = useCallback(async (goalId: string) => {
    let newActive = false

    // Optimistic update using functional setter to avoid stale closure
    setGoals((prev) =>
      prev.map((g) => {
        if (g.id === goalId) {
          newActive = !g.is_active
          return { ...g, is_active: newActive }
        }
        return g
      })
    )

    const { error } = await supabase
      .from("goals")
      .update({ is_active: newActive })
      .eq("id", goalId)

    if (error) {
      // Revert on failure
      setGoals((prev) =>
        prev.map((g) =>
          g.id === goalId ? { ...g, is_active: !newActive } : g
        )
      )
    }
  }, [])

  const handleEditGoal = useCallback((goal: Goal) => {
    setEditingGoal(goal)
    setIsNewGoal(false)
    setIsEditorOpen(true)
  }, [])

  const handleAddGoal = useCallback(() => {
    setEditingGoal(null)
    setIsNewGoal(true)
    setIsEditorOpen(true)
  }, [])

  const handleSaveGoal = useCallback(
    async (saved: Goal) => {
      const exists = goals.find((g) => g.id === saved.id)

      if (exists) {
        // Update existing goal
        setGoals((prev) =>
          prev.map((g) => (g.id === saved.id ? saved : g))
        )
        await supabase
          .from("goals")
          .update({
            name: saved.name,
            target_distance_km: saved.target_distance_km,
            start_date: saved.start_date,
            target_time_seconds: saved.target_time_seconds,
            target_date: saved.target_date,
            current_distance_km: saved.current_distance_km,
            is_active: saved.is_active,
          })
          .eq("id", saved.id)
      } else {
        // Insert new goal
        const { data: authData } = await supabase.auth.getUser()
        const userId = authData.user?.id
        if (!userId) return

        const { data, error } = await supabase
          .from("goals")
          .insert({
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

        if (!error && data) {
          setGoals((prev) => [
            {
              id: data.id,
              user_id: data.user_id,
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

      setIsEditorOpen(false)
    },
    [goals]
  )

  const handleDeleteGoal = useCallback(async (goalId: string) => {
    setGoals((prev) => prev.filter((g) => g.id !== goalId))
    setIsEditorOpen(false)

    await supabase.from("goals").delete().eq("id", goalId)
  }, [])

  const handleCloseEditor = useCallback(() => {
    setIsEditorOpen(false)
  }, [])

  // ----- Weekly Goal CRUD (persisted to Supabase) -----
  const handleEditWeeklyGoal = useCallback((goal: WeeklyGoal) => {
    setEditingWeeklyGoal(goal)
    setIsNewWeeklyGoal(false)
    setIsWeeklyEditorOpen(true)
  }, [])

  const handleAddWeeklyGoal = useCallback(() => {
    setEditingWeeklyGoal(null)
    setIsNewWeeklyGoal(true)
    setIsWeeklyEditorOpen(true)
  }, [])

  const handleSaveWeeklyGoal = useCallback(
    async (saved: WeeklyGoal) => {
      const exists = weeklyGoals.find((g) => g.id === saved.id)

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
          })
          .eq("id", saved.id)
        if (error) {
          console.error("Failed to update weekly goal:", error)
          // revert optimistic update
          setWeeklyGoals((prev) =>
            prev.map((g) => (g.id === saved.id ? exists : g))
          )
          return // keep editor open so user knows something went wrong
        }
      } else {
        const { data: authData } = await supabase.auth.getUser()
        const userId = authData.user?.id
        if (!userId) {
          console.error("No authenticated user found — cannot save weekly goal")
          return
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
          })
          .select()
          .single()

        if (error) {
          console.error("Failed to create weekly goal:", error)
          return // keep editor open
        }

        if (data) {
          setWeeklyGoals((prev) => [
            {
              id: data.id,
              metric: data.metric,
              label: data.label,
              target: Number(data.target),
              current: Number(data.current),
              week_start: data.week_start,
            },
            ...prev,
          ])
        }
      }

      setIsWeeklyEditorOpen(false)
    },
    [weeklyGoals]
  )

  const handleDeleteWeeklyGoal = useCallback(async (goalId: string) => {
    setWeeklyGoals((prev) => prev.filter((g) => g.id !== goalId))
    setIsWeeklyEditorOpen(false)

    await supabase.from("weekly_goals").delete().eq("id", goalId)
  }, [])

  const handleCloseWeeklyEditor = useCallback(() => {
    setIsWeeklyEditorOpen(false)
  }, [])

  // ----- Strava Sync -----
  const handleSync = useCallback(async () => {
    setSyncStatus((prev) => ({ ...prev, state: "syncing", error_message: null }))

    try {
      const res = await fetch("/api/sync-strava", { method: "POST" })
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
        return
      }

      setSyncStatus({
        state: "success",
        last_sync_at: new Date().toISOString(),
        error_message: null,
      })

      // Refetch activities after successful sync
      const { data: freshActivities } = await supabase
        .from("activities")
        .select("*")
        .order("date", { ascending: false })

      if (freshActivities) {
        setActivities(
          freshActivities.map((a) => ({
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
          }))
        )
      }
    } catch {
      setSyncStatus((prev) => ({
        ...prev,
        state: "error",
        error_message: "Network error. Please try again.",
      }))
    }
  }, [])

  const handleSignOut = useCallback(() => {
    startTransition(async () => {
      await signOut()
    })
  }, [])

  // ----- Loading state -----
  if (isLoading) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto min-h-dvh max-w-md bg-background">
      {/* Screen content */}
      <main className="relative pb-20">
        {activeTab === "home" && (
          <HomeScreen
            activeGoals={activeGoals}
            activities={activities}
            weeklySummary={weeklySummary}
            weeklyGoals={currentWeekGoals}
            currentWeekStart={currentWeekMonday.toISOString()}
            recentActivities={activities.slice(0, 5)}
            onViewActivities={() => handleTabChange("activities")}
            onViewGoal={() => handleTabChange("goals")}
          />
        )}

        {activeTab === "activities" && !selectedActivity && (
          <ActivitiesScreen
            activities={activities}
            stravaConnected={stravaConnected}
            onSelectActivity={handleSelectActivity}
            onSync={handleSync}
          />
        )}

        {activeTab === "activities" && selectedActivity && (
          <ActivityDetailScreen
            activity={selectedActivity}
            onBack={handleBackFromDetail}
          />
        )}

        {activeTab === "goals" && (
          <GoalsScreen
            goals={goals}
            activities={activities}
            weeklyGoals={weeklyGoals}
            onToggleActive={handleToggleActiveGoal}
            onEditGoal={handleEditGoal}
            onAddGoal={handleAddGoal}
            onEditWeeklyGoal={handleEditWeeklyGoal}
            onAddWeeklyGoal={handleAddWeeklyGoal}
          />
        )}

        {activeTab === "profile" && (
          <ProfileScreen
            user={user ?? { id: "", display_name: "Runner", email: "", avatar_url: null }}
            syncStatus={syncStatus}
            stravaConnected={stravaConnected}
            isDarkMode={isDarkMode}
            onToggleDarkMode={handleToggleDarkMode}
            onSync={handleSync}
            onSignOut={handleSignOut}
          />
        )}
      </main>

      {/* Goal Editor Sheet */}
      <GoalEditor
        goal={editingGoal}
        isNew={isNewGoal}
        open={isEditorOpen}
        onSave={handleSaveGoal}
        onDelete={handleDeleteGoal}
        onClose={handleCloseEditor}
      />

      {/* Weekly Goal Editor Sheet */}
      <WeeklyGoalEditor
        goal={editingWeeklyGoal}
        isNew={isNewWeeklyGoal}
        open={isWeeklyEditorOpen}
        onSave={handleSaveWeeklyGoal}
        onDelete={handleDeleteWeeklyGoal}
        onClose={handleCloseWeeklyEditor}
      />

      {/* Bottom Tab Bar */}
      <TabBar activeTab={activeTab} onTabChange={handleTabChange} />
    </div>
  )
}
