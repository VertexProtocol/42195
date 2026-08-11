import { describe, it, expect } from "vitest"
import { computeWeeklyTargets, calcWeekTargets, calcMinWeeklyKm, type WeeklyTargetInputs } from "./training-volume"
import type { AcwrSafety, ProlongedFatigueResult } from "./training-safety"
import type { ComebackRecommendation } from "./training-comeback"

const noAcwr: AcwrSafety = { ratio: 0.9, risk: "low", weekOneMultiplier: 1.0, message: null }
const noFatigue: ProlongedFatigueResult = {
  detected: false, consecutiveNegativeTsbWeeks: 0, deloadMultiplier: 1.0, message: null,
}
const noComeback: ComebackRecommendation = {
  needsRamp: false, pauseDays: 0, category: "short", weekOneKm: 0, tablePercent: 100, limitingFactor: null,
}

function inputs(over: Partial<WeeklyTargetInputs> = {}): WeeklyTargetInputs {
  return {
    avgWeeklyKm: 40,
    blockWeeks: 4,
    sessionsPerWeek: 3,
    longestRecentRun: 14,
    increasePct: 10,
    athleteLevel: "intermediate",
    acwr: noAcwr,
    prolongedFatigue: noFatigue,
    comeback: noComeback,
    priorWeeklyVolumes: [38, 39, 40],
    ...over,
  }
}

describe("calcWeekTargets", () => {
  it("returns exactly one target for a one-week block", () => {
    // Regression: the build loop was skipped for blockWeeks=1 but the closing
    // recovery week was appended anyway, so a race 10 days out produced two
    // weeks while the prompt asked for exactly one.
    expect(calcWeekTargets(40, 10, 1, 3, 14)).toHaveLength(1)
  })

  it("returns exactly blockWeeks targets", () => {
    for (const weeks of [1, 2, 3, 4, 6, 8, 12]) {
      expect(calcWeekTargets(40, 10, weeks, 3, 14)).toHaveLength(weeks)
    }
  })

  it("builds then closes with a recovery week", () => {
    const t = calcWeekTargets(40, 10, 4, 3, 14)
    expect(t[1]).toBeGreaterThan(t[0])
    expect(t[2]).toBeGreaterThan(t[1])
    expect(t[3]).toBeLessThan(t[2])
  })

  it("floors the baseline so session length rules stay satisfiable", () => {
    const t = calcWeekTargets(4, 10, 4, 3, 8)
    expect(t[0]).toBeGreaterThanOrEqual(calcMinWeeklyKm(3, 8))
  })

  it("returns nothing for a zero-week block", () => {
    expect(calcWeekTargets(40, 10, 0, 3, 14)).toEqual([])
  })
})

describe("computeWeeklyTargets", () => {
  it("passes a healthy runner's progression through unchanged", () => {
    const { targets, notes } = computeWeeklyTargets(inputs())
    expect(targets).toHaveLength(4)
    expect(notes).toEqual([])
  })

  it("does not stack ACWR and prolonged-fatigue reductions", () => {
    // The strongest reduction applies; multiplying them was how a returning
    // runner ended up at ~60% of an already conservative baseline.
    const both = computeWeeklyTargets(inputs({
      acwr: { ratio: 1.6, risk: "unsafe", weekOneMultiplier: 0.75, message: "high load" },
      prolongedFatigue: { ...noFatigue, detected: true, deloadMultiplier: 0.6, message: "deload" },
    }))
    const strongestOnly = computeWeeklyTargets(inputs({
      prolongedFatigue: { ...noFatigue, detected: true, deloadMultiplier: 0.6, message: "deload" },
    }))
    expect(both.targets[0]).toBe(strongestOnly.targets[0])
  })

  it("applies the reduction in full to week one and does not spring back", () => {
    const base = computeWeeklyTargets(inputs()).targets
    const reduced = computeWeeklyTargets(inputs({
      acwr: { ratio: 1.6, risk: "unsafe", weekOneMultiplier: 0.75, message: "high load" },
    })).targets

    expect(reduced[0]).toBe(Math.round(base[0] * 0.75))
    // The progression cap carries the reduction forward: having pulled week 1
    // down, the block cannot climb back to the original plan faster than the
    // athlete's weekly cap allows.
    for (let i = 0; i < base.length; i++) {
      expect(reduced[i]).toBeLessThanOrEqual(base[i])
    }
  })

  it("caps week one on return from a pause", () => {
    const { targets, notes } = computeWeeklyTargets(inputs({
      comeback: { ...noComeback, needsRamp: true, pauseDays: 21, weekOneKm: 18, category: "long" },
    }))
    expect(targets[0]).toBe(18)
    expect(notes.join(" ")).toContain("Comeback cap")
  })

  it("progresses from the capped week one, not from the uncapped target", () => {
    const { targets } = computeWeeklyTargets(inputs({
      comeback: { ...noComeback, needsRamp: true, pauseDays: 21, weekOneKm: 18, category: "long" },
    }))
    // Intermediate cap is +10%/week — week 2 must respect it against the capped week 1.
    expect(targets[1]).toBeLessThanOrEqual(Math.round(targets[0] * 1.1))
  })

  it("clamps week-over-week jumps to the athlete cap", () => {
    const { targets } = computeWeeklyTargets(inputs({ increasePct: 10, athleteLevel: "beginner" }))
    for (let i = 1; i < targets.length; i++) {
      // Recovery weeks drop, so only check increases.
      if (targets[i] > targets[i - 1]) {
        expect(targets[i]).toBeLessThanOrEqual(Math.round(targets[i - 1] * 1.08))
      }
    }
  })

  it("closes with a recovery week after all clamping", () => {
    const { targets } = computeWeeklyTargets(inputs({ blockWeeks: 4 }))
    const last = targets.length - 1
    expect(targets[last]).toBeLessThanOrEqual(Math.floor(targets[last - 1] * 0.8))
  })

  it("never returns a negative target", () => {
    const { targets } = computeWeeklyTargets(inputs({
      avgWeeklyKm: 0,
      acwr: { ratio: 0, risk: "no_baseline", weekOneMultiplier: 0.85, message: "no baseline" },
      comeback: { ...noComeback, needsRamp: true, pauseDays: 40, weekOneKm: 3, category: "rebuild" },
    }))
    for (const t of targets) expect(t).toBeGreaterThanOrEqual(0)
  })

  it("keeps a one-week block at one week through every adjustment", () => {
    const { targets } = computeWeeklyTargets(inputs({
      blockWeeks: 1,
      comeback: { ...noComeback, needsRamp: true, pauseDays: 21, weekOneKm: 18, category: "long" },
    }))
    expect(targets).toEqual([18])
  })
})
