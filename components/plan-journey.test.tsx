// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n"
import { PlanJourney, journeyProgress } from "./plan-journey"
import type { TrainingWeek } from "@/lib/types"
const weeks: TrainingWeek[] = [1, 2, 3].map(weekNumber => ({ weekNumber, theme: "Base", targetKm: 10, coachNote: null, sessions: [{ type: "Easy", distance: "5 km", effort: "Easy", purpose: "Base" }] }))
describe("plan journey", () => {
  it("does not award skipped or future sessions as completed milestones", () => {
    expect(journeyProgress(weeks, { "W1-0": "skipped", "W2-0": "completed", "W3-0": "completed" }, 1)).toEqual({ sessions: 1, weeks: 1, recentDone: 1, recentTotal: 2, blockDone: false })
  })
  it("awards a block only when every session is completed", () => {
    expect(journeyProgress(weeks, { "W1-0": "completed", "W2-0": "completed", "W3-0": "completed" }, 3).blockDone).toBe(true)
    expect(journeyProgress([], {}, 0).blockDone).toBe(false)
    expect(journeyProgress(weeks, {}, -1).recentTotal).toBe(0)
  })
  it("orders stages toward the goal and marks only the current one", () => {
    const { container } = render(<I18nProvider><PlanJourney goalName="Oslo" targetDate="2027-05-01" weeks={weeks} statuses={{}} currentIndex={1}>{weeks.map(w => <div key={w.weekNumber}>Stage {w.weekNumber}</div>)}</PlanJourney></I18nProvider>)
    expect(Array.from(container.querySelectorAll("ol > li")).map(li => li.textContent)).toEqual(["Stage 3", "YOU ARE HEREStage 2", "Stage 1"])
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1)
    expect(screen.getByText("Oslo")).toBeTruthy()
    expect(screen.getByRole("button", { name: /You are here/ })).toBeTruthy()
  })
  it("does not claim the user is on an archived path", () => {
    const { container } = render(<I18nProvider><PlanJourney goalName="Oslo" targetDate="2027-05-01" weeks={weeks} statuses={{}} currentIndex={1} archived>{weeks.map(w => <div key={w.weekNumber}>Stage {w.weekNumber}</div>)}</PlanJourney></I18nProvider>)
    expect(container.querySelector('[aria-current="step"]')).toBeNull()
  })
})
