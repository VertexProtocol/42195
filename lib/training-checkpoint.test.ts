import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  getCurrentBlockWeekIndex,
  getWeekActualKm,
  isCheckpointDue,
  analyzeBlockAdherence,
  adjustRemainingWeeks,
  buildAdjustmentNote,
} from "./training-checkpoint"
import type { TrainingPlan, TrainingWeek, MidBlockCheckpoint } from "./types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Monday of the week that contains `date` (UTC) */
function mondayOf(date: Date): Date {
  const d = new Date(date)
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

/** Return "YYYY-MM-DD" for a UTC date */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Build a minimal TrainingPlan with N weeks, each with targetKm = weeklyKm.
 * The block start date is always aligned to Monday of the current (mocked) week
 * minus `weeksAgo` weeks, so `currentWeekIndex` will equal `weeksAgo`.
 */
function makePlan(
  totalWeeks: number,
  targetKmPerWeek: number | number[],
): TrainingPlan {
  const kms = Array.isArray(targetKmPerWeek)
    ? targetKmPerWeek
    : Array(totalWeeks).fill(targetKmPerWeek)

  const weeks: TrainingWeek[] = kms.map((km, i) => ({
    weekNumber: i + 1,
    targetKm: km,
    sessions: [
      { day: "Monday", type: "Easy run", distance: `${Math.round(km / 3)} km`, notes: "" },
      { day: "Wednesday", type: "Tempo", distance: `${Math.round(km / 3)} km`, notes: "" },
      { day: "Saturday", type: "Long run", distance: `${Math.round(km / 3)} km`, notes: "" },
    ],
    coachNote: null,
  }))

  return { weeks, goalRaceDate: "2026-06-01", goalRaceType: "10K" }
}

/**
 * Build an activities array simulating `actualKm` run evenly across all 7 days
 * of week `weekIndex` (0-based), relative to `blockStartDate`.
 */
function activitiesForWeek(
  blockStartDate: string,
  weekIndex: number,
  actualKm: number,
): Array<{ date: string; distance_km: number }> {
  const [y, m, d] = blockStartDate.split("-").map(Number)
  const blockStart = new Date(Date.UTC(y, m - 1, d))
  const bDay = blockStart.getUTCDay()
  const bDiff = bDay === 0 ? -6 : 1 - bDay
  blockStart.setUTCDate(blockStart.getUTCDate() + bDiff)

  const weekStart = new Date(blockStart.getTime() + weekIndex * 7 * 24 * 60 * 60 * 1000)
  // Place a single run on Wednesday of that week
  const actDate = new Date(weekStart.getTime() + 2 * 24 * 60 * 60 * 1000)
  return [{ date: isoDate(actDate), distance_km: actualKm }]
}

// ---------------------------------------------------------------------------
// Date helpers for tests
// ---------------------------------------------------------------------------

/**
 * Return a blockStartDate string such that `currentWeekIndex` will equal
 * `weeksIntoBlock` when Date.now() returns `nowMs`.
 */
function blockStartForWeek(weeksIntoBlock: number, nowMs: number): string {
  const nowDate = new Date(nowMs)
  const monday = mondayOf(nowDate)
  // Go back weeksIntoBlock weeks to find the block start monday
  const blockStart = new Date(monday.getTime() - weeksIntoBlock * 7 * 24 * 60 * 60 * 1000)
  return isoDate(blockStart)
}

// ---------------------------------------------------------------------------
// Fixed point in time for deterministic tests
// A Wednesday mid-morning UTC. We are in week 2 of a block that started 2 weeks ago.
// ---------------------------------------------------------------------------
const NOW = new Date("2026-03-11T10:00:00Z").getTime() // Wednesday

// ---------------------------------------------------------------------------
// getCurrentBlockWeekIndex
// ---------------------------------------------------------------------------

describe("getCurrentBlockWeekIndex", () => {
  beforeEach(() => vi.setSystemTime(NOW))
  afterEach(() => vi.useRealTimers())

  it("returns 0 when block started this Monday", () => {
    const start = blockStartForWeek(0, NOW) // this Monday
    expect(getCurrentBlockWeekIndex(start)).toBe(0)
  })

  it("returns 1 when block started last Monday", () => {
    const start = blockStartForWeek(1, NOW)
    expect(getCurrentBlockWeekIndex(start)).toBe(1)
  })

  it("returns 2 when block started 2 weeks ago", () => {
    const start = blockStartForWeek(2, NOW)
    expect(getCurrentBlockWeekIndex(start)).toBe(2)
  })

  it("returns -1 when block starts in the future", () => {
    const future = new Date(NOW + 7 * 24 * 60 * 60 * 1000)
    expect(getCurrentBlockWeekIndex(isoDate(future))).toBe(-1)
  })

  it("aligns non-Monday start dates to Monday", () => {
    // Block 'started' on a Sunday, should be treated as the preceding Monday
    // 2 weeks ago Monday
    const start = blockStartForWeek(2, NOW)
    const sundayStart = new Date(new Date(start).getTime() - 1 * 24 * 60 * 60 * 1000)
    // Sunday before that Monday is treated as the Monday before it,
    // i.e. one extra week back, so weekIndex should be 3
    expect(getCurrentBlockWeekIndex(isoDate(sundayStart))).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// getWeekActualKm
// ---------------------------------------------------------------------------

describe("getWeekActualKm", () => {
  beforeEach(() => vi.setSystemTime(NOW))
  afterEach(() => vi.useRealTimers())

  it("sums activities falling in the correct week", () => {
    const start = blockStartForWeek(3, NOW)
    const acts = [
      ...activitiesForWeek(start, 0, 10),
      ...activitiesForWeek(start, 1, 20),
      ...activitiesForWeek(start, 2, 30),
    ]
    expect(getWeekActualKm(acts, start, 0)).toBeCloseTo(10)
    expect(getWeekActualKm(acts, start, 1)).toBeCloseTo(20)
    expect(getWeekActualKm(acts, start, 2)).toBeCloseTo(30)
  })

  it("returns 0 for a week with no activities", () => {
    const start = blockStartForWeek(3, NOW)
    expect(getWeekActualKm([], start, 1)).toBe(0)
  })

  it("sums multiple activities within the same week", () => {
    const start = blockStartForWeek(3, NOW)
    // Two runs in week 1: 15 + 20 = 35
    const [y, m, d] = start.split("-").map(Number)
    const blockStart = new Date(Date.UTC(y, m - 1, d))
    const weekStart = new Date(blockStart.getTime() + 1 * 7 * 24 * 60 * 60 * 1000)
    const monday = new Date(weekStart.getTime() + 0 * 24 * 60 * 60 * 1000)
    const thursday = new Date(weekStart.getTime() + 3 * 24 * 60 * 60 * 1000)
    const acts = [
      { date: isoDate(monday), distance_km: 15 },
      { date: isoDate(thursday), distance_km: 20 },
    ]
    expect(getWeekActualKm(acts, start, 1)).toBeCloseTo(35)
  })

  it("does not include activities from adjacent weeks", () => {
    const start = blockStartForWeek(3, NOW)
    const acts = activitiesForWeek(start, 0, 50)
    expect(getWeekActualKm(acts, start, 1)).toBe(0)
    expect(getWeekActualKm(acts, start, 2)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// isCheckpointDue
// ---------------------------------------------------------------------------

describe("isCheckpointDue", () => {
  beforeEach(() => vi.setSystemTime(NOW))
  afterEach(() => vi.useRealTimers())

  it("returns false for a block with fewer than 4 weeks", () => {
    const plan = makePlan(3, 50)
    const start = blockStartForWeek(2, NOW)
    expect(isCheckpointDue(plan, start, null)).toBe(false)
  })

  it("returns false when before the midpoint", () => {
    // 4-week block, midpoint is week index 2; we're at index 1
    const plan = makePlan(4, 50)
    const start = blockStartForWeek(1, NOW)
    expect(isCheckpointDue(plan, start, null)).toBe(false)
  })

  it("returns true at exactly the midpoint with no prior checkpoint", () => {
    // 4-week block, midpoint index = 2
    const plan = makePlan(4, 50)
    const start = blockStartForWeek(2, NOW)
    expect(isCheckpointDue(plan, start, null)).toBe(true)
  })

  it("returns true past the midpoint with no prior checkpoint", () => {
    const plan = makePlan(4, 50)
    const start = blockStartForWeek(3, NOW)
    expect(isCheckpointDue(plan, start, null)).toBe(true)
  })

  it("returns false when block is over", () => {
    const plan = makePlan(4, 50)
    const start = blockStartForWeek(4, NOW) // currentWeekIndex === 4 === totalWeeks
    expect(isCheckpointDue(plan, start, null)).toBe(false)
  })

  it("returns false when block has not started yet", () => {
    const plan = makePlan(4, 50)
    // Start date one week in the future → currentWeekIndex = -1
    const futureStart = isoDate(new Date(NOW + 7 * 24 * 60 * 60 * 1000))
    expect(isCheckpointDue(plan, futureStart, null)).toBe(false)
  })

  it("returns false when checkpoint already applied for this block", () => {
    const plan = makePlan(4, 50)
    const start = blockStartForWeek(2, NOW)
    const existing: MidBlockCheckpoint = {
      checkedAt: new Date(NOW).toISOString(),
      blockStartDate: start,
      blockWeeks: 4,
      checkpointWeek: 3,
      completedWeeks: [],
      missedWeekCount: 0,
      overallAdherencePct: 100,
      isWayOff: false,
      direction: "on_track",
      adjustmentApplied: true,
      adjustmentNote: null,
    }
    expect(isCheckpointDue(plan, start, existing)).toBe(false)
  })

  it("returns false when checkpoint was already checked (not applied) for this block", () => {
    const plan = makePlan(4, 50)
    const start = blockStartForWeek(2, NOW)
    const existing: MidBlockCheckpoint = {
      checkedAt: new Date(NOW).toISOString(),
      blockStartDate: start,
      blockWeeks: 4,
      checkpointWeek: 3,
      completedWeeks: [],
      missedWeekCount: 0,
      overallAdherencePct: 100,
      isWayOff: false,
      direction: "on_track",
      adjustmentApplied: false,
      adjustmentNote: null,
    }
    expect(isCheckpointDue(plan, start, existing)).toBe(false)
  })

  it("returns true when existing checkpoint is from a different (previous) block", () => {
    const plan = makePlan(4, 50)
    const start = blockStartForWeek(2, NOW)
    const previousBlockStart = blockStartForWeek(10, NOW)
    const existing: MidBlockCheckpoint = {
      checkedAt: new Date(NOW - 8 * 7 * 24 * 60 * 60 * 1000).toISOString(),
      blockStartDate: previousBlockStart,
      blockWeeks: 4,
      checkpointWeek: 3,
      completedWeeks: [],
      missedWeekCount: 0,
      overallAdherencePct: 100,
      isWayOff: false,
      direction: "on_track",
      adjustmentApplied: true,
      adjustmentNote: "previous",
    }
    expect(isCheckpointDue(plan, start, existing)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// analyzeBlockAdherence — missed week logic
// ---------------------------------------------------------------------------

describe("analyzeBlockAdherence — missed week exclusion", () => {
  beforeEach(() => vi.setSystemTime(NOW))
  afterEach(() => vi.useRealTimers())

  it("returns empty result when no weeks are completed yet", () => {
    const plan = makePlan(4, 50)
    const start = blockStartForWeek(0, NOW) // in week 0, nothing completed
    const result = analyzeBlockAdherence(plan, [], start)
    expect(result.completedWeeks).toHaveLength(0)
    expect(result.missedWeekCount).toBe(0)
    expect(result.overallAdherencePct).toBe(100)
    expect(result.direction).toBe("on_track")
    expect(result.isWayOff).toBe(false)
  })

  it("classifies a zero-km activity week as missed and excludes it from adherence", () => {
    // Week 0: one logged activity with 0 km (e.g. Garmin sync glitch)
    const plan = makePlan(4, 50)
    const start = blockStartForWeek(3, NOW)
    const acts = [
      ...activitiesForWeek(start, 0, 0),   // 0 km logged — missed
      ...activitiesForWeek(start, 1, 50),  // 100%
      ...activitiesForWeek(start, 2, 50),  // 100%
    ]
    const result = analyzeBlockAdherence(plan, acts, start)
    expect(result.missedWeekCount).toBe(1)
    expect(result.activeWeeks).toHaveLength(2)
    expect(result.overallAdherencePct).toBe(100)
    expect(result.direction).toBe("on_track")
    expect(result.isWayOff).toBe(false)
  })

  it("classifies a week with no activities at all as missed", () => {
    // Week 0: runner didn't log anything (truly sick/away)
    const plan = makePlan(4, 50)
    const start = blockStartForWeek(3, NOW)
    const acts = [
      // No activities for week 0
      ...activitiesForWeek(start, 1, 50),
      ...activitiesForWeek(start, 2, 50),
    ]
    const result = analyzeBlockAdherence(plan, acts, start)
    expect(result.missedWeekCount).toBe(1)
    expect(result.overallAdherencePct).toBe(100)
    expect(result.direction).toBe("on_track")
  })

  it("classifies a <20% week as missed even with some km logged", () => {
    const plan = makePlan(4, 50)
    const start = blockStartForWeek(3, NOW)
    // 9 km = 18% of 50 — below the 20% threshold
    const acts = [
      ...activitiesForWeek(start, 0, 9),
      ...activitiesForWeek(start, 1, 50),
      ...activitiesForWeek(start, 2, 50),
    ]
    const result = analyzeBlockAdherence(plan, acts, start)
    expect(result.missedWeekCount).toBe(1)
    expect(result.overallAdherencePct).toBe(100)
  })

  it("does NOT classify a week at exactly 20% as missed", () => {
    const plan = makePlan(4, 50)
    const start = blockStartForWeek(3, NOW)
    const acts = [
      ...activitiesForWeek(start, 0, 10), // 10/50 = 20% — on the boundary
      ...activitiesForWeek(start, 1, 50),
      ...activitiesForWeek(start, 2, 50),
    ]
    const result = analyzeBlockAdherence(plan, acts, start)
    expect(result.missedWeekCount).toBe(0)
    expect(result.activeWeeks).toHaveLength(3)
  })

  it("direction is on_track if all completed weeks were missed", () => {
    const plan = makePlan(4, 50)
    const start = blockStartForWeek(2, NOW)
    const acts = [
      ...activitiesForWeek(start, 0, 0),
      ...activitiesForWeek(start, 1, 0),
    ]
    const result = analyzeBlockAdherence(plan, acts, start)
    expect(result.missedWeekCount).toBe(2)
    expect(result.activeWeeks).toHaveLength(0)
    expect(result.overallAdherencePct).toBe(100)
    expect(result.direction).toBe("on_track")
    expect(result.isWayOff).toBe(false)
  })

  it("detects consistent undertraining when no weeks are missed", () => {
    const plan = makePlan(4, 50)
    const start = blockStartForWeek(2, NOW)
    // 50% each week — well below the 70% threshold
    const acts = [
      ...activitiesForWeek(start, 0, 25),
      ...activitiesForWeek(start, 1, 25),
    ]
    const result = analyzeBlockAdherence(plan, acts, start)
    expect(result.missedWeekCount).toBe(0)
    expect(result.overallAdherencePct).toBe(50)
    expect(result.direction).toBe("under")
    expect(result.isWayOff).toBe(true)
  })

  it("detects overtraining", () => {
    const plan = makePlan(4, 50)
    const start = blockStartForWeek(2, NOW)
    const acts = [
      ...activitiesForWeek(start, 0, 70), // 140%
      ...activitiesForWeek(start, 1, 70),
    ]
    const result = analyzeBlockAdherence(plan, acts, start)
    expect(result.direction).toBe("over")
    expect(result.isWayOff).toBe(true)
  })

  it("one sick week + one undertrained week still triggers adjustment based on active week only", () => {
    const plan = makePlan(4, 50)
    const start = blockStartForWeek(2, NOW)
    const acts = [
      ...activitiesForWeek(start, 0, 0),  // missed
      ...activitiesForWeek(start, 1, 25), // 50% — undertrained
    ]
    const result = analyzeBlockAdherence(plan, acts, start)
    expect(result.missedWeekCount).toBe(1)
    expect(result.activeWeeks).toHaveLength(1)
    expect(result.overallAdherencePct).toBe(50)
    expect(result.direction).toBe("under")
  })
})

// ---------------------------------------------------------------------------
// adjustRemainingWeeks
// ---------------------------------------------------------------------------

describe("adjustRemainingWeeks", () => {
  it("scales down remaining weeks proportionally", () => {
    const plan = makePlan(4, 60)
    // currentWeekIndex = 2 (weeks 0 and 1 completed), actualAvgKm = 30 (50%)
    const { adjustedWeeks, scaleFactor } = adjustRemainingWeeks(plan, 2, 30)
    // Anchor week is week[2] with targetKm = 60; scale = 30/60 = 0.5 (clamped to 0.55)
    expect(scaleFactor).toBeCloseTo(0.55)
    // Completed weeks unchanged
    expect(adjustedWeeks[0].targetKm).toBe(60)
    expect(adjustedWeeks[1].targetKm).toBe(60)
    // Remaining weeks scaled
    expect(adjustedWeeks[2].targetKm).toBe(Math.round(60 * 0.55))
    expect(adjustedWeeks[3].targetKm).toBe(Math.round(60 * 0.55))
  })

  it("scales up remaining weeks when over-performing", () => {
    const plan = makePlan(4, 50)
    const { adjustedWeeks, scaleFactor } = adjustRemainingWeeks(plan, 2, 70)
    // 70/50 = 1.4 — clamped to 1.30
    expect(scaleFactor).toBeCloseTo(1.30)
    expect(adjustedWeeks[2].targetKm).toBe(Math.round(50 * 1.30))
  })

  it("returns scaleFactor 1.0 when no remaining weeks", () => {
    const plan = makePlan(4, 50)
    const { scaleFactor } = adjustRemainingWeeks(plan, 4, 50)
    expect(scaleFactor).toBe(1.0)
  })

  it("skips session scaling when skipSessionScaling is true", () => {
    const plan = makePlan(4, 60)
    const originalDistance = plan.weeks[2].sessions[0].distance
    const { adjustedWeeks } = adjustRemainingWeeks(plan, 2, 30, { skipSessionScaling: true })
    // targetKm updated but session distances unchanged
    expect(adjustedWeeks[2].targetKm).not.toBe(60)
    expect(adjustedWeeks[2].sessions[0].distance).toBe(originalDistance)
  })

  it("leaves deload weeks (< 75% of completed avg) untouched", () => {
    // Weeks: 50, 50, 50, 15 (deload), 50
    const plan = makePlan(5, [50, 50, 50, 15, 50])
    // Completed avg = (50+50)/2 = 50; deload threshold = 50*0.75 = 37.5
    // Week index 3 (targetKm=15) is below 37.5 → deload
    const { adjustedWeeks, scaleFactor } = adjustRemainingWeeks(plan, 2, 30)
    // anchor = week[2].targetKm = 50; scale = 30/50 = 0.6 (not clamped)
    expect(scaleFactor).toBeCloseTo(0.6)
    expect(adjustedWeeks[3].targetKm).toBe(15) // deload untouched
    expect(adjustedWeeks[4].targetKm).toBe(Math.round(50 * 0.6))
  })

  it("scales session distances proportionally", () => {
    const plan = makePlan(4, 60)
    // sessions each have distance = "20 km" (60/3)
    const { adjustedWeeks } = adjustRemainingWeeks(plan, 2, 33)
    const scaledKm = adjustedWeeks[2].sessions[0].distance
    expect(scaledKm).toMatch(/km/)
    // The session should have a smaller number than 20
    const km = parseFloat(scaledKm)
    expect(km).toBeLessThan(20)
  })

  it("does not modify completed weeks", () => {
    const plan = makePlan(4, 60)
    const { adjustedWeeks } = adjustRemainingWeeks(plan, 2, 30)
    expect(adjustedWeeks[0]).toStrictEqual(plan.weeks[0])
    expect(adjustedWeeks[1]).toStrictEqual(plan.weeks[1])
  })

  it("adds a coachNote to adjusted weeks", () => {
    const plan = makePlan(4, 60)
    const { adjustedWeeks } = adjustRemainingWeeks(plan, 2, 30)
    expect(adjustedWeeks[2].coachNote).toContain("Mid-block adjustment")
    expect(adjustedWeeks[3].coachNote).toContain("Mid-block adjustment")
  })

  it("targetKm never falls below 5 km", () => {
    // 8 km weeks; actualAvgKm = 1 → scaleFactor clamped to 0.55 → 8*0.55 = 4.4 → floor to 5
    const smallPlan = makePlan(4, 8)
    const { adjustedWeeks } = adjustRemainingWeeks(smallPlan, 2, 1)
    expect(adjustedWeeks[2].targetKm).toBeGreaterThanOrEqual(5)
    expect(adjustedWeeks[3].targetKm).toBeGreaterThanOrEqual(5)
  })
})

// ---------------------------------------------------------------------------
// buildAdjustmentNote
// ---------------------------------------------------------------------------

describe("buildAdjustmentNote", () => {
  it("mentions scaled-down percentage for under direction", () => {
    const note = buildAdjustmentNote(55, "under", 0.75, 2)
    expect(note).toContain("scaled down by 25%")
    expect(note).toContain("2 active weeks")
    expect(note).toContain("55%")
  })

  it("mentions scaled-up percentage for over direction", () => {
    const note = buildAdjustmentNote(145, "over", 1.20, 3)
    expect(note).toContain("scaled up by +20%")
    expect(note).toContain("3 active weeks")
  })

  it("mentions missed weeks when missedWeekCount > 0", () => {
    const note = buildAdjustmentNote(55, "under", 0.75, 2, 1)
    expect(note).toContain("1 missed week excluded")
  })

  it("uses plural for multiple missed weeks", () => {
    const note = buildAdjustmentNote(55, "under", 0.75, 2, 3)
    expect(note).toContain("3 missed weeks excluded")
  })

  it("does not mention missed weeks when missedWeekCount is 0", () => {
    const note = buildAdjustmentNote(55, "under", 0.75, 2, 0)
    expect(note).not.toContain("missed")
  })

  it("returns on_track message for on_track direction", () => {
    const note = buildAdjustmentNote(102, "on_track", 1.0, 2)
    expect(note).toContain("on track")
    expect(note).toContain("102%")
  })

  it("uses singular 'week' when activeCount is 1", () => {
    const note = buildAdjustmentNote(60, "under", 0.80, 1)
    expect(note).toContain("1 active week")
    expect(note).not.toContain("1 active weeks")
  })
})
