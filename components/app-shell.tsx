"use client"

import { useState, useCallback, useEffect, useSyncExternalStore, lazy, Suspense } from "react"
import { useI18n, type Locale } from "@/lib/i18n"
import { TabBar } from "@/components/tab-bar"
import { HomeScreen } from "@/components/screens/home-screen"
import { ActivitiesScreen } from "@/components/screens/activities-screen"
import { GoalsScreen } from "@/components/screens/goals-screen"
import { GoalEditor } from "@/components/goal-editor"
import { WeeklyGoalEditor } from "@/components/weekly-goal-editor"
import { ManualActivityForm } from "@/components/manual-activity-form"
import { Onboarding } from "@/components/onboarding"
import { useAppData, type InitialData } from "@/hooks/use-app-data"
import type { TabId, Activity, Goal, GoalCategory, WeeklyGoal } from "@/lib/types"

const VALID_TABS = new Set<TabId>(["home", "activities", "goals", "insights", "profile"])

// Lazy-load heavy screens (ActivityDetail pulls in Recharts ~200KB, GoalDetail pulls in AI plan UI)
const ActivityDetailScreen = lazy(() => import("@/components/screens/activity-detail-screen").then(m => ({ default: m.ActivityDetailScreen })))
const GoalDetailScreen = lazy(() => import("@/components/screens/goal-detail-screen").then(m => ({ default: m.GoalDetailScreen })))
const ProfileScreen = lazy(() => import("@/components/screens/profile-screen").then(m => ({ default: m.ProfileScreen })))
const InsightsScreen = lazy(() => import("@/components/screens/insights-screen").then(m => ({ default: m.InsightsScreen })))

// Lightweight URL sync — updates the URL bar without triggering Next.js server navigation
function getSearchString() {
  if (typeof window === "undefined") return ""
  return window.location.search
}

function useLocationSearch() {
  const subscribe = useCallback((cb: () => void) => {
    window.addEventListener("popstate", cb)
    return () => window.removeEventListener("popstate", cb)
  }, [])
  const search = useSyncExternalStore(subscribe, getSearchString, () => "")
  return new URLSearchParams(search)
}

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
  const searchParams = useLocationSearch()
  const { setLocale } = useI18n()

  // Sync locale from DB on mount — overrides localStorage if user has a saved preference
  useEffect(() => {
    const dbLocale = data.user?.locale
    if (dbLocale === "en" || dbLocale === "no") {
      setLocale(dbLocale as Locale)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.user?.locale])

  // Read navigation state from URL
  const urlTab = searchParams.get("tab") as TabId | null
  const activeTab: TabId = urlTab && VALID_TABS.has(urlTab) ? urlTab : "home"
  const activityId = searchParams.get("activity")
  const goalId = searchParams.get("goal")

  // Keep InsightsScreen mounted after first visit so its fetch doesn't re-run on tab switch
  const [insightsMounted, setInsightsMounted] = useState(activeTab === "insights")
  useEffect(() => {
    if (activeTab === "insights") setInsightsMounted(true)
  }, [activeTab])

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
  const [isManualActivityOpen, setIsManualActivityOpen] = useState(false)

  const [onboardingDismissed, setOnboardingDismissed] = useState(false)
  const showOnboarding = !onboardingDismissed && !data.isLoading && data.goals.length === 0 && !data.stravaConnected

// ----- URL navigation helpers -----
  // Uses pushState directly to avoid Next.js server round-trips
  const navigate = useCallback((params: Record<string, string | null>) => {
    const sp = new URLSearchParams(window.location.search)
    for (const [key, value] of Object.entries(params)) {
      if (value === null) sp.delete(key)
      else sp.set(key, value)
    }
    const qs = sp.toString()
    const url = qs ? `/?${qs}` : "/"
    window.history.pushState(null, "", url)
    // Trigger re-render via popstate listener
    window.dispatchEvent(new PopStateEvent("popstate"))
  }, [])

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

  const handleDeleteActivity = useCallback(async (activityId: string) => {
    const ok = await data.deleteActivity(activityId)
    if (ok) navigate({ activity: null })
    return ok
  }, [data.deleteActivity, navigate])

  const handleConnectStrava = useCallback(() => {
    window.location.href = "/api/auth/strava"
  }, [])

  const handleDismissOnboarding = useCallback(() => {
    setOnboardingDismissed(true)
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
            starredGoals={data.starredGoals}
            currentWeekGoals={data.currentWeekGoals}
            activities={data.activities}
            weeklySummary={data.weeklySummary}
            recentActivities={data.activities.slice(0, 5)}
            syncStatus={data.syncStatus}
            stravaConnected={data.stravaConnected}
            onViewActivities={() => handleTabChange("activities")}
            onViewGoal={(goal) => { navigate({ tab: "goals", goal: goal.id }) }}
            onViewGoals={() => handleTabChange("goals")}
            onViewInsights={() => handleTabChange("insights")}
            onSelectActivity={(activity) => { navigate({ tab: "activities", activity: activity.id }) }}
          />
        )}

        {activeTab === "activities" && !selectedActivity && (
          <ActivitiesScreen
            activities={data.activities}
            stravaConnected={data.stravaConnected}
            syncStatus={data.syncStatus}
            onSelectActivity={handleSelectActivity}
            onSync={data.sync}
            onAddActivity={() => setIsManualActivityOpen(true)}
          />
        )}

        {activeTab === "activities" && selectedActivity && (
          <Suspense fallback={<ScreenFallback />}>
            <ActivityDetailScreen
              activity={selectedActivity}
              onBack={handleBackFromDetail}
              onDelete={handleDeleteActivity}
              allActivities={data.activities}
            />
          </Suspense>
        )}

        {activeTab === "goals" && !selectedGoal && (
          <GoalsScreen
            goals={data.goals}
            activities={data.activities}
            weeklyGoals={data.weeklyGoals}
            onToggleActive={data.toggleActiveGoal}
            onToggleStar={data.toggleStarGoal}
            onEditGoal={handleEditGoal}
            onAddGoal={() => handleAddGoal("performance")}
            onAddEventGoal={() => handleAddGoal("event_training")}
            onEditWeeklyGoal={handleEditWeeklyGoal}
            onAddWeeklyGoal={handleAddWeeklyGoal}
            onSelectGoal={handleSelectGoal}
            onReorderGoals={data.reorderGoals}
            onReorderWeeklyGoals={data.reorderWeeklyGoals}
          />
        )}

        {activeTab === "goals" && selectedGoal && (
          <Suspense fallback={<ScreenFallback />}>
            <GoalDetailScreen
              goal={selectedGoal}
              activities={data.activities}
              onBack={handleBackFromGoalDetail}
              onEditGoal={handleEditGoal}
            />
          </Suspense>
        )}

        {/* InsightsScreen stays mounted after first visit to avoid refetching on tab switch */}
        {insightsMounted && (
          <div className={activeTab !== "insights" ? "hidden" : ""}>
            <Suspense fallback={<ScreenFallback />}>
              <InsightsScreen activities={data.activities} goals={data.goals} />
            </Suspense>
          </div>
        )}

        {activeTab === "profile" && (
          <Suspense fallback={<ScreenFallback />}>
            <ProfileScreen
              user={data.user ?? { id: "", display_name: "Runner", email: "", avatar_url: null }}
              syncStatus={data.syncStatus}
              stravaConnected={data.stravaConnected}
              onSync={data.sync}
              onFullSync={data.fullSync}
              onConnectStrava={data.connectStrava}
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

      {/* Manual Activity Form */}
      <ManualActivityForm
        open={isManualActivityOpen}
        onClose={() => setIsManualActivityOpen(false)}
        onSave={data.addActivity}
      />

      {/* Bottom Tab Bar */}
      <TabBar activeTab={activeTab} onTabChange={handleTabChange} />

      {/* Onboarding Flow */}
      {showOnboarding && (
        <Onboarding
          stravaConnected={data.stravaConnected}
          onConnectStrava={handleConnectStrava}
          onCreateGoal={() => handleAddGoal("performance")}
          onDismiss={handleDismissOnboarding}
        />
      )}
    </div>
  )
}
