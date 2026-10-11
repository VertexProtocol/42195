// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
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
    const { container } = render(<I18nProvider><PlanJourney goalName="Oslo" targetDate="2027-05-01" weeks={weeks} statuses={{}} currentIndex={1} /></I18nProvider>)
    expect(Array.from(screen.getByRole("list", { name: "Chapters in this training block" }).children).map(li => li.textContent?.match(/Chapter \d/)?.[0])).toEqual(["Chapter 1", "Chapter 2", "Chapter 3"])
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1)
    expect(screen.getByText("Oslo")).toBeTruthy()
    expect(screen.getByText("Chapter 3").compareDocumentPosition(screen.getByText("Oslo")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole("button", { name: /You are here/ })).toBeTruthy()
  })
  it("does not claim the user is on an archived path", () => {
    const { container } = render(<I18nProvider><PlanJourney goalName="Oslo" targetDate="2027-05-01" weeks={weeks} statuses={{}} currentIndex={1} archived /></I18nProvider>)
    expect(container.querySelector('[aria-current="step"]')).toBeNull()
  })
})


it("opens future stops for details without enabling completion", () => {
  render(<I18nProvider><PlanJourney goalName="Oslo" targetDate="2027-05-01" weeks={weeks} statuses={{}} currentIndex={0} onToggleSession={vi.fn()} /></I18nProvider>)
  fireEvent.click(screen.getAllByRole("button", { name: /Easy · 5 km · Planned/ })[2])
  expect(screen.getByRole("dialog")).toBeTruthy()
  expect(screen.queryByRole("button", { name: /Mark as done/i })).toBeNull()
})

it("updates the current stop through the existing session handler", () => {
  const toggle = vi.fn()
  render(<I18nProvider><PlanJourney goalName="Oslo" targetDate="2027-05-01" weeks={weeks} statuses={{}} currentIndex={0} onToggleSession={toggle} /></I18nProvider>)
  fireEvent.click(screen.getByRole("button", { name: /Next step: Easy/ }))
  fireEvent.click(screen.getByRole("button", { name: /Mark as done/i }))
  expect(toggle).toHaveBeenCalledWith(1, 0)
})

it("collapses elapsed chapters and preserves their session details", () => {
  const { container } = render(<I18nProvider><PlanJourney goalName="Oslo" targetDate="2027-05-01" weeks={weeks} statuses={{ "W1-0": "skipped" }} currentIndex={1} /></I18nProvider>)
  const chapters = screen.getByRole("list", { name: "Chapters in this training block" }).children
  const previous = chapters[0].querySelector("details")!
  expect(previous.open).toBe(false)
  expect(previous.querySelector("summary")?.textContent).toContain("Ended")
  expect(previous.querySelector("summary")?.textContent).not.toContain("Completed")
  expect(chapters[1].querySelector("details")).toBeNull()
  expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1)
  fireEvent.click(previous.querySelector("summary")!)
  expect(previous.open).toBe(true)
  fireEvent.click(screen.getByRole("button", { name: /Easy · 5 km · Skipped/ }))
  expect(screen.getByRole("dialog")).toBeTruthy()
})
