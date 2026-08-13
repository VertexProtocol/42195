// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n"
import { GetStartedDialog } from "./get-started"
import { deriveGetStartedSteps, getStartedProgress, type GetStartedInput } from "@/lib/onboarding"

/**
 * First run, one question at a time.
 *
 * Two things this pins down. Closing versus hiding: as a section on Today
 * there was one control and it meant "never again"; here there is an X in the
 * corner, and an X that quietly dismissed the list for good would be a trap.
 * And that the sequence walks the runner through what is *left* — pressing
 * Next past a tick to reach the thing you have not done is a step the app
 * asked for and the runner did not.
 */

function stepsFor(input: Partial<GetStartedInput> = {}) {
  return deriveGetStartedSteps({
    stravaConnected: false,
    activityCount: 0,
    goalCount: 0,
    weeklyGoalCount: 0,
    ...input,
  })
}

function renderDialog(
  input: Partial<GetStartedInput> = {},
  overrides: Partial<React.ComponentProps<typeof GetStartedDialog>> = {},
) {
  const steps = stepsFor(input)
  const props = {
    open: true,
    steps,
    progress: getStartedProgress(steps),
    stravaConnected: input.stravaConnected ?? false,
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
      <GetStartedDialog {...props} />
    </I18nProvider>,
  )
  return props
}

const next = () => screen.getByRole("button", { name: /^next/i })

describe("GetStartedDialog", () => {
  it("comes up as a dialog over the app, not as part of a screen", () => {
    renderDialog()
    expect(screen.getByRole("dialog")).toBeTruthy()
  })

  it("stays out of the way when it is not open", () => {
    renderDialog({}, { open: false })
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("asks one thing at a time", () => {
    renderDialog()
    expect(screen.getByText("Get your runs in")).toBeTruthy()
    // The other two steps are not also on screen.
    expect(screen.queryByText("Set a race target")).toBeNull()
    expect(screen.queryByText("Set a weekly target")).toBeNull()
  })

  it("steps forward through what is left, and back again", () => {
    renderDialog()
    fireEvent.click(next())
    expect(screen.getByRole("heading", { name: "Set a race target" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: /^back$/i }))
    expect(screen.getByRole("heading", { name: "Get your runs in" })).toBeTruthy()
  })

  it("skips the steps that are already done", () => {
    // Strava is connected and a race is set, so the only thing left to ask
    // about is the weekly target — and it is the first thing asked.
    renderDialog({ stravaConnected: true, goalCount: 1 })
    expect(screen.getByRole("heading", { name: "Set a weekly target" })).toBeTruthy()
    expect(screen.getByText("2 of 3 already done.")).toBeTruthy()
    // Nothing left to page to, so the button finishes rather than advancing.
    expect(screen.getByRole("button", { name: /^done$/i })).toBeTruthy()
  })

  it("still has something to say once every step is done", () => {
    // Reachable by asking for the list from Profile after setting up.
    renderDialog({ stravaConnected: true, goalCount: 1, weeklyGoalCount: 1 })
    expect(screen.getByRole("heading", { name: "You are set up" })).toBeTruthy()
  })

  it("closes for now without hiding for good", () => {
    const props = renderDialog()
    fireEvent.click(screen.getByRole("button", { name: /close for now/i }))
    expect(props.onClose).toHaveBeenCalled()
    expect(props.onHide).not.toHaveBeenCalled()
  })

  it("hides for good only when asked to in as many words", () => {
    const props = renderDialog()
    fireEvent.click(screen.getByRole("button", { name: /do not show again/i }))
    expect(props.onHide).toHaveBeenCalled()
  })

  it("does not offer to hide from a step the runner paged into", () => {
    // That slot holds Back once there is somewhere to go back to, so a press
    // aimed at Back cannot land on a permanent dismissal.
    renderDialog()
    fireEvent.click(next())
    expect(screen.queryByRole("button", { name: /do not show again/i })).toBeNull()
  })

  it("gets out of the way before opening the editor a step asks for", () => {
    // Every step's control opens an editor, and an editor is a sheet too.
    const props = renderDialog()
    fireEvent.click(next())
    fireEvent.click(screen.getByRole("button", { name: /^set a race target$/i }))
    expect(props.onClose).toHaveBeenCalled()
    expect(props.onAddGoal).toHaveBeenCalled()
  })
})
