import { describe, it, expect } from "vitest"
import { planNeedsPaces } from "./pace-guide"
import type { TrainingPlan } from "./types"

function plan(paces: Array<string | undefined>[]): Pick<TrainingPlan, "weeks"> {
  return {
    weeks: paces.map((weekPaces, i) => ({
      weekNumber: i + 1,
      theme: "Build",
      targetKm: 40,
      coachNote: null,
      sessions: weekPaces.map((suggestedPace) => ({
        type: "Base run",
        distance: "10 km",
        effort: "Easy",
        purpose: "Aerobic base",
        suggestedPace,
      })),
    })),
  }
}

describe("planNeedsPaces", () => {
  it("is false when every session already has a pace", () => {
    // The common case: a plan generated since paces became part of generation.
    // Nothing to compute, so the caller can skip building a pace guide at all.
    expect(planNeedsPaces(plan([["5:20–5:30 /km", "5:20–5:30 /km"], ["5:15–5:25 /km"]]))).toBe(false)
  })

  it("is true when any session is missing one", () => {
    expect(planNeedsPaces(plan([["5:20–5:30 /km", undefined]]))).toBe(true)
    expect(planNeedsPaces(plan([["5:20–5:30 /km"], [undefined]]))).toBe(true)
  })

  it("is true for a plan predating pace assignment entirely", () => {
    expect(planNeedsPaces(plan([[undefined, undefined], [undefined]]))).toBe(true)
  })

  it("treats an empty pace string as missing", () => {
    // assignSessionPace returns null when it has no data for a zone, and the
    // route only assigns truthy values — an empty string means unassigned.
    expect(planNeedsPaces(plan([[""]]))).toBe(true)
  })

  it("handles a missing or empty plan without throwing", () => {
    expect(planNeedsPaces(null)).toBe(false)
    expect(planNeedsPaces(undefined)).toBe(false)
    expect(planNeedsPaces({ weeks: [] })).toBe(false)
  })
})
