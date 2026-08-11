import { describe, it, expect } from "vitest"
import { deriveGetStartedSteps, getStartedProgress, type GetStartedInput } from "./onboarding"

const empty: GetStartedInput = {
  stravaConnected: false,
  activityCount: 0,
  goalCount: 0,
  weeklyGoalCount: 0,
}

function doneIds(input: GetStartedInput) {
  return deriveGetStartedSteps(input)
    .filter((s) => s.done)
    .map((s) => s.id)
}

describe("deriveGetStartedSteps", () => {
  it("has nothing done on a fresh account", () => {
    expect(doneIds(empty)).toEqual([])
  })

  it("counts a Strava connection as runs handled, even before the first sync", () => {
    expect(doneIds({ ...empty, stravaConnected: true })).toEqual(["runs"])
  })

  it("counts a hand-entered run as runs handled, with no Strava connection", () => {
    expect(doneIds({ ...empty, activityCount: 1 })).toEqual(["runs"])
  })

  it("marks the race step from any goal", () => {
    expect(doneIds({ ...empty, goalCount: 2 })).toEqual(["race"])
  })

  it("marks the week step from any weekly target, including earlier weeks", () => {
    expect(doneIds({ ...empty, weeklyGoalCount: 1 })).toEqual(["week"])
  })

  it("keeps the steps in a stable order", () => {
    expect(deriveGetStartedSteps(empty).map((s) => s.id)).toEqual(["runs", "race", "week"])
  })

  it("re-opens a step when its data goes away", () => {
    const withRace = deriveGetStartedSteps({ ...empty, goalCount: 1 })
    const afterDelete = deriveGetStartedSteps(empty)
    expect(withRace[1].done).toBe(true)
    expect(afterDelete[1].done).toBe(false)
  })
})

describe("getStartedProgress", () => {
  it("reports nothing done on a fresh account", () => {
    expect(getStartedProgress(deriveGetStartedSteps(empty))).toEqual({
      done: 0,
      total: 3,
      complete: false,
    })
  })

  it("counts a partly finished list without calling it complete", () => {
    const progress = getStartedProgress(deriveGetStartedSteps({ ...empty, activityCount: 3 }))
    expect(progress.done).toBe(1)
    expect(progress.complete).toBe(false)
  })

  it("is complete only when every step is done", () => {
    const progress = getStartedProgress(
      deriveGetStartedSteps({
        stravaConnected: true,
        activityCount: 12,
        goalCount: 1,
        weeklyGoalCount: 1,
      }),
    )
    expect(progress).toEqual({ done: 3, total: 3, complete: true })
  })

  it("does not call an empty list complete", () => {
    expect(getStartedProgress([])).toEqual({ done: 0, total: 0, complete: false })
  })
})
