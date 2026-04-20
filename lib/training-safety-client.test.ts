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

  it("classifies advanced when active-week km > 50 AND sessions/active-week > 4", () => {
    // 12 active weeks × 5 sessions × 12 km = 60 km/wk, 5 sessions/wk
    const activities = Array.from({ length: 60 }, (_, i) => {
      const week = Math.floor(i / 5)
      const dayInWeek = i % 5
      return makeActivity(week * 7 + dayInWeek + 1, 12)
    })
    expect(classifyAthleteLevel(activities)).toBe("advanced")
  })

  it("does NOT classify advanced when sessions/active-week is exactly 4 (needs > 4)", () => {
    // 12 active weeks × 4 sessions × 15 km = 60 km/wk, 4.0 sessions/wk — not > 4
    const activities = Array.from({ length: 48 }, (_, i) => {
      const week = Math.floor(i / 4)
      const dayInWeek = i % 4
      return makeActivity(week * 7 + dayInWeek + 1, 15)
    })
    expect(classifyAthleteLevel(activities)).not.toBe("advanced")
  })

  it("classifies intermediate when active-week km > 20 AND sessions/active-week >= 2", () => {
    // 12 active weeks × 3 sessions × 9 km = 27 km/wk, 3 sessions/wk
    const activities = Array.from({ length: 36 }, (_, i) => {
      const week = Math.floor(i / 3)
      const dayInWeek = i % 3
      return makeActivity(week * 7 + dayInWeek + 1, 9)
    })
    expect(classifyAthleteLevel(activities)).toBe("intermediate")
  })

  it("does NOT classify intermediate when sessions/week < 2", () => {
    // 1 session/wk × 30 km — high volume but too infrequent
    const activities = Array.from({ length: 12 }, (_, i) =>
      makeActivity(i * 7 + 1, 30),
    )
    expect(classifyAthleteLevel(activities)).toBe("beginner")
  })

  it("falls back to beginner when volume per active week is low", () => {
    // 48 sessions × 2 km over ~7 active weeks ≈ 14 km / active wk — below 20
    const activities = Array.from({ length: 48 }, (_, i) =>
      makeActivity(i + 1, 2),
    )
    expect(classifyAthleteLevel(activities)).toBe("beginner")
  })

  it("preserves advanced for a runner with a planned mid-window break", () => {
    // 8 weeks at 5 sessions × 12 km (active), then 4 weeks of nothing.
    // Active-week avg = 60 km, sessions/active-wk = 5, consistency = 8/12 = 67%
    const activities: SafetyActivity[] = []
    for (let week = 0; week < 8; week++) {
      const baseDay = week * 7
      for (let s = 0; s < 5; s++) {
        activities.push(makeActivity(baseDay + s + 1, 12))
      }
    }
    expect(classifyAthleteLevel(activities)).toBe("advanced")
  })

  it("does not promote a sporadic high-volume runner past the consistency gate", () => {
    // 3 active weeks × 100 km = high active-week avg, but 3/12 = 25% active
    // consistency below 33% blocks even intermediate
    const activities: SafetyActivity[] = []
    for (let week = 0; week < 3; week++) {
      const baseDay = week * 7
      for (let s = 0; s < 5; s++) {
        activities.push(makeActivity(baseDay + s + 1, 20))
      }
    }
    expect(classifyAthleteLevel(activities)).toBe("beginner")
  })

  it("exactly at the advanced km threshold (50) without > 4 sessions is intermediate", () => {
    // 50 km/active wk exactly is NOT > 50 → not advanced
    // 12 active weeks × 3 sessions × ~16.7 km = exactly 50 km/active wk with >= 2 sessions
    const activities = Array.from({ length: 36 }, (_, i) => {
      const week = Math.floor(i / 3)
      const dayInWeek = i % 3
      return makeActivity(week * 7 + dayInWeek + 1, 50 / 3)
    })
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
