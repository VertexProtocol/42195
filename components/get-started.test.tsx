// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n"
import { GetStartedSheet } from "./get-started"
import { deriveGetStartedSteps, getStartedProgress } from "@/lib/onboarding"

/**
 * The first-run checklist, now a sheet over the app rather than a section
 * inside Today.
 *
 * The distinction this pins down is closing versus hiding. As a section there
 * was only one control and it meant "never again"; as a sheet there is an X in
 * the corner, and an X that quietly dismissed the list for good would be a
 * trap. Closing puts it away until next session. Hiding is the explicit one.
 */

const STEPS = deriveGetStartedSteps({
  stravaConnected: false,
  activityCount: 0,
  goalCount: 0,
  weeklyGoalCount: 0,
})

function renderSheet(overrides: Partial<React.ComponentProps<typeof GetStartedSheet>> = {}) {
  const props = {
    open: true,
    steps: STEPS,
    progress: getStartedProgress(STEPS),
    stravaConnected: false,
    onConnectStrava: vi.fn(),
    onAddActivity: vi.fn(),
    onAddGoal: vi.fn(),
    onAddWeeklyGoal: vi.fn(),
    onViewInsights: vi.fn(),
    onClose: vi.fn(),
    onHide: vi.fn(),
    ...overrides,
  }
  render(
    <I18nProvider>
      <GetStartedSheet {...props} />
    </I18nProvider>,
  )
  return props
}

describe("GetStartedSheet", () => {
  it("comes up as a dialog over the app, not as part of a screen", () => {
    renderSheet()
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(screen.getByText("Get started")).toBeTruthy()
  })

  it("stays out of the way when it is not open", () => {
    renderSheet({ open: false })
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("closes for now without hiding for good", () => {
    const props = renderSheet()
    fireEvent.click(screen.getByRole("button", { name: /close for now/i }))
    expect(props.onClose).toHaveBeenCalled()
    expect(props.onHide).not.toHaveBeenCalled()
  })

  it("hides for good only when asked to in as many words", () => {
    const props = renderSheet()
    fireEvent.click(screen.getByRole("button", { name: /do not show this again/i }))
    expect(props.onHide).toHaveBeenCalled()
  })

  it("gets out of the way before opening the editor a step asks for", () => {
    // Every step's control opens an editor, and an editor is a sheet too.
    const props = renderSheet()
    fireEvent.click(screen.getByRole("button", { name: /^set a race target$/i }))
    expect(props.onClose).toHaveBeenCalled()
    expect(props.onAddGoal).toHaveBeenCalled()
  })

  it("counts off the steps as they are done", () => {
    const steps = deriveGetStartedSteps({
      stravaConnected: true,
      activityCount: 12,
      goalCount: 1,
      weeklyGoalCount: 0,
    })
    renderSheet({ steps, progress: getStartedProgress(steps) })
    expect(screen.getByText("2 of 3 done")).toBeTruthy()
  })
})
