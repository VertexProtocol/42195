import { describe, it, expect } from "vitest"
import { parseTargetHistory, recordTargetChange, targetForWeek } from "./weekly-goal-history"
import type { WeeklyGoal } from "./types"

const W1 = "2026-06-01"
const W2 = "2026-06-08"
const W3 = "2026-06-15"
const W4 = "2026-06-22"

function goal(over: Partial<WeeklyGoal> = {}): WeeklyGoal {
  return {
    id: "wg1",
    metric: "distance_km",
    label: "Weekly Distance",
    target: 40,
    week_start: W1,
    is_recurring: true,
    target_history: [],
    ...over,
  }
}

describe("targetForWeek", () => {
  it("is the current target when nothing has changed", () => {
    expect(targetForWeek(goal(), W1)).toBe(40)
    expect(targetForWeek(goal(), W4)).toBe(40)
  })

  it("gives a closed period its own number", () => {
    const g = goal({ target: 50, target_history: [{ from: W1, until: W3, target: 40 }] })
    expect(targetForWeek(g, W1)).toBe(40)
    expect(targetForWeek(g, W2)).toBe(40)
  })

  it("gives the week of the change the new number", () => {
    // Half-open: the runner raising their target on Wednesday is telling the
    // app about the week they are standing in.
    const g = goal({ target: 50, target_history: [{ from: W1, until: W3, target: 40 }] })
    expect(targetForWeek(g, W3)).toBe(50)
    expect(targetForWeek(g, W4)).toBe(50)
  })

  it("walks more than one change", () => {
    const g = goal({
      target: 60,
      target_history: [
        { from: W1, until: W2, target: 40 },
        { from: W2, until: W4, target: 50 },
      ],
    })
    expect(targetForWeek(g, W1)).toBe(40)
    expect(targetForWeek(g, W2)).toBe(50)
    expect(targetForWeek(g, W3)).toBe(50)
    expect(targetForWeek(g, W4)).toBe(60)
  })

  it("leaves a one-off goal alone", () => {
    // It exists in one week, so its target is that week's by definition.
    const g = goal({ is_recurring: false, target: 25, target_history: [{ from: W1, until: W3, target: 40 }] })
    expect(targetForWeek(g, W1)).toBe(25)
  })
})

describe("recordTargetChange", () => {
  it("closes the outgoing number's run at the week of the change", () => {
    expect(recordTargetChange(goal(), 50, W3)).toEqual([{ from: W1, until: W3, target: 40 }])
  })

  it("opens the period where the goal was created", () => {
    const g = goal({ week_start: W2 })
    expect(recordTargetChange(g, 50, W4)[0]).toMatchObject({ from: W2 })
  })

  it("opens the next period where the last one closed", () => {
    const g = goal({ target: 50, target_history: [{ from: W1, until: W2, target: 40 }] })
    expect(recordTargetChange(g, 60, W4)).toEqual([
      { from: W1, until: W2, target: 40 },
      { from: W2, until: W4, target: 50 },
    ])
  })

  it("records nothing when the number has not moved", () => {
    expect(recordTargetChange(goal(), 40, W3)).toEqual([])
  })

  it("records nothing for a one-off goal", () => {
    expect(recordTargetChange(goal({ is_recurring: false }), 50, W3)).toEqual([])
  })

  it("leaves no empty period when changed twice in one week", () => {
    // The first number was never what anyone worked to for a whole week.
    const once = recordTargetChange(goal(), 50, W3)
    const twice = recordTargetChange(goal({ target: 50, target_history: once }), 60, W3)
    expect(twice).toEqual(once)
  })

  it("leaves no empty period when changed in the week it was created", () => {
    expect(recordTargetChange(goal({ week_start: W3 }), 50, W3)).toEqual([])
  })

  it("survives a round trip through the reader", () => {
    const history = recordTargetChange(goal(), 50, W3)
    const g = goal({ target: 50, target_history: parseTargetHistory(history) })
    expect(targetForWeek(g, W2)).toBe(40)
    expect(targetForWeek(g, W3)).toBe(50)
  })
})

describe("parseTargetHistory", () => {
  it("returns nothing for anything that is not an array", () => {
    for (const bad of [null, undefined, {}, 7, "history"]) {
      expect(parseTargetHistory(bad)).toEqual([])
    }
  })

  it("drops entries that are not whole periods", () => {
    const parsed = parseTargetHistory([
      { from: W1, until: W2, target: 40 },
      { from: W2, target: 50 },
      { from: W2, until: W3, target: "50" },
      null,
    ])
    expect(parsed).toEqual([{ from: W1, until: W2, target: 40 }])
  })

  it("drops a period that describes no weeks", () => {
    expect(parseTargetHistory([{ from: W2, until: W2, target: 40 }])).toEqual([])
    expect(parseTargetHistory([{ from: W3, until: W1, target: 40 }])).toEqual([])
  })

  it("sorts by the week each period opened", () => {
    const parsed = parseTargetHistory([
      { from: W2, until: W3, target: 50 },
      { from: W1, until: W2, target: 40 },
    ])
    expect(parsed.map((p) => p.target)).toEqual([40, 50])
  })
})
