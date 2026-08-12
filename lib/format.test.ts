import { describe, it, expect } from "vitest"
import { bestRelevantRun, goalOutcome, longestRun, timeAgoParts } from "./format"
import type { Activity } from "./types"

const REF = new Date("2026-04-19T12:00:00Z")
const DAY_MS = 24 * 60 * 60 * 1000

function activity(
  daysAgo: number,
  km: number,
  durationMin: number,
  overrides: Partial<Activity> = {},
): Activity {
  return {
    id: `a-${daysAgo}-${km}`,
    user_id: "u1",
    strava_id: null,
    type: "Run",
    name: "Run",
    date: new Date(REF.getTime() - daysAgo * DAY_MS).toISOString(),
    distance_km: km,
    duration_seconds: durationMin * 60,
    pace_min_per_km: durationMin / km,
    elevation_gain_m: null,
    avg_heart_rate: null,
    avg_cadence: null,
    calories: null,
    map_polyline: null,
    created_at: new Date(REF.getTime() - daysAgo * DAY_MS).toISOString(),
    ...overrides,
  }
}

describe("bestRelevantRun", () => {
  it("returns null when no activities match", () => {
    expect(bestRelevantRun([], 21.1)).toBeNull()
  })

  it("returns the only run within the window", () => {
    const acts = [activity(5, 20, 110)]
    const r = bestRelevantRun(acts, 21.1)
    expect(r?.id).toBe("a-5-20")
  })

  it("excludes runs outside the ±25% window (was ±20% — half-marathon should now accept a 17 km run)", () => {
    // Goal 21.1 km. Window: 15.825 .. 26.375.
    // 17 km used to be just outside ±20% (16.88 lower bound) — now inside ±25%.
    const acts = [activity(3, 17, 90)]
    const r = bestRelevantRun(acts, 21.1)
    expect(r?.distance_km).toBe(17)
  })

  it("excludes runs above the upper window edge", () => {
    // Goal 10 km, window 7.5..12.5. A 13 km run is excluded.
    const acts = [activity(2, 13, 70)]
    expect(bestRelevantRun(acts, 10)).toBeNull()
  })

  it("picks the fastest qualifying run when several are in window", () => {
    const slower = activity(8, 10, 60)
    const faster = activity(4, 10, 50)
    const r = bestRelevantRun([slower, faster], 10)
    expect(r?.id).toBe(faster.id)
  })

  it("respects startDate / endDate bounds", () => {
    const inRange = activity(5, 10, 55)
    const tooOld = activity(40, 10, 50) // faster but before startDate
    const acts = [tooOld, inRange]
    const startIso = new Date(REF.getTime() - 14 * DAY_MS).toISOString()
    const endIso = REF.toISOString()
    const r = bestRelevantRun(acts, 10, startIso, endIso)
    expect(r?.id).toBe(inRange.id)
  })

  it("ignores zero-duration entries", () => {
    const acts = [activity(2, 10, 0)]
    expect(bestRelevantRun(acts, 10)).toBeNull()
  })
})

describe("longestRun", () => {
  it("returns null when no activities are in range", () => {
    expect(longestRun([], null, null)).toBeNull()
  })

  it("picks the longest run in the date range", () => {
    const short = activity(5, 5, 30)
    const long = activity(3, 18, 100)
    const r = longestRun([short, long], null, null)
    expect(r?.id).toBe(long.id)
  })
})

// ---------------------------------------------------------------------------
// timeAgoParts
// ---------------------------------------------------------------------------

describe("timeAgoParts", () => {
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60 * 1000).toISOString()

  it("reports whole minutes under an hour", () => {
    expect(timeAgoParts(minutesAgo(54))).toEqual({ value: 54, unit: "m" })
  })

  it("switches to hours at the hour mark", () => {
    expect(timeAgoParts(minutesAgo(60))).toEqual({ value: 1, unit: "h" })
    expect(timeAgoParts(minutesAgo(59))).toEqual({ value: 59, unit: "m" })
  })

  it("switches to days at the day mark", () => {
    expect(timeAgoParts(minutesAgo(24 * 60))).toEqual({ value: 1, unit: "d" })
    expect(timeAgoParts(minutesAgo(23 * 60))).toEqual({ value: 23, unit: "h" })
  })

  it("returns parts rather than a phrase, so the locale picks the wording", () => {
    // The regression this guards: a hardcoded "54m ago" rendered inside a
    // Norwegian sentence as "Synkronisert 54m ago".
    const parts = timeAgoParts(minutesAgo(5))
    expect(typeof parts.value).toBe("number")
    expect(["m", "h", "d"]).toContain(parts.unit)
  })
})

describe("goalOutcome", () => {
  // A 10 km target of 50:00. The fast run beats it; the slow one does not.
  const fast = [activity(1, 10, 47)]
  const slow = [activity(1, 10, 55)]

  it("reaches a performance goal that was met", () => {
    expect(goalOutcome("performance", fast, 10, 50 * 60)).toBe("reached")
  })

  it("ends a performance goal that was not", () => {
    expect(goalOutcome("performance", slow, 10, 50 * 60)).toBe("ended")
  })

  it("ends an event goal without judging it", () => {
    // A marathon is not passed or failed by the app. Even a run that would
    // have cleared the mark does not turn an event into a verdict.
    expect(goalOutcome("event", fast, 10, 50 * 60)).toBe("ended")
    expect(goalOutcome(null, fast, 10, 50 * 60)).toBe("ended")
  })

  it("ends a goal nobody ran for", () => {
    expect(goalOutcome("performance", [], 10, 50 * 60)).toBe("ended")
  })
})
