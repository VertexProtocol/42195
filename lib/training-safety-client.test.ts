import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  classifyAthleteLevel,
  checkSkipLoadSpike,
  MAX_WEEKLY_INCREASE,
} from "./training-safety-client"
import type { SafetyActivity } from "./training-safety-client"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split("T")[0]
}

function makeActivity(daysBack: number, distanceKm: number): SafetyActivity {
  return {
    date: daysAgo(daysBack),
    distance_km: distanceKm,
    duration_seconds: Math.round(distanceKm * 360),
    pace_min_per_km: 6,
    avg_heart_rate: null,
    elevation_gain_m: null,
  }
}

// ---------------------------------------------------------------------------
// classifyAthleteLevel
// ---------------------------------------------------------------------------

describe("classifyAthleteLevel", () => {
  it("returns beginner for empty activities", () => {
    expect(classifyAthleteLevel([])).toBe("beginner")
  })

  it("returns beginner when all activities are older than 12 weeks", () => {
    const old = makeActivity(90, 10) // 90 days = ~13 weeks
    expect(classifyAthleteLevel([old])).toBe("beginner")
  })

  it("classifies advanced when weekly km > 50 AND sessions/week > 4", () => {
    // 12 weeks × 5 sessions × 12 km/session = 60 km/wk avg, 5 sessions/wk
    const activities = Array.from({ length: 60 }, (_, i) =>
      makeActivity(i + 1, 12),
    )
    expect(classifyAthleteLevel(activities)).toBe("advanced")
  })

  it("does NOT classify advanced when sessions/week is exactly 4 (needs > 4)", () => {
    // 12 weeks × 4 sessions × 15 km = 60 km/wk, 4.0 sessions/wk — not > 4
    const activities = Array.from({ length: 48 }, (_, i) =>
      makeActivity(i + 1, 15),
    )
    expect(classifyAthleteLevel(activities)).not.toBe("advanced")
  })

  it("classifies intermediate when weekly km > 20 AND sessions/week >= 2", () => {
    // 12 weeks × 3 sessions × 9 km = 27 km/wk, 3 sessions/wk
    const activities = Array.from({ length: 36 }, (_, i) =>
      makeActivity(i + 1, 9),
    )
    expect(classifyAthleteLevel(activities)).toBe("intermediate")
  })

  it("does NOT classify intermediate when sessions/week < 2", () => {
    // 1 session/wk × 30 km — high volume but too infrequent
    const activities = Array.from({ length: 12 }, (_, i) =>
      makeActivity(i * 7 + 1, 30),
    )
    expect(classifyAthleteLevel(activities)).toBe("beginner")
  })

  it("falls back to beginner when volume is low regardless of frequency", () => {
    // 4 sessions/wk × 3 km = 12 km/wk — below 20 km threshold
    const activities = Array.from({ length: 48 }, (_, i) =>
      makeActivity(i + 1, 3),
    )
    expect(classifyAthleteLevel(activities)).toBe("beginner")
  })

  it("exactly at the advanced km threshold (50) without > 4 sessions is intermediate", () => {
    // 50 km/wk exactly is NOT > 50 → not advanced
    // Use 3 sessions/wk × ~16.7 km to hit exactly 50 km/wk with >= 2 sessions
    const activities = Array.from({ length: 36 }, (_, i) =>
      makeActivity(i + 1, 50 / 3),
    )
    expect(classifyAthleteLevel(activities)).toBe("intermediate")
  })
})

// ---------------------------------------------------------------------------
// checkSkipLoadSpike
// ---------------------------------------------------------------------------

describe("checkSkipLoadSpike", () => {
  it("returns null when next week km is less than or equal to actual km", () => {
    // Runner completed more than planned — no spike
    expect(checkSkipLoadSpike(50, 40, "intermediate")).toBeNull()
    expect(checkSkipLoadSpike(50, 50, "intermediate")).toBeNull()
  })

  it("returns null when the increase is within the allowed cap", () => {
    // Intermediate cap = 10%; 50 × 1.10 = 55 → 54 is fine
    expect(checkSkipLoadSpike(50, 54, "intermediate")).toBeNull()
  })

  it("returns a warning when jump exceeds the level cap", () => {
    // 50 × 1.10 = 55; 70 > 55 → spike
    const result = checkSkipLoadSpike(50, 70, "intermediate")
    expect(result).not.toBeNull()
    expect(result!.spikePct).toBeGreaterThan(10)
    expect(result!.safeMaxKm).toBe(55)
    expect(result!.maxAllowedPct).toBe(10)
  })

  it("returns danger severity when spike > 30%", () => {
    // 50 → 70 = 40% spike
    const result = checkSkipLoadSpike(50, 70, "intermediate")
    expect(result!.severity).toBe("danger")
  })

  it("returns caution severity when spike is 11–30%", () => {
    // Beginner cap = 8%; 50 × 1.08 = 54; jump to 57 = 14% spike
    const result = checkSkipLoadSpike(50, 57, "beginner")
    expect(result!.severity).toBe("caution")
    expect(result!.spikePct).toBeLessThanOrEqual(30)
  })

  it("handles zero actual km (rest week) with danger severity", () => {
    const result = checkSkipLoadSpike(0, 40, "intermediate")
    expect(result).not.toBeNull()
    expect(result!.severity).toBe("danger")
    expect(result!.safeMaxKm).toBe(0)
    expect(result!.spikePct).toBe(100)
  })

  it("returns null for rest week when next week is also a recovery week", () => {
    // previousPlannedKm = 50; nextPlannedKm = 40 (< 50 × 0.85 = 42.5) → recovery
    const result = checkSkipLoadSpike(0, 40, "intermediate", 50)
    expect(result).toBeNull()
  })

  it("respects different level caps", () => {
    // beginner 8%: 50 → 55 (10%) is a spike
    const beg = checkSkipLoadSpike(50, 55, "beginner")
    expect(beg).not.toBeNull()

    // advanced 12%: 50 → 55 (10%) is fine
    const adv = checkSkipLoadSpike(50, 55, "advanced")
    expect(adv).toBeNull()
  })

  it("uses MAX_WEEKLY_INCREASE values for the level caps", () => {
    const result = checkSkipLoadSpike(100, 115, "intermediate")
    expect(result!.maxAllowedPct).toBe(Math.round(MAX_WEEKLY_INCREASE.intermediate * 100))
  })
})
