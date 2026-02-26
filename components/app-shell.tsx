"use client"

import { useState, useCallback, useEffect, useTransition } from "react"
import { TabBar } from "@/components/tab-bar"
import { HomeScreen } from "@/components/screens/home-screen"
import { ActivitiesScreen } from "@/components/screens/activities-screen"
import { ActivityDetailScreen } from "@/components/screens/activity-detail-screen"
import { GoalsScreen } from "@/components/screens/goals-screen"
import { GoalEditor } from "@/components/goal-editor"
import { WeeklyGoalEditor } from "@/components/weekly-goal-editor"
import { ProfileScreen } from "@/components/screens/profile-screen"
import {
  mockActivities,
  mockGoals,
  mockWeeklyGoals,
  mockSyncStatus,
  mockUser,
} from "@/lib/mock-data"
import { signOut } from "@/lib/actions/auth"
import type { TabId, Activity, Goal, WeeklyGoal, SyncStatus } from "@/lib/types"

export function AppShell() {
  const [activeTab, setActiveTab] = useState<TabId>("home")
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null)
  const [goals, setGoals] = useState<Goal[]>(mockGoals)
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [isNewGoal, setIsNewGoal] = useState(false)
  const [weeklyGoals, setWeeklyGoals] = useState<WeeklyGoal[]>(mockWeeklyGoals)
  const [editingWeeklyGoal, setEditingWeeklyGoal] = useState<WeeklyGoal | null>(null)
  const [isWeeklyEditorOpen, setIsWeeklyEditorOpen] = useState(false)
  const [isNewWeeklyGoal, setIsNewWeeklyGoal] = useState(false)

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDarkMode)
  }, [isDarkMode])

  const handleToggleDarkMode = useCallback(() => {
    setIsDarkMode((prev) => !prev)
  }, [])

  const activeGoals = goals.filter((g) => g.is_active)

  // Compute weekly summary from activities
  const weeklySummary = (() => {
    const now = new Date()
    const day = now.getDay()
    const diff = day === 0 ? -6 : 1 - day
    const monday = new Date(now)
    monday.setDate(now.getDate() + diff)
    monday.setHours(0, 0, 0, 0)

    const weekActivities = mockActivities.filter(
      (a) => new Date(a.date) >= monday
    )
    return {
      total_distance_km: weekActivities.reduce((s, a) => s + a.distance_km, 0),
      total_time_seconds: weekActivities.reduce((s, a) => s + a.duration_seconds, 0),
      run_count: weekActivities.length,
    }
  })()

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

  const handleToggleActiveGoal = useCallback((goalId: string) => {
    setGoals((prev) =>
      prev.map((g) =>
        g.id === goalId ? { ...g, is_active: !g.is_active } : g
      )
    )
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

  const handleSaveGoal = useCallback((saved: Goal) => {
    setGoals((prev) => {
      const exists = prev.find((g) => g.id === saved.id)
      if (exists) {
        return prev.map((g) => (g.id === saved.id ? saved : g))
      }
      return [...prev, saved]
    })
    setIsEditorOpen(false)
  }, [])

  const handleDeleteGoal = useCallback((goalId: string) => {
    setGoals((prev) => prev.filter((g) => g.id !== goalId))
    setIsEditorOpen(false)
  }, [])

  const handleCloseEditor = useCallback(() => {
    setIsEditorOpen(false)
  }, [])

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

  const handleSaveWeeklyGoal = useCallback((saved: WeeklyGoal) => {
    setWeeklyGoals((prev) => {
      const exists = prev.find((g) => g.id === saved.id)
      if (exists) {
        return prev.map((g) => (g.id === saved.id ? saved : g))
      }
      return [...prev, saved]
    })
    setIsWeeklyEditorOpen(false)
  }, [])

  const handleDeleteWeeklyGoal = useCallback((goalId: string) => {
    setWeeklyGoals((prev) => prev.filter((g) => g.id !== goalId))
    setIsWeeklyEditorOpen(false)
  }, [])

  const handleCloseWeeklyEditor = useCallback(() => {
    setIsWeeklyEditorOpen(false)
  }, [])

  const [syncStatus, setSyncStatus] = useState<SyncStatus>(mockSyncStatus)
  const [isPending, startTransition] = useTransition()

  const handleSync = useCallback(async () => {
    setSyncStatus((prev) => ({ ...prev, state: "syncing", error_message: null }))

    try {
      const res = await fetch("/api/sync-strava", { method: "POST" })
      const data = await res.json()

      if (!res.ok) {
        // If no Strava tokens exist, redirect to connect Strava
        if (data.error?.includes("No Strava account connected") || data.error?.includes("connect Strava")) {
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

  return (
    <div className="mx-auto min-h-dvh max-w-md bg-background">
      {/* Screen content */}
      <main className="relative">
        {activeTab === "home" && (
          <HomeScreen
            activeGoals={activeGoals}
            weeklySummary={weeklySummary}
            weeklyGoals={weeklyGoals}
            onViewActivities={() => handleTabChange("activities")}
            onViewGoal={() => handleTabChange("goals")}
          />
        )}

        {activeTab === "activities" && !selectedActivity && (
          <ActivitiesScreen
            activities={mockActivities}
            onSelectActivity={handleSelectActivity}
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
            user={mockUser}
            syncStatus={syncStatus}
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
