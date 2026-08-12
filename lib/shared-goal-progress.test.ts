import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  goalFitness,
  sharedGoalPosition,
  adherencePosition,
  memberPosition,
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
// goalFitness — the form index both ends of the fraction are built from
// ---------------------------------------------------------------------------

/** A month of steady running ending `endingDaysAgo` before the clock. */
function block(endingDaysAgo: number, weeks: number, tenKSeconds: number): Activity[] {
  const out: Activity[] = []
  for (let w = 0; w < weeks; w++) {
    for (const [day, km] of [[0, 8], [3, 10], [5, 6]] as const) {
      const daysAgo = endingDaysAgo + (weeks - 1 - w) * 7 + (6 - day)
      out.push(run(daysAgo, km, km * (tenKSeconds / 10) * 1.15))
    }
  }
  return out
}

describe("goalFitness", () => {
  it("projects to the goal's own distance", () => {
    const acts = block(2, 6, 50 * 60)
    const ten = goalFitness(acts, 10).seconds!
    const fifteen = goalFitness(acts, 15).seconds!
    const half = goalFitness(acts, 21.0975).seconds!

    // A longer race takes longer, and 15 km sits between the two around it.
    expect(fifteen).toBeGreaterThan(ten)
    expect(fifteen).toBeLessThan(half)
  })

  it("refuses to invent a starting point from thin evidence", () => {
    // The runner who just connected Strava. predictRaceTimes would happily
    // return a number here; a starting point from one jog is worse than none.
    expect(goalFitness([run(3, 6, 6 * 6.4 * 60)], 21.0975)).toMatchObject({
      seconds: null,
      reason: "thin_evidence",
    })
    expect(goalFitness([], 21.0975)).toMatchObject({ seconds: null, reason: "no_runs" })
    expect(goalFitness(block(2, 6, 50 * 60), 0)).toMatchObject({ seconds: null })
  })

  it("goes quiet when the training stops rather than holding a stale number", () => {
    // Six weeks of running, then five months of nothing. Eighteen runs is
    // plenty of evidence by weight — but none of it is current, and a frozen
    // form shown beside people training now reads as fact.
    const stale = block(150, 6, 50 * 60)
    expect(goalFitness(stale, 21.0975)).toMatchObject({ reason: "stale", seconds: null })
  })

  it("does not fall off a cliff when a good run ages out", () => {
    // The failure that ruled out predictRaceTimes for this job: one
    // exceptional effort holds the number for exactly 90 days and then it
    // snaps back overnight. Here the same effort must fade instead.
    const base = block(2, 20, 50 * 60)
    const withRace = [...base, run(88, 10, 43 * 60)]

    const before = goalFitness(withRace, 21.0975, Date.now() - 3 * 86400000).seconds!
    const after = goalFitness(withRace, 21.0975, Date.now() + 3 * 86400000).seconds!

    // Six days spanning the old 90-day boundary must not move it more than a
    // couple of minutes on a half marathon.
    expect(Math.abs(after - before)).toBeLessThan(120)
  })

  it("is not owned by a single outlier", () => {
    const base = block(2, 12, 50 * 60)
    const withFluke = [...base, run(10, 10, 43 * 60)]

    const plain = goalFitness(base, 21.0975).seconds!
    const fluked = goalFitness(withFluke, 21.0975).seconds!

    // The fluke counts — it is evidence — but it does not become the answer.
    expect(fluked).toBeLessThan(plain)
    expect(fluked).toBeGreaterThan(plain * 0.9)
  })

  it("still registers a genuine improvement", () => {
    const slow = block(2, 12, 52 * 60)
    const fast = block(2, 12, 46 * 60)
    expect(goalFitness(fast, 21.0975).seconds!).toBeLessThan(goalFitness(slow, 21.0975).seconds!)
  })

  it("reads the past as it stood then, not as it looks now", () => {
    // A slow spring, a fast summer. Asked as of the spring, the summer has not
    // happened — which is the whole basis for locking a starting point.
    const acts = [...block(200, 8, 56 * 60), ...block(5, 8, 46 * 60)]
    const then = goalFitness(acts, 21.0975, Date.now() - 190 * 86400000).seconds!
    const now = goalFitness(acts, 21.0975).seconds!
    expect(then).toBeGreaterThan(now)
  })

  it("ignores activities dated after the moment being asked about", () => {
    const past = block(2, 8, 50 * 60)
    const withFuture = [...past, run(-30, 10, 30 * 60)]
    expect(goalFitness(withFuture, 21.0975).seconds).toBe(goalFitness(past, 21.0975).seconds)
  })

  it("ignores entries too fast to be a run", () => {
    // A paused watch or a GPS error, logged as 10 km in twelve minutes.
    const past = block(2, 8, 50 * 60)
    const withGlitch = [...past, run(4, 10, 12 * 60)]
    expect(goalFitness(withGlitch, 21.0975).seconds).toBe(goalFitness(past, 21.0975).seconds)
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

// ---------------------------------------------------------------------------
// adherencePosition and memberPosition — the measure a group actually runs on
// ---------------------------------------------------------------------------

describe("adherencePosition", () => {
  it("reads km done against km planned", () => {
    expect(adherencePosition({ doneKm: 96, targetKm: 95, weeks: 2 })).toMatchObject({
      pct: 101.1,
      state: "measured",
    })
    expect(adherencePosition({ doneKm: 148, targetKm: 160, weeks: 4 }).pct).toBeCloseTo(92.5, 1)
  })

  it("puts a beginner and a veteran on the same scale", () => {
    // 30 km/week against 90 km/week, both doing what they said they would.
    const beginner = adherencePosition({ doneKm: 58, targetKm: 60, weeks: 2 })
    const veteran = adherencePosition({ doneKm: 174, targetKm: 180, weeks: 2 })
    expect(beginner.pct).toBeCloseTo(veteran.pct!, 1)
  })

  it("keeps a figure above 100 rather than flattening it", () => {
    // Overreaching is a real thing that happened; the lane stops, the number
    // does not, because someone needs to be able to see it.
    const over = adherencePosition({ doneKm: 130, targetKm: 100, weeks: 3 })
    expect(over.pct).toBe(130)
    expect(over.lanePct).toBe(100)
  })

  it("says nothing before the block's first week is complete", () => {
    expect(adherencePosition({ doneKm: 0, targetKm: 0, weeks: 0 })).toMatchObject({
      pct: null,
      state: "no_plan",
    })
    // A plan whose completed weeks all target zero km measures nothing.
    expect(adherencePosition({ doneKm: 12, targetKm: 0, weeks: 1 }).state).toBe("no_plan")
  })
})

describe("memberPosition", () => {
  const adherence = { doneKm: 96, targetKm: 95, weeks: 2 }
  const times = {
    baselineSeconds: 4000,
    currentSeconds: 3600,
    targetSeconds: 3000,
    adherence,
  }

  it("measures what the group chose, not what the data allows", () => {
    // Identical input, two groups: the measure decides, and the two answers
    // are nothing like each other — which is why it is fixed per goal.
    expect(memberPosition("adherence", times).pct).toBeCloseTo(101.1, 1)
    expect(memberPosition("progress", times).pct).toBe(40)
  })

  it("ignores the fitness numbers entirely for an adherence group", () => {
    // No baseline, no current: an adherence group never needed them.
    const p = memberPosition("adherence", { adherence })
    expect(p.state).toBe("measured")
    expect(p.pct).toBeCloseTo(101.1, 1)
  })

  it("reports proximity as unmeasured rather than quietly measuring progress", () => {
    expect(memberPosition("proximity", times)).toMatchObject({ pct: null, lanePct: 0 })
  })
})
