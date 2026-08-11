import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  predictGoalSeconds,
  sharedGoalPosition,
  blockAdherence,
} from "./shared-goal-progress"
import type { Activity, TrainingPlan } from "./types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = new Date("2026-06-15T12:00:00Z")

/** An activity `daysAgo` before the mocked clock. */
function run(daysAgo: number, distanceKm: number, durationSeconds: number): Activity {
  const d = new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000)
  return {
    id: `a${daysAgo}-${distanceKm}`,
    user_id: "u",
    strava_id: null,
    type: "Run",
    name: "Run",
    date: d.toISOString(),
    distance_km: distanceKm,
    duration_seconds: durationSeconds,
    pace_min_per_km: null,
    elevation_gain_m: 0,
    avg_heart_rate: null,
    avg_cadence: null,
    calories: null,
    created_at: d.toISOString(),
  }
}

function mondayOf(date: Date): Date {
  const d = new Date(date)
  const day = d.getUTCDay()
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day))
  d.setUTCHours(0, 0, 0, 0)
  return d
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function makePlan(targetKmPerWeek: number[]): TrainingPlan {
  return {
    summary: "",
    keyPrinciples: [],
    watchOut: null,
    weeks: targetKmPerWeek.map((targetKm, i) => ({
      weekNumber: i + 1,
      theme: "Build",
      targetKm,
      sessions: [],
      coachNote: null,
    })),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// sharedGoalPosition — the share of your own gap you have closed
// ---------------------------------------------------------------------------

describe("sharedGoalPosition", () => {
  it("measures the share of the gap that has been closed", () => {
    // Joined predicting 3:52, now predicting 3:44, aiming for 3:30.
    // 8 minutes taken off a 22-minute gap.
    const p = sharedGoalPosition(3 * 3600 + 52 * 60, 3 * 3600 + 44 * 60, 3 * 3600 + 30 * 60)
    expect(p.state).toBe("measured")
    expect(p.pct).toBeCloseTo(36.4, 1)
    expect(p.lanePct).toBeCloseTo(36.4, 1)
  })

  it("ranks a big improvement from a slow start above a small one from a fast start", () => {
    // The whole reason this measure exists: a beginner taking 43 minutes off a
    // 5:05 marathon is further along than a 3:12 runner taking off 5.
    const beginner = sharedGoalPosition(5 * 3600 + 5 * 60, 4 * 3600 + 22 * 60, 4 * 3600 + 15 * 60)
    const veteran = sharedGoalPosition(3 * 3600 + 12 * 60, 3 * 3600 + 7 * 60, 3 * 3600 + 5 * 60)
    expect(beginner.pct).toBeGreaterThan(veteran.pct!)
  })

  it("reports the target as reached at 100 and keeps going past it", () => {
    const exact = sharedGoalPosition(4000, 3000, 3000)
    expect(exact.pct).toBe(100)

    // Faster than the target: honest above 100, but the lane stops at the line.
    const past = sharedGoalPosition(4000, 2500, 3000)
    expect(past.pct).toBe(150)
    expect(past.lanePct).toBe(100)
  })

  it("reports going backwards as a negative, and holds the marker on the start line", () => {
    // Slower today than the day they joined.
    const p = sharedGoalPosition(4000, 4100, 3000)
    expect(p.state).toBe("measured")
    expect(p.pct).toBe(-10)
    expect(p.lanePct).toBe(0)
  })

  it("flags a baseline that was already at or past the target", () => {
    expect(sharedGoalPosition(3000, 2900, 3000).state).toBe("already_met")
    expect(sharedGoalPosition(2900, 2800, 3000).state).toBe("already_met")
  })

  it("says it does not know rather than saying zero", () => {
    // No baseline is not the same statement as no progress.
    expect(sharedGoalPosition(null, 3500, 3000)).toMatchObject({ pct: null, state: "no_baseline" })
    expect(sharedGoalPosition(0, 3500, 3000)).toMatchObject({ pct: null, state: "no_baseline" })

    // A target time is required too — a distance-only goal has nothing to aim at.
    expect(sharedGoalPosition(4000, 3500, null)).toMatchObject({ pct: null, state: "no_baseline" })

    // Baseline locked, but nothing recent enough to predict from today.
    expect(sharedGoalPosition(4000, null, 3000)).toMatchObject({ pct: null, state: "no_current" })
  })
})

// ---------------------------------------------------------------------------
// predictGoalSeconds — Riegel over the goal's own distance
// ---------------------------------------------------------------------------

describe("predictGoalSeconds", () => {
  it("uses a standard distance directly when the goal is one", () => {
    const acts = [run(10, 10, 50 * 60)]
    const marathon = predictGoalSeconds(acts, 42.195)
    expect(marathon.source).toBe("prediction")
    // Riegel from 10 km in 50:00 lands a marathon a bit over 3:50.
    expect(marathon.seconds).toBeGreaterThan(3.5 * 3600)
    expect(marathon.seconds).toBeLessThan(4.5 * 3600)
  })

  it("scales to a distance that is not one of the four", () => {
    const acts = [run(10, 10, 50 * 60)]
    const fifteen = predictGoalSeconds(acts, 15)
    const ten = predictGoalSeconds(acts, 10)
    const half = predictGoalSeconds(acts, 21.0975)

    expect(fifteen.seconds).not.toBeNull()
    // 15 km sits between the 10 km and the half, and so must its prediction.
    expect(fifteen.seconds!).toBeGreaterThan(ten.seconds!)
    expect(fifteen.seconds!).toBeLessThan(half.seconds!)
  })

  it("reports no source when there is nothing to predict from", () => {
    expect(predictGoalSeconds([], 42.195)).toEqual({ seconds: null, source: "none" })
    // Everything older than the 90-day lookback window.
    expect(predictGoalSeconds([run(200, 10, 50 * 60)], 42.195).seconds).toBeNull()
    // A goal with no distance.
    expect(predictGoalSeconds([run(10, 10, 50 * 60)], 0).seconds).toBeNull()
  })

  it("reads the past as it stood then, not as it looks now", () => {
    // A slow run in April, a fast one in June — a runner getting fitter.
    // Asked as of May the fast run has not happened yet, so the baseline is
    // the slow one. That is the whole basis for locking a starting point:
    // recomputing it today would quietly hand the runner their own progress.
    const acts: Activity[] = [
      { ...run(0, 10, 60 * 60), id: "slow", date: "2026-04-10T12:00:00Z" },
      { ...run(0, 10, 45 * 60), id: "fast", date: "2026-06-10T12:00:00Z" },
    ]

    const asOfMay = predictGoalSeconds(acts, 42.195, new Date("2026-05-01T12:00:00Z").getTime())
    const today = predictGoalSeconds(acts, 42.195)

    expect(asOfMay.seconds).not.toBeNull()
    expect(today.seconds).not.toBeNull()
    expect(asOfMay.seconds!).toBeGreaterThan(today.seconds!)
  })

  it("ignores activities dated after the moment being asked about", () => {
    const future = { ...run(-30, 10, 30 * 60), id: "future" }
    const past = run(10, 10, 60 * 60)
    const withFuture = predictGoalSeconds([past, future], 42.195)
    const withoutFuture = predictGoalSeconds([past], 42.195)
    expect(withFuture.seconds).toBe(withoutFuture.seconds)
  })
})

// ---------------------------------------------------------------------------
// blockAdherence — the second line of the row
// ---------------------------------------------------------------------------

describe("blockAdherence", () => {
  it("sums km done against km planned over completed weeks", () => {
    const blockStart = isoDate(new Date(mondayOf(NOW).getTime() - 2 * 7 * 24 * 60 * 60 * 1000))
    const plan = makePlan([40, 50, 60])

    // Two completed weeks; the current week is deliberately not counted.
    const acts = [
      { date: new Date(new Date(blockStart).getTime() + 2 * 86400000).toISOString(), distance_km: 38 },
      { date: new Date(new Date(blockStart).getTime() + 9 * 86400000).toISOString(), distance_km: 45 },
      { date: NOW.toISOString(), distance_km: 12 },
    ]

    const a = blockAdherence(plan, acts, blockStart)
    expect(a.weeks).toBe(2)
    expect(a.targetKm).toBe(90)
    expect(a.doneKm).toBe(83)
  })

  it("stays silent until the first week of the block is behind the runner", () => {
    const blockStart = isoDate(mondayOf(NOW))
    const plan = makePlan([40, 50])
    const a = blockAdherence(plan, [{ date: NOW.toISOString(), distance_km: 20 }], blockStart)
    expect(a).toEqual({ doneKm: 0, targetKm: 0, weeks: 0 })
  })

  it("reports nothing when there is no plan to measure against", () => {
    expect(blockAdherence(null, [], "2026-06-01")).toEqual({ doneKm: 0, targetKm: 0, weeks: 0 })
    expect(blockAdherence(makePlan([40]), [], null)).toEqual({ doneKm: 0, targetKm: 0, weeks: 0 })
  })

  it("never counts more weeks than the plan has", () => {
    // Block started eight weeks ago, plan is three weeks long.
    const blockStart = isoDate(new Date(mondayOf(NOW).getTime() - 8 * 7 * 24 * 60 * 60 * 1000))
    const a = blockAdherence(makePlan([40, 40, 40]), [], blockStart)
    expect(a.weeks).toBe(3)
    expect(a.targetKm).toBe(120)
  })
})
