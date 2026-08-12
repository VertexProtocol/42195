// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n"
import { AppShell } from "@/components/app-shell"

/**
 * Which Plan screen the URL puts on screen.
 *
 * Plan stacks three views on one tab — the list, a goal, and the group that
 * goal belongs to — and the URL is what decides between them. The cases here
 * are the ones where two of the three could be on screen at once: leaving a
 * group by the tab bar and coming back, and jumping to a goal from another
 * tab while a group is still in the URL. Both used to render the group
 * underneath the screen the runner had actually asked for.
 */

vi.mock("@/hooks/use-app-data", () => ({
  useAppData: () => ({
    activities: [],
    goals: [{ id: "goal-1", name: "Test" }],
    weeklyGoals: [],
    user: { id: "u1", display_name: "Runner", email: "r@example.com", avatar_url: null },
    starredGoals: [],
    currentWeekGoals: [],
    weeklySummary: null,
    recentActivities: [],
    warnings: [],
    planBadges: {},
    sharedGoals: { "goal-1": { id: "group-1", name: "Test" } },
    testRunActivityIds: [],
    stravaConnected: false,
    syncStatus: null,
    isLoading: false,
    onboardingDismissed: true,
    saveGoal: vi.fn(),
    deleteGoal: vi.fn(),
    saveWeeklyGoal: vi.fn(),
    deleteWeeklyGoal: vi.fn(),
    deleteActivity: vi.fn(),
    addActivity: vi.fn(),
    toggleActiveGoal: vi.fn(),
    toggleStarGoal: vi.fn(),
    reorderGoals: vi.fn(),
    reorderWeeklyGoals: vi.fn(),
    refreshPlanBadges: vi.fn(),
    refreshSharedGoals: vi.fn(),
    dismissOnboarding: vi.fn(),
    resumeOnboarding: vi.fn(),
    sync: vi.fn(),
    fullSync: vi.fn(),
    connectStrava: vi.fn(),
    signOut: vi.fn(),
  }),
}))

vi.mock("@/hooks/use-get-started", () => ({
  useGetStarted: () => ({ steps: [], progress: 0, visible: false, reveal: vi.fn() }),
}))

// The screens themselves are tested on their own. Here they only need to say
// which one is mounted — named the way the shell imports them, since the lazy
// ones are picked off the module by name.
vi.mock("@/components/screens/home-screen", () => ({ HomeScreen: () => <div>HOME</div> }))
vi.mock("@/components/screens/activities-screen", () => ({
  ActivitiesScreen: () => <div>ACTIVITIES</div>,
}))
vi.mock("@/components/screens/goals-screen", () => ({ GoalsScreen: () => <div>PLAN LIST</div> }))
vi.mock("@/components/screens/goal-detail-screen", () => ({
  GoalDetailScreen: () => <div>GOAL DETAIL</div>,
}))
vi.mock("@/components/screens/shared-goal-screen", () => ({
  SharedGoalScreen: () => <div>GROUP</div>,
}))
vi.mock("@/components/screens/insights-screen", () => ({
  InsightsScreen: () => <div>INSIGHTS</div>,
}))
vi.mock("@/components/screens/profile-screen", () => ({ ProfileScreen: () => <div>PROFILE</div> }))
vi.mock("@/components/join-shared-goal-sheet", () => ({
  JoinSharedGoalSheet: () => <div>JOIN SHEET</div>,
}))
vi.mock("@/components/goal-editor", () => ({ GoalEditor: () => null }))
vi.mock("@/components/weekly-goal-editor", () => ({ WeeklyGoalEditor: () => null }))
vi.mock("@/components/manual-activity-form", () => ({ ManualActivityForm: () => null }))

function setUrl(search: string) {
  window.history.replaceState(null, "", search ? `/?${search}` : "/")
}

function renderShell() {
  return render(
    <I18nProvider>
      <AppShell initialData={null} />
    </I18nProvider>,
  )
}

describe("AppShell — Plan navigation", () => {
  beforeEach(() => {
    setUrl("")
  })

  it("leaves the group behind when a tab is tapped", async () => {
    setUrl("tab=goals&goal=goal-1&group=group-1")
    renderShell()
    expect(await screen.findByText("GROUP")).toBeTruthy()

    fireEvent.click(screen.getByRole("tab", { name: /today/i }))
    await waitFor(() => expect(screen.getByText("HOME")).toBeTruthy())

    fireEvent.click(screen.getByRole("tab", { name: /plan/i }))
    await waitFor(() => expect(screen.getByText("PLAN LIST")).toBeTruthy())
    // The group the runner walked out of is not still sitting under the list.
    expect(screen.queryByText("GROUP")).toBeNull()
    expect(new URLSearchParams(window.location.search).get("group")).toBeNull()
  })

  it("never shows the Plan list and a group at the same time", async () => {
    // A group with no goal alongside it in the URL is the state the stale
    // parameter used to produce; the list must not render behind it either.
    setUrl("tab=goals&group=group-1")
    renderShell()
    expect(await screen.findByText("GROUP")).toBeTruthy()
    expect(screen.queryByText("PLAN LIST")).toBeNull()
  })
})
