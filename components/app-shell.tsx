"use client"

import { useState, useCallback, lazy, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { TabBar } from "@/components/tab-bar"
import { HomeScreen } from "@/components/screens/home-screen"
import { ActivitiesScreen } from "@/components/screens/activities-screen"
import { GoalsScreen } from "@/components/screens/goals-screen"
import { PlanScreen } from "@/components/screens/plan-screen"
import { GoalEditor } from "@/components/goal-editor"
import { WeeklyGoalEditor } from "@/components/weekly-goal-editor"
import { useAppData, type InitialData } from "@/hooks/use-app-data"
import type { TabId, Activity, Goal, GoalCategory, WeeklyGoal } from "@/lib/types"

const VALID_TABS = new Set<TabId>(["home", "activities", "goals", "plan", "profile"])

// Lazy-load heavy screens (ActivityDetail pulls in Recharts ~200KB, GoalDetail pulls in AI plan UI)
const ActivityDetailScreen = lazy(() => import("@/components/screens/activity-detail-screen").then(m => ({ default: m.ActivityDetailScreen })))
const GoalDetailScreen = lazy(() => import("@/components/screens/goal-detail-screen").then(m => ({ default: m.GoalDetailScreen })))
const ProfileScreen = lazy(() => import("@/components/screens/profile-screen").then(m => ({ default: m.ProfileScreen })))

function ScreenFallback() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  )
}

interface AppShellProps {
  initialData?: InitialData | null
}

export function AppShell({ initialData }: AppShellProps) {
  const data = useAppData(initialData)
  const searchParams = useSearchParams()
  const router = useRouter()

  // Read navigation state from URL
  const urlTab = searchParams.get("tab") as TabId | null
  const activeTab: TabId = urlTab && VALID_TABS.has(urlTab) ? urlTab : "home"
  const activityId = searchParams.get("activity")
  const goalId = searchParams.get("goal")

  // Resolve selected items from URL IDs
  const selectedActivity = activityId
    ? data.activities.find((a) => a.id === activityId) ?? null
    : null
  const selectedGoal = goalId
    ? data.goals.find((g) => g.id === goalId) ?? null
    : null

  // Editor state
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [isNewGoal, setIsNewGoal] = useState(false)
  const [defaultGoalCategory, setDefaultGoalCategory] = useState<GoalCategory>("performance")
  const [editingWeeklyGoal, setEditingWeeklyGoal] = useState<WeeklyGoal | null>(null)
  const [isWeeklyEditorOpen, setIsWeeklyEditorOpen] = useState(false)
  const [isNewWeeklyGoal, setIsNewWeeklyGoal] = useState(false)

  // ----- URL navigation helpers -----
  const navigate = useCallback((params: Record<string, string | null>) => {
    const sp = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(params)) {
      if (value === null) sp.delete(key)
      else sp.set(key, value)
    }
    const qs = sp.toString()
    router.push(qs ? `/?${qs}` : "/", { scroll: false })
  }, [searchParams, router])

  const handleTabChange = useCallback((tab: TabId) => {
    navigate(tab === "home"
      ? { tab: null, activity: null, goal: null }
      : { tab, activity: null, goal: null })
  }, [navigate])

  const handleSelectGoal = useCallback((goal: Goal) => {
    navigate({ goal: goal.id })
  }, [navigate])

  const handleBackFromGoalDetail = useCallback(() => {
    navigate({ goal: null })
  }, [navigate])

  const handleSelectActivity = useCallback((activity: Activity) => {
    navigate({ activity: activity.id })
  }, [navigate])

  const handleBackFromDetail = useCallback(() => {
    navigate({ activity: null })
  }, [navigate])

  // ----- Editor handlers (thin wrappers around data hook) -----
  const handleEditGoal = useCallback((goal: Goal) => {
    setEditingGoal(goal)
    setIsNewGoal(false)
    setIsEditorOpen(true)
  }, [])

  const handleAddGoal = useCallback((category: GoalCategory = "performance") => {
    setDefaultGoalCategory(category)
    setEditingGoal(null)
    setIsNewGoal(true)
    setIsEditorOpen(true)
  }, [])

  const handleSaveGoal = useCallback(async (saved: Goal) => {
    const ok = await data.saveGoal(saved)
    if (ok) setIsEditorOpen(false)
  }, [data.saveGoal])

  const handleDeleteGoal = useCallback(async (goalId: string) => {
    await data.deleteGoal(goalId)
    setIsEditorOpen(false)
  }, [data.deleteGoal])

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

  const handleSaveWeeklyGoal = useCallback(async (saved: WeeklyGoal) => {
    const ok = await data.saveWeeklyGoal(saved)
    if (ok) setIsWeeklyEditorOpen(false)
  }, [data.saveWeeklyGoal])

  const handleDeleteWeeklyGoal = useCallback(async (goalId: string) => {
    await data.deleteWeeklyGoal(goalId)
    setIsWeeklyEditorOpen(false)
  }, [data.deleteWeeklyGoal])

  const handleCloseWeeklyEditor = useCallback(() => {
    setIsWeeklyEditorOpen(false)
  }, [])

  // ----- Loading state -----
  if (data.isLoading) {
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
            activeGoals={data.activeGoals}
            activities={data.activities}
            weeklySummary={data.weeklySummary}
            weeklyGoals={data.currentWeekGoals}
            currentWeekStart={data.currentWeekMonday.toISOString()}
            recentActivities={data.activities.slice(0, 5)}
            onViewActivities={() => handleTabChange("activities")}
            onViewGoal={() => handleTabChange("goals")}
          />
        )}

        {activeTab === "activities" && !selectedActivity && (
          <ActivitiesScreen
            activities={data.activities}
            stravaConnected={data.stravaConnected}
            onSelectActivity={handleSelectActivity}
            onSync={data.sync}
          />
        )}

        {activeTab === "activities" && selectedActivity && (
          <Suspense fallback={<ScreenFallback />}>
            <ActivityDetailScreen
              activity={selectedActivity}
              onBack={handleBackFromDetail}
            />
          </Suspense>
        )}

        {activeTab === "goals" && (
          <GoalsScreen
            goals={data.goals}
            activities={data.activities}
            weeklyGoals={data.weeklyGoals}
            onToggleActive={data.toggleActiveGoal}
            onEditGoal={handleEditGoal}
            onAddGoal={() => handleAddGoal("performance")}
            onEditWeeklyGoal={handleEditWeeklyGoal}
            onAddWeeklyGoal={handleAddWeeklyGoal}
          />
        )}

        {activeTab === "plan" && !selectedGoal && (
          <PlanScreen
            goals={data.goals}
            activities={data.activities}
            onEditGoal={handleEditGoal}
            onAddGoal={() => handleAddGoal("event_training")}
            onToggleActive={data.toggleActiveGoal}
            onSelectGoal={handleSelectGoal}
          />
        )}

        {activeTab === "plan" && selectedGoal && (
          <Suspense fallback={<ScreenFallback />}>
            <GoalDetailScreen
              goal={selectedGoal}
              activities={data.activities}
              onBack={handleBackFromGoalDetail}
              onEditGoal={handleEditGoal}
            />
          </Suspense>
        )}

        {activeTab === "profile" && (
          <Suspense fallback={<ScreenFallback />}>
            <ProfileScreen
              user={data.user ?? { id: "", display_name: "Runner", email: "", avatar_url: null }}
              syncStatus={data.syncStatus}
              stravaConnected={data.stravaConnected}
              onSync={data.sync}
              onFullSync={data.fullSync}
              onSignOut={data.signOut}
            />
          </Suspense>
        )}
      </main>

      {/* Goal Editor Sheet */}
      <GoalEditor
        goal={editingGoal}
        isNew={isNewGoal}
        defaultCategory={defaultGoalCategory}
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
