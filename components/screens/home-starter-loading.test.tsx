// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n"
import { StarterPlanProvider, type StarterSnapshot } from "@/components/starter-plan-cache"
import { createStarterPlan } from "@/lib/starter-plan"
import { HomeScreen } from "./home-screen"
import type { Goal } from "@/lib/types"
const state = createStarterPlan({ mode: "beginner", aim: "start", days: 2, continuousMinutes: 0, weeklyMinutes: 0, pauseWeeks: 0, hasPain: false })
const goal = { id: "g", name: "Test", goal_category: "event_training", target_date: "2099-01-01", target_distance_km: 42.195 } as Goal
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function mount(initialSnapshot?: StarterSnapshot) {
  sessionStorage.setItem("42195:starter-intro:owner", "seen")
  render(<I18nProvider><StarterPlanProvider initialSnapshot={initialSnapshot}><HomeScreen goals={[goal]} starredGoals={[]} currentWeekGoals={[]} activities={[]} weeklySummary={{ total_distance_km: 0, total_time_seconds: 0, run_count: 0 }} warnings={[]} planBadges={{}} onViewGoal={() => {}} onViewGoals={() => {}} onViewInsights={() => {}} /></StarterPlanProvider></I18nProvider>)
}
it("shows the starter on first render without flashing the generic Open plan prompt", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})))
  mount({ plan: { state, version: 1 }, userId: "owner" })
  expect(screen.getByRole("button", { name: /Next session/ })).toBeTruthy()
  expect(screen.queryByRole("button", { name: "Open plan" })).toBeNull()
})
it("does not confuse a pending fallback read with absence; shows the prompt only after confirmed absence", async () => {
  let resolve: (value: unknown) => void = () => {}
  vi.stubGlobal("fetch", vi.fn(() => new Promise(r => { resolve = r })))
  mount()
  expect(screen.queryByRole("button", { name: "Open plan" })).toBeNull()
  await act(async () => resolve({ ok: true, json: async () => ({ plan: null, userId: "owner" }) }))
  expect(screen.getByRole("button", { name: "Open plan" })).toBeTruthy()
})
it("shows a genuinely empty starter state immediately when the server confirmed absence", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})))
  mount({ plan: null, userId: "owner" })
  expect(screen.getByRole("button", { name: "Open plan" })).toBeTruthy()
})
