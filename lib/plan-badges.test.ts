import { describe, it, expect } from "vitest"
import { derivePlanBadges, type PlanBadgeRow } from "./plan-badges"

function row(overrides: Partial<PlanBadgeRow> = {}): PlanBadgeRow {
  return {
    goal_id: "g1",
    block_start_date: "2026-01-05", // a Monday
    plan: { weeks: [{}, {}, {}, {}] },
    mid_block_checkpoint: null,
    ...overrides,
  }
}

describe("derivePlanBadges", () => {
  it("marks a block completed once its last week is past", () => {
    // 4 weeks from Monday 2026-01-05 ends 2026-02-02.
    const badges = derivePlanBadges([row()], new Date("2026-02-03T12:00:00Z"))
    expect(badges.g1.blockCompleted).toBe(true)
  })

  it("does not mark a block completed while it is still running", () => {
    const badges = derivePlanBadges([row()], new Date("2026-01-20T12:00:00Z"))
    expect(badges.g1.blockCompleted).toBe(false)
  })

  it("snaps a mid-week block start back to its Monday", () => {
    // Starting Thursday 2026-01-08 still means the block began that Monday,
    // the 5th — so it ends on the 2nd, same as above.
    const badges = derivePlanBadges(
      [row({ block_start_date: "2026-01-08" })],
      new Date("2026-02-03T12:00:00Z"),
    )
    expect(badges.g1.blockCompleted).toBe(true)
  })

  it("never marks an empty plan completed", () => {
    // Without weeks the block has no end, so "past its end" is meaningless.
    const badges = derivePlanBadges(
      [row({ plan: { weeks: [] } })],
      new Date("2030-01-01T00:00:00Z"),
    )
    expect(badges.g1.blockCompleted).toBe(false)
  })

  it("tolerates a malformed plan rather than throwing", () => {
    for (const plan of [null, undefined, {}, { weeks: "four" }, "nonsense"]) {
      const badges = derivePlanBadges([row({ plan })], new Date("2030-01-01T00:00:00Z"))
      expect(badges.g1.blockCompleted).toBe(false)
    }
  })

  it("flags a checkpoint only once an adjustment was applied", () => {
    expect(
      derivePlanBadges([row({ mid_block_checkpoint: { adjustmentApplied: true } })]).g1.checkpoint,
    ).toBe(true)
    expect(
      derivePlanBadges([row({ mid_block_checkpoint: { adjustmentApplied: false } })]).g1.checkpoint,
    ).toBe(false)
    expect(derivePlanBadges([row()]).g1.checkpoint).toBe(false)
  })

  it("keys badges by goal and covers every row", () => {
    const badges = derivePlanBadges([row(), row({ goal_id: "g2" })])
    expect(Object.keys(badges).sort()).toEqual(["g1", "g2"])
  })

  it("returns an empty map for no plans", () => {
    expect(derivePlanBadges([])).toEqual({})
  })
})
