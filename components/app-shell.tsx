"use client"

import { useState, useCallback, useEffect, useSyncExternalStore, lazy, Suspense } from "react"
import { useI18n, type Locale } from "@/lib/i18n"
import { TabBar } from "@/components/tab-bar"
import { AppBar } from "@/components/app-bar"
import { HomeScreen } from "@/components/screens/home-screen"
import { ActivitiesScreen } from "@/components/screens/activities-screen"
import { GoalsScreen, type GoalTab } from "@/components/screens/goals-screen"
import { GoalEditor } from "@/components/goal-editor"
import { WeeklyGoalEditor } from "@/components/weekly-goal-editor"
import { ManualActivityForm } from "@/components/manual-activity-form"
import { GetStartedDialog } from "@/components/get-started"
import { useAppData, type InitialData } from "@/hooks/use-app-data"
import { useGetStarted } from "@/hooks/use-get-started"
import type { TabId, Activity, Goal, GoalCategory, WeeklyGoal } from "@/lib/types"
import type { WeeklySuggestion } from "@/lib/weekly-suggestions"

const VALID_TABS = new Set<TabId>(["home", "activities", "goals", "insights", "profile"])

// Everything the URL stacks on top of a tab. Moving to a tab clears all of
// it, so a tab always opens on its own list. The group was the one missing
// from this set: walking out of a group to another tab left `group` in the
// URL, and coming back to Plan put the group you had left back on screen —
// under the Plan list, since the list renders too when no goal is selected.
const STACKED_VIEWS = { activity: null, goal: null, group: null, plan: null } as const

// Lazy-load heavy screens (ActivityDetail pulls in Recharts ~200KB, GoalDetail pulls in AI plan UI)
const ActivityDetailScreen = lazy(() => import("@/components/screens/activity-detail-screen").then(m => ({ default: m.ActivityDetailScreen })))
const GoalDetailScreen = lazy(() => import("@/components/screens/goal-detail-screen").then(m => ({ default: m.GoalDetailScreen })))
const SharedGoalScreen = lazy(() => import("@/components/screens/shared-goal-screen").then(m => ({ default: m.SharedGoalScreen })))
const JoinSharedGoalSheet = lazy(() => import("@/components/join-shared-goal-sheet").then(m => ({ default: m.JoinSharedGoalSheet })))
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

/**
 * Loading a screen shows the shape of what is coming, not a spinner in the
 * middle of empty space.
 */
function ScreenFallback() {
  return (
    <div className="flex flex-col gap-3 px-4 pt-4" aria-hidden>
      <div className="h-24 animate-pulse rounded-lg bg-surface-sunken" />
      <div className="h-16 animate-pulse rounded-lg bg-surface-sunken" />
      <div className="h-16 animate-pulse rounded-lg bg-surface-sunken" />
    </div>
  )
}

interface AppShellProps {
  initialData?: InitialData | null
}

export function AppShell({ initialData }: AppShellProps) {
  const data = useAppData(initialData)
  const searchParams = useLocationSearch()
  const { setLocale, t } = useI18n()

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
  // A group is reached from the goal it hangs off, so it lives inside the Plan
  // tab rather than becoming a fifth destination in the tab bar.
  const groupId = searchParams.get("group")
  // Which horizon Plan opens on. In the URL rather than in the screen so that
  // arriving from a weekly goal on Today lands on the weekly list, and so the
  // back button puts you back where you were.
  const planTab: GoalTab = searchParams.get("plan") === "weekly" ? "weekly" : "race"
  const inviteToken = searchParams.get("invite")

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
  // The suggestion the editor was opened from, so it can prefill and say
  // where the number came from. Cleared whenever an existing goal is edited.
  const [pendingSuggestion, setPendingSuggestion] = useState<WeeklySuggestion | null>(null)
  const [isManualActivityOpen, setIsManualActivityOpen] = useState(false)
  // An invite held aside while its recipient makes the goal to bring to it.
  // Kept out of the URL for the duration so the sheet is not on screen behind
  // the editor, and put back the moment there is a goal to offer it.
  const [heldInvite, setHeldInvite] = useState<string | null>(null)
  const [goalPrefill, setGoalPrefill] = useState<
    { name: string; target_date: string; target_distance_km: number } | null
  >(null)

  // First run is a checklist, asked once per session, over whichever screen
  // the runner is on. What is already done is read from the account, so the
  // list is right on a second device and after data is deleted.
  const getStarted = useGetStarted({
    ready: !data.isLoading && Boolean(data.user?.id),
    dismissed: data.onboardingDismissed,
    stravaConnected: data.stravaConnected,
    activityCount: data.activities.length,
    goalCount: data.goals.length,
    weeklyGoalCount: data.weeklyGoals.length,
  })

  // Closing the sheet and hiding it for good are different answers. Closing is
  // this state — it comes back next session while there is work left. Hiding
  // is written to the account. Without the distinction, an accidental tap on
  // the X would be the last the runner ever saw of the setup list.
  const [guideClosed, setGuideClosed] = useState(false)

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
    navigate({ ...STACKED_VIEWS, tab: tab === "home" ? null : tab })
  }, [navigate])

  /** Plan, opened on the weekly list — where a weekly goal on Today leads. */
  const handleViewWeeklyGoals = useCallback(() => {
    navigate({ ...STACKED_VIEWS, tab: "goals", plan: "weekly" })
  }, [navigate])

  const handleSelectGoal = useCallback((goal: Goal) => {
    navigate({ goal: goal.id })
  }, [navigate])

  const handleBackFromGoalDetail = useCallback(() => {
    navigate({ goal: null })
  }, [navigate])

  const handleOpenGroup = useCallback((id: string) => {
    navigate({ tab: "goals", group: id })
  }, [navigate])

  const handleBackFromGroup = useCallback(() => {
    navigate({ group: null })
  }, [navigate])

  const handleDismissInvite = useCallback(() => {
    navigate({ invite: null })
  }, [navigate])

  /** From the join sheet: make the goal this group hangs off, race filled in. */
  const handleCreateGoalForRace = useCallback(
    (race: { name: string; raceDate: string; distanceKm: number }) => {
      if (inviteToken) setHeldInvite(inviteToken)
      navigate({ invite: null })
      setGoalPrefill({
        name: race.name,
        target_date: race.raceDate,
        target_distance_km: race.distanceKm,
      })
      setEditingGoal(null)
      setIsNewGoal(true)
      setDefaultGoalCategory("event_training")
      setIsEditorOpen(true)
    },
    [inviteToken, navigate],
  )

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
    if (!ok) return
    setIsEditorOpen(false)
    setGoalPrefill(null)
    // Back to the invite they came in on, now with something to bring to it.
    if (heldInvite) {
      const token = heldInvite
      setHeldInvite(null)
      navigate({ invite: token })
    }
  }, [data.saveGoal, heldInvite, navigate])

  const handleDeleteGoal = useCallback(async (goalId: string) => {
    await data.deleteGoal(goalId)
    setIsEditorOpen(false)
  }, [data.deleteGoal])

  const handleCloseEditor = useCallback(() => {
    setIsEditorOpen(false)
    setGoalPrefill(null)
    if (heldInvite) {
      const token = heldInvite
      setHeldInvite(null)
      navigate({ invite: token })
    }
  }, [heldInvite, navigate])

  const handleEditWeeklyGoal = useCallback((goal: WeeklyGoal) => {
    setEditingWeeklyGoal(goal)
    setPendingSuggestion(null)
    setIsNewWeeklyGoal(false)
    setIsWeeklyEditorOpen(true)
  }, [])

  const handleAddWeeklyGoal = useCallback((suggestion?: WeeklySuggestion) => {
    setEditingWeeklyGoal(null)
    setPendingSuggestion(suggestion ?? null)
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

  const handleOpenProfile = useCallback(() => {
    navigate({ ...STACKED_VIEWS, tab: "profile" })
  }, [navigate])

  // Profile → Get started. The sheet sits over whatever screen is underneath,
  // so asking for it there opens it there — no trip back to Today first, which
  // is what it took when the checklist was a section on that screen.
  const { reveal: revealGetStarted } = getStarted
  const { resumeOnboarding } = data
  const handleResumeGetStarted = useCallback(() => {
    revealGetStarted()
    resumeOnboarding()
    setGuideClosed(false)
  }, [revealGetStarted, resumeOnboarding])

  // ----- Loading state -----
  // The chrome is already correct while the data arrives, so the shell renders
  // and only the content region is a skeleton.
  if (data.isLoading) {
    return (
      <div className="mx-auto min-h-dvh max-w-md bg-background">
        <AppBar title="42195" brand subtitle={t("common.loading")} />
        <main className="pb-24">
          <ScreenFallback />
        </main>
      </div>
    )
  }

  // The group screen brings its own app bar with a back button, so the shell
  // must not put a second one above it.
  const isDetail = Boolean(
    (activeTab === "activities" && selectedActivity) ||
      (activeTab === "goals" && (selectedGoal || groupId)),
  )

  const barTitle =
    activeTab === "activities"
      ? t("activities.title")
      : activeTab === "goals"
        ? t("goals.title")
        : activeTab === "insights"
          ? t("insights.title")
          : activeTab === "profile"
            ? t("profile.title")
            : "42195"

  const barSubtitle =
    activeTab === "home"
      ? t("app.tagline")
      : activeTab === "activities"
        ? `${data.activities.length} ${
            data.activities.length === 1 ? t("activities.activity") : t("activities.activities")
          }`
        : activeTab === "goals"
          ? t("goals.subtitle")
          : activeTab === "insights"
            ? t("insights.subtitle")
            : undefined

  return (
    <div className="mx-auto min-h-dvh max-w-md bg-background">
      {/* One app bar for every screen: where you are, whether the data is
          current, and the way to your account. Detail views swap the profile
          button for a back button rather than growing a header of their own. */}
      {!isDetail && (
        <AppBar
          title={barTitle}
          brand={activeTab === "home"}
          subtitle={barSubtitle}
          syncStatus={data.syncStatus}
          stravaConnected={data.stravaConnected}
          user={data.user}
          onOpenProfile={activeTab === "profile" ? undefined : handleOpenProfile}
          onBack={activeTab === "profile" ? () => handleTabChange("home") : undefined}
        />
      )}

      {/* Screen content */}
      <main className="relative pb-24">
        {activeTab === "home" && (
          <HomeScreen
            starredGoals={data.starredGoals}
            currentWeekGoals={data.currentWeekGoals}
            activities={data.activities}
            weeklySummary={data.weeklySummary}
            recentActivities={data.activities.slice(0, 5)}
            warnings={data.warnings}
            planBadges={data.planBadges}
            currentPlanWeeks={data.currentPlanWeeks}
            planSessionStatuses={data.planSessionStatuses}
            syncStatus={data.syncStatus}
            stravaConnected={data.stravaConnected}
            onViewActivities={() => handleTabChange("activities")}
            onViewGoal={(goal) => { navigate({ ...STACKED_VIEWS, tab: "goals", goal: goal.id }) }}
            onViewGoals={() => handleTabChange("goals")}
            onViewWeeklyGoals={handleViewWeeklyGoals}
            onViewInsights={() => handleTabChange("insights")}
            onSelectActivity={(activity) => { navigate({ ...STACKED_VIEWS, tab: "activities", activity: activity.id }) }}
            onUnpinGoal={data.toggleStarGoal}
          />
        )}

        {activeTab === "activities" && !selectedActivity && (
          <ActivitiesScreen
            activities={data.activities}
            stravaConnected={data.stravaConnected}
            syncStatus={data.syncStatus}
            testRunActivityIds={data.testRunActivityIds}
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
              onTestRunChange={data.setTestRunTag}
              allActivities={data.activities}
            />
          </Suspense>
        )}

        {/* One Plan screen at a time. The group sits on top of both the list
            and the goal it hangs off, so it is excluded from each of them
            rather than merely ordered after. */}
        {activeTab === "goals" && !groupId && !selectedGoal && (
          <GoalsScreen
            goals={data.goals}
            activities={data.activities}
            weeklyGoals={data.weeklyGoals}
            onToggleActive={data.toggleActiveGoal}
            onToggleStar={data.toggleStarGoal}
            onEditGoal={handleEditGoal}
            onAddGoal={() => handleAddGoal()}
            onEditWeeklyGoal={handleEditWeeklyGoal}
            onAddWeeklyGoal={handleAddWeeklyGoal}
            onSelectGoal={handleSelectGoal}
            onReorderGoals={data.reorderGoals}
            onReorderWeeklyGoals={data.reorderWeeklyGoals}
            planDigests={data.planDigests}
            goalPrefs={data.goalPrefs}
            dismissals={data.dismissals}
            onDismissSuggestion={data.dismissSuggestion}
            onSaveWeeklyGoal={data.saveWeeklyGoal}
            initialTab={planTab}
          />
        )}

        {activeTab === "goals" && !groupId && selectedGoal && (
          <Suspense fallback={<ScreenFallback />}>
            <GoalDetailScreen
              goal={selectedGoal}
              activities={data.activities}
              onBack={handleBackFromGoalDetail}
              onEditGoal={handleEditGoal}
              onPlanChange={data.refreshPlanBadges}
              onOpenGroup={handleOpenGroup}
              sharedGoal={data.sharedGoals[selectedGoal.id] ?? null}
              onSharedGoalChange={data.refreshSharedGoals}
              onToggleStar={data.toggleStarGoal}
              initialSessionStatuses={data.planSessionStatuses[selectedGoal.id]}
              onSessionStatusChange={data.setPlanSessionStatus}
            />
          </Suspense>
        )}

        {activeTab === "goals" && groupId && (
          <Suspense fallback={<ScreenFallback />}>
            <SharedGoalScreen
              groupId={groupId}
              onBack={handleBackFromGroup}
              onLeft={data.refreshSharedGoals}
              initial={
                Object.values(data.sharedGoals).find((g) => g.id === groupId) ?? null
              }
            />
          </Suspense>
        )}

        {/* InsightsScreen stays mounted after first visit to avoid refetching on tab switch */}
        {insightsMounted && (
          <div className={activeTab !== "insights" ? "hidden" : ""}>
            <Suspense fallback={<ScreenFallback />}>
              <InsightsScreen
                activities={data.activities}
                goals={data.goals}
                onViewGoal={(goal) => navigate({ ...STACKED_VIEWS, tab: "goals", goal: goal.id })}
                onSelectActivity={(activity) =>
                  navigate({ ...STACKED_VIEWS, tab: "activities", activity: activity.id })
                }
              />
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
              onOpenGetStarted={handleResumeGetStarted}
            />
          </Suspense>
        )}
      </main>

      {/* Goal Editor Sheet */}
      <GoalEditor
        goal={editingGoal}
        isNew={isNewGoal}
        defaultCategory={defaultGoalCategory}
        prefill={goalPrefill ?? undefined}
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
        suggestion={pendingSuggestion}
        onSave={handleSaveWeeklyGoal}
        onDelete={handleDeleteWeeklyGoal}
        onClose={handleCloseWeeklyEditor}
      />

      {/* First run. Small prompts over the app rather than a section inside
          Today, so the screen the runner opens before a run is the app from
          the first load rather than a setup list with the app underneath —
          and one question at a time rather than everything the app wants. */}
      <GetStartedDialog
        open={getStarted.visible && !guideClosed}
        steps={getStarted.steps}
        progress={getStarted.progress}
        stravaConnected={data.stravaConnected}
        onConnectStrava={handleConnectStrava}
        onAddActivity={() => setIsManualActivityOpen(true)}
        onAddGoal={() => handleAddGoal("event_training")}
        onAddWeeklyGoal={handleAddWeeklyGoal}
        onViewInsights={() => handleTabChange("insights")}
        onClose={() => setGuideClosed(true)}
        onHide={() => {
          setGuideClosed(true)
          data.dismissOnboarding()
        }}
      />

      {/* Manual Activity Form */}
      <ManualActivityForm
        open={isManualActivityOpen}
        onClose={() => setIsManualActivityOpen(false)}
        onSave={data.addActivity}
      />

      {/* An invite link lands on whatever screen the runner was last on, and
          asks its one question there rather than taking over the app. */}
      {inviteToken && data.user && (
        <Suspense fallback={null}>
          <JoinSharedGoalSheet
            token={inviteToken}
            goals={data.goals}
            onClose={handleDismissInvite}
            onJoined={(id) => {
              // The groups are seeded by the page render and re-read only when
              // one is created, joined or left. Joining is one of those, and
              // it was the one that never said so: the runner landed in a
              // group the rest of the app had not heard of, and their own
              // goal went on offering to create one.
              void data.refreshSharedGoals()
              navigate({ invite: null, tab: "goals", group: id })
            }}
            onCreateGoal={handleCreateGoalForRace}
          />
        </Suspense>
      )}

      {/* Bottom Tab Bar */}
      <TabBar activeTab={activeTab} onTabChange={handleTabChange} />
    </div>
  )
}
