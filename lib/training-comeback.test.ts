import { describe, it, expect } from "vitest"
import {
  calculateComebackVolume,
  daysSinceLastActivity,
  averageWeeklyKmBeforePause,
  chronicLoadWeeklyKm,
  assessComeback,
} from "./training-comeback"

// ── Helpers ──────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000

function isoDaysAgo(days: number, ref: Date = new Date()): string {
  return new Date(ref.getTime() - days * DAY_MS).toISOString()
}

function runs(
  ref: Date,
  entries: Array<{ daysAgo: number; km: number }>,
): Array<{ date: string; distance_km: number }> {
  return entries.map((e) => ({
    date: isoDaysAgo(e.daysAgo, ref),
    distance_km: e.km,
  }))
}

const REF = new Date("2026-04-19T12:00:00Z")

// ── calculateComebackVolume ──────────────────────────────────────────────────

describe("calculateComebackVolume", () => {
  it("returns no-ramp when pause is shorter than the threshold", () => {
    const r = calculateComebackVolume(3, 40, 40, false)
    expect(r.needsRamp).toBe(false)
    expect(r.category).toBe("none")
    expect(r.weekOneKm).toBe(40)
    expect(r.limitingFactor).toBeNull()
  })

  it("applies the short-pause (7–10d) reduction", () => {
    const r = calculateComebackVolume(8, 40, 40, false)
    expect(r.needsRamp).toBe(true)
    expect(r.category).toBe("short")
    expect(r.tablePercent).toBe(0.80)
    // 0.80 * 40 = 32; ACWR cap = 1.3 * 40 = 52 → table wins
    expect(r.weekOneKm).toBe(32)
    expect(r.limitingFactor).toBe("table")
  })

  it("applies the moderate-pause (11–14d) reduction", () => {
    const r = calculateComebackVolume(13, 40, 30, false)
    expect(r.category).toBe("moderate")
    expect(r.tablePercent).toBe(0.65)
    // 0.65 * 40 = 26; ACWR cap = 1.3 * 30 = 39 → table wins
    expect(r.weekOneKm).toBe(26)
  })

  it("applies the long-pause (15–21d) reduction", () => {
    const r = calculateComebackVolume(20, 40, 20, false)
    expect(r.category).toBe("long")
    expect(r.tablePercent).toBe(0.50)
    // 0.50 * 40 = 20; ACWR cap = 1.3 * 20 = 26 → table wins
    expect(r.weekOneKm).toBe(20)
  })

  it("applies the extended (22–28d) reduction", () => {
    const r = calculateComebackVolume(25, 40, 10, false)
    expect(r.category).toBe("extended")
    expect(r.tablePercent).toBe(0.40)
    // 0.40 * 40 = 16; ACWR cap = 1.3 * 10 = 13 → ACWR binds
    expect(r.weekOneKm).toBe(13)
    expect(r.limitingFactor).toBe("acwr")
  })

  it("enters rebuild mode for pauses > 28 days", () => {
    const r = calculateComebackVolume(60, 40, 0, false)
    expect(r.category).toBe("rebuild")
    expect(r.tablePercent).toBe(0.35)
    // 0.35 * 40 = 14; ACWR cap skipped (chronic 0 + pause > 28d)
    expect(r.weekOneKm).toBe(14)
    expect(r.limitingFactor).toBe("table")
  })

  it("skips ACWR guard when chronic load has fully decayed even on a 28d pause", () => {
    const r = calculateComebackVolume(28, 40, 0, false)
    // 0.40 * 40 = 16; chronicLoadWeeklyKm === 0 → ACWR guard skipped
    expect(r.weekOneKm).toBe(16)
    expect(r.limitingFactor).toBe("table")
  })

  it("applies the injury reduction on top of the table percent", () => {
    const r = calculateComebackVolume(8, 40, 40, true)
    expect(r.tablePercent).toBe(0.80)
    // 0.80 * 0.80 = 0.64 → 0.64 * 40 = 25.6 → 26
    expect(r.weekOneKm).toBe(26)
    expect(r.limitingFactor).toBe("injury")
  })

  it("tightens to the ACWR cap when chronic load is low relative to pre-pause", () => {
    // Runner used to average 50 km/wk, but chronic load is only 10 km/wk
    // (e.g. mostly inactive in the last 28 days before the pause)
    const r = calculateComebackVolume(8, 50, 10, false)
    // table: 0.80 * 50 = 40
    // acwr cap: 1.3 * 10 = 13 → binds
    expect(r.weekOneKm).toBe(13)
    expect(r.limitingFactor).toBe("acwr")
  })

  it("fitness level is baked in through chronic load — fit runner gets higher absolute km", () => {
    // Same 10-day pause, same relative drop; fit runner has higher chronic load
    const trained = calculateComebackVolume(9, 80, 80, false)
    const novice = calculateComebackVolume(9, 20, 20, false)
    expect(trained.tablePercent).toBe(novice.tablePercent)
    expect(trained.weekOneKm).toBeGreaterThan(novice.weekOneKm)
    expect(trained.weekOneKm).toBe(64) // 0.80 * 80
    expect(novice.weekOneKm).toBe(16) // 0.80 * 20
  })

  it("enforces the minimum km floor when everything else pushes it below", () => {
    const r = calculateComebackVolume(10, 2, 0, false)
    // table: 0.80 * 2 = 1.6; floor = 3
    expect(r.weekOneKm).toBe(3)
    expect(r.limitingFactor).toBe("floor")
  })

  it("is tolerant of negative pause days", () => {
    const r = calculateComebackVolume(-5, 40, 40, false)
    expect(r.needsRamp).toBe(false)
    expect(r.category).toBe("none")
  })
})

// ── daysSinceLastActivity ───────────────────────────────────────────────────

describe("daysSinceLastActivity", () => {
  it("returns Infinity for an empty list", () => {
    expect(daysSinceLastActivity([], REF)).toBe(Infinity)
  })

  it("counts whole days since the most recent activity", () => {
    const acts = runs(REF, [{ daysAgo: 10, km: 5 }, { daysAgo: 2, km: 6 }])
    expect(daysSinceLastActivity(acts, REF)).toBe(2)
  })

  it("clamps to 0 when the latest run is in the future (clock skew)", () => {
    const future = new Date(REF.getTime() + 2 * DAY_MS)
    const acts = [{ date: future.toISOString() }]
    expect(daysSinceLastActivity(acts, REF)).toBe(0)
  })

  it("floors partial days", () => {
    const almost2Days = new Date(REF.getTime() - (1.9 * DAY_MS)).toISOString()
    expect(daysSinceLastActivity([{ date: almost2Days }], REF)).toBe(1)
  })
})

// ── averageWeeklyKmBeforePause ──────────────────────────────────────────────

describe("averageWeeklyKmBeforePause", () => {
  it("averages activities in the window before the pause started", () => {
    // pause = 10d → window is days 10..38 ago. Put 4 runs of 10 km each.
    const acts = runs(REF, [
      { daysAgo: 12, km: 10 },
      { daysAgo: 18, km: 10 },
      { daysAgo: 25, km: 10 },
      { daysAgo: 33, km: 10 },
    ])
    // 40 km total / 4 weeks = 10 km/week
    expect(averageWeeklyKmBeforePause(acts, 10, 4, REF)).toBe(10)
  })

  it("excludes activities inside the pause window", () => {
    // pause 14d: anything in the last 14d is excluded
    const acts = runs(REF, [
      { daysAgo: 5, km: 100 }, // inside pause → ignored
      { daysAgo: 20, km: 10 },
    ])
    expect(averageWeeklyKmBeforePause(acts, 14, 4, REF)).toBe(10 / 4)
  })

  it("excludes activities older than the window", () => {
    const acts = runs(REF, [
      { daysAgo: 200, km: 100 }, // outside window
      { daysAgo: 20, km: 12 },
    ])
    expect(averageWeeklyKmBeforePause(acts, 7, 4, REF)).toBe(3)
  })

  it("returns 0 when there are no pre-pause activities", () => {
    expect(averageWeeklyKmBeforePause([], 10, 4, REF)).toBe(0)
  })
})

// ── chronicLoadWeeklyKm ─────────────────────────────────────────────────────

describe("chronicLoadWeeklyKm", () => {
  it("sums the last 28 days and divides by 4", () => {
    const acts = runs(REF, [
      { daysAgo: 2, km: 8 },
      { daysAgo: 10, km: 8 },
      { daysAgo: 20, km: 8 },
      { daysAgo: 27, km: 8 },
      { daysAgo: 40, km: 100 }, // outside window
    ])
    expect(chronicLoadWeeklyKm(acts, REF)).toBe(32 / 4)
  })

  it("returns 0 when nothing in the last 28 days", () => {
    const acts = runs(REF, [{ daysAgo: 60, km: 40 }])
    expect(chronicLoadWeeklyKm(acts, REF)).toBe(0)
  })
})

// ── assessComeback (integration) ────────────────────────────────────────────

describe("assessComeback", () => {
  it("returns no ramp for a runner who ran yesterday", () => {
    const acts = runs(REF, [
      { daysAgo: 1, km: 8 },
      { daysAgo: 4, km: 10 },
      { daysAgo: 8, km: 12 },
    ])
    const r = assessComeback(acts, false, REF)
    expect(r.needsRamp).toBe(false)
    expect(r.pauseDays).toBe(1)
  })

  it("recommends a ramp-up for a runner returning after 10 days", () => {
    const acts = runs(REF, [
      // last run 10 days ago → pauseDays = 10 (short category)
      { daysAgo: 10, km: 10 },
      // pre-pause history (window = days 10..38 ago)
      { daysAgo: 13, km: 10 },
      { daysAgo: 18, km: 10 },
      { daysAgo: 22, km: 10 },
      { daysAgo: 27, km: 10 },
      { daysAgo: 32, km: 10 },
      { daysAgo: 37, km: 10 },
    ])
    const r = assessComeback(acts, false, REF)
    expect(r.needsRamp).toBe(true)
    expect(r.category).toBe("short")
    expect(r.pauseDays).toBe(10)
    // pre-pause avg: 6 runs × 10 km = 60 km / 4 weeks = 15 km/wk
    // short: 0.80 × 15 = 12
    // chronic (last 28d): day-10 + day-13 + day-18 + day-22 + day-27 = 5 × 10 = 50 / 4 = 12.5
    // acwr cap: 1.3 × 12.5 = 16.25 → table wins
    expect(r.weekOneKm).toBe(12)
    expect(r.limitingFactor).toBe("table")
  })

  it("applies injury reduction when the flag is set", () => {
    const acts = runs(REF, [
      { daysAgo: 15, km: 10 },
      { daysAgo: 20, km: 10 },
      { daysAgo: 25, km: 10 },
      { daysAgo: 30, km: 10 },
    ])
    const clean = assessComeback(acts, false, REF)
    const injured = assessComeback(acts, true, REF)
    expect(injured.weekOneKm).toBeLessThan(clean.weekOneKm)
  })

  it("gives a rebuild recommendation for a 3-month pause", () => {
    // Pre-pause history (far back) + long silence. Most recent activity sits
    // on the pauseStart boundary so it's excluded from the pre-pause average.
    const acts = runs(REF, [
      { daysAgo: 100, km: 40 },
      { daysAgo: 107, km: 40 },
      { daysAgo: 114, km: 40 },
      { daysAgo: 121, km: 40 },
    ])
    const r = assessComeback(acts, false, REF)
    expect(r.category).toBe("rebuild")
    expect(r.pauseDays).toBeGreaterThan(28)
    // pre-pause window covers days 100..128; includes 3 runs (107, 114, 121)
    // avg = 120 km / 4 weeks = 30 km/wk; 0.35 × 30 = 10.5 → 11
    expect(r.weekOneKm).toBe(11)
  })

  it("handles a first-time user with no activities", () => {
    const r = assessComeback([], false, REF)
    // No history → nothing to scale from; should still not crash and should
    // return a floored / conservative recommendation.
    expect(r.needsRamp).toBe(true)
    expect(r.weekOneKm).toBeGreaterThanOrEqual(3)
  })
})
