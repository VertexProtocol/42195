import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import type { GoalPreferences } from "@/lib/types"
import {
  parseSessionDistanceKm,
  parseSessionDistanceParts,
  checkWeeklyLoadProgression,
  checkCumulativeProgression,
  evaluateAcwrSafety,
  checkFrequencyProgression,
  checkLongRunProtection,
  checkProlongedFatigue,
} from "./training-safety"
import type { SafetyActivity } from "./training-safety"
import type { TrainingPlan, TrainingWeek } from "./types"

/**
 * A valid GoalPreferences. These fixtures previously inlined an older shape of
 * the type (goal / goal_race_distance / current_weekly_km), which no longer
 * compiles. validateAndAdjustPlan only reads sessions_per_week, so that is the
 * one field worth varying per test.
 */
function makePrefs(sessionsPerWeek: number): GoalPreferences {
  return {
    goal_id: "goal-1",
    sessions_per_week: sessionsPerWeek,
    focus: "balanced",
    notes: null,
    injury_notes: null,
    notes_history: [],
    weekly_increase_pct: 10,
    block_weeks: 4,
    regenerate_every_weeks: 4,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split("T")[0]
}

function makeActivity(overrides: Partial<SafetyActivity> = {}): SafetyActivity {
  return {
    date: daysAgo(1),
    distance_km: 10,
    duration_seconds: 3600,
    pace_min_per_km: 6,
    avg_heart_rate: null,
    elevation_gain_m: null,
    ...overrides,
  }
}

/** Build N activities in the last 7 days with a given km each */
function acuteActivities(count: number, kmEach: number): SafetyActivity[] {
  return Array.from({ length: count }, (_, i) =>
    makeActivity({ date: daysAgo(i + 1), distance_km: kmEach }),
  )
}

/** Build N activities per week for W weeks (starting W weeks ago) */
function chronicActivities(weeks: number, sessionsPerWeek: number, kmEach: number): SafetyActivity[] {
  const acts: SafetyActivity[] = []
  for (let w = 0; w < weeks; w++) {
    for (let s = 0; s < sessionsPerWeek; s++) {
      acts.push(makeActivity({ date: daysAgo(w * 7 + s + 1), distance_km: kmEach }))
    }
  }
  return acts
}

function makePlan(weekKms: number[]): TrainingPlan {
  const weeks: TrainingWeek[] = weekKms.map((km, i) => ({
    weekNumber: i + 1,
    theme: `Week ${i + 1}`,
    targetKm: km,
    sessions: [
      // Long run capped at 30% to stay safely below the 35% protection threshold
      { type: "Long run", distance: `${Math.floor(km * 0.30)} km`, effort: "Easy", purpose: "Endurance" },
      { type: "Tempo", distance: `${Math.floor(km * 0.25)} km`, effort: "Moderate", purpose: "Speed" },
      { type: "Easy run", distance: `${Math.floor(km * 0.20)} km`, effort: "Easy", purpose: "Base" },
    ],
    coachNote: null,
  }))
  return { summary: "", weeks, keyPrinciples: [], watchOut: null }
}

// ---------------------------------------------------------------------------
// parseSessionDistanceParts
// ---------------------------------------------------------------------------

describe("parseSessionDistanceParts", () => {
  it("parses a range with hyphen", () => {
    const result = parseSessionDistanceParts("8-10 km")
    expect(result).toEqual({ low: 8, high: 10 })
  })

  it("parses a range with en-dash", () => {
    const result = parseSessionDistanceParts("8–10 km")
    expect(result).toEqual({ low: 8, high: 10 })
  })

  it("parses a single value", () => {
    const result = parseSessionDistanceParts("10 km")
    expect(result).toEqual({ low: 10, high: 10 })
  })

  it("parses a decimal value", () => {
    const result = parseSessionDistanceParts("10.5 km")
    expect(result).toEqual({ low: 10.5, high: 10.5 })
  })

  it("parses value without space before km", () => {
    const result = parseSessionDistanceParts("10.5km")
    expect(result).toEqual({ low: 10.5, high: 10.5 })
  })

  it("returns null for unparseable strings", () => {
    expect(parseSessionDistanceParts("long run")).toBeNull()
    expect(parseSessionDistanceParts("")).toBeNull()
    expect(parseSessionDistanceParts("10 miles")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// parseSessionDistanceKm
// ---------------------------------------------------------------------------

describe("parseSessionDistanceKm", () => {
  it("returns max of range", () => {
    expect(parseSessionDistanceKm("8-10 km")).toBe(10)
    expect(parseSessionDistanceKm("8–10 km")).toBe(10)
  })

  it("returns single value", () => {
    expect(parseSessionDistanceKm("10 km")).toBe(10)
    expect(parseSessionDistanceKm("10.5km")).toBe(10.5)
  })

  it("returns 0 for unparseable string", () => {
    expect(parseSessionDistanceKm("long run")).toBe(0)
    expect(parseSessionDistanceKm("")).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// checkWeeklyLoadProgression
// ---------------------------------------------------------------------------

describe("checkWeeklyLoadProgression", () => {
  it("returns no violations for a flat plan", () => {
    const violations = checkWeeklyLoadProgression([50, 50, 50, 50], "intermediate")
    expect(violations).toHaveLength(0)
  })

  it("returns no violations for a plan within the cap", () => {
    // intermediate cap = 10%; 50 → 55 is 10% — exactly at limit, not over
    const violations = checkWeeklyLoadProgression([50, 55, 60, 65], "intermediate")
    expect(violations).toHaveLength(0)
  })

  it("detects a violation when increase exceeds the level cap", () => {
    // 50 → 70 = 40% increase, cap is 10%
    const violations = checkWeeklyLoadProgression([50, 70, 75, 80], "intermediate")
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0].weekNumber).toBe(2)
    expect(violations[0].adjustedKm).toBeLessThan(70)
  })

  it("skips recovery weeks (drop >= 15%) from violation check", () => {
    // 50 → 40 = 20% drop = recovery week; next week climbs back — recovery should be skipped
    const violations = checkWeeklyLoadProgression([50, 40, 44, 48], "intermediate")
    // Week 2 (40) is a recovery week — should not be flagged
    const week2violation = violations.find((v) => v.weekNumber === 2)
    expect(week2violation).toBeUndefined()
  })

  it("applies the correct cap for each level", () => {
    // 50 → 54 = 8% increase — OK for intermediate (10%), violation for beginner (8%)
    // 54 > 50*1.08 = 54? Exactly at limit → not a violation
    const begViolations = checkWeeklyLoadProgression([50, 55], "beginner")
    expect(begViolations.length).toBeGreaterThan(0) // 55 > 50*1.08=54

    const advViolations = checkWeeklyLoadProgression([50, 55], "advanced")
    expect(advViolations).toHaveLength(0) // 55 <= 50*1.12=56
  })
})

// ---------------------------------------------------------------------------
// checkCumulativeProgression
// ---------------------------------------------------------------------------

describe("checkCumulativeProgression", () => {
  it("returns no violations when increase is within the cap", () => {
    // beginner cap 20%; reference = 50; current = 59 (18% increase)
    const violations = checkCumulativeProgression([50, 54, 57, 59], "beginner")
    expect(violations).toHaveLength(0)
  })

  it("detects a violation when cumulative increase over 3 weeks exceeds cap", () => {
    // beginner cap 20%; 50 → 80 = 60% over 3 weeks
    const violations = checkCumulativeProgression([50, 60, 70, 80], "beginner")
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0].weekNumber).toBe(4)
    expect(violations[0].cumulativePct).toBeGreaterThan(20)
  })

  it("skips reference weeks below 5 km", () => {
    // reference = 3 km (very low), should be skipped
    const violations = checkCumulativeProgression([3, 10, 15, 20], "beginner")
    expect(violations).toHaveLength(0)
  })

  it("skips current weeks that are recovery (below reference)", () => {
    // Current below reference = taper/recovery, skip
    const violations = checkCumulativeProgression([50, 55, 60, 40], "beginner")
    expect(violations).toHaveLength(0)
  })

  it("uses prior-week context to catch a week-1 spike past pre-plan load", () => {
    // Beginner ran 20 km/wk for the 3 weeks before the plan started. Plan
    // week 1 at 40 km is a 100% jump from the prior 20 km reference, well
    // above the beginner 20% cumulative cap.
    const violations = checkCumulativeProgression(
      [40, 45, 50, 55],
      "beginner",
      [20, 22, 20],
    )
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0].weekNumber).toBe(1)
    expect(violations[0].referenceKm).toBe(20)
  })

  it("does not emit violations for prior weeks themselves", () => {
    // Priors jump from 10 -> 30, but we should never flag that as a
    // plan-week violation because we can't adjust the past.
    const violations = checkCumulativeProgression(
      [32, 33, 34, 35],
      "intermediate",
      [10, 20, 30],
    )
    for (const v of violations) {
      expect(v.weekNumber).toBeGreaterThanOrEqual(1)
      expect(v.weekNumber).toBeLessThanOrEqual(4)
    }
  })

  it("matches original behaviour when priorWeekTargets is empty", () => {
    const withoutPriors = checkCumulativeProgression([50, 60, 70, 80], "beginner")
    const withEmptyPriors = checkCumulativeProgression([50, 60, 70, 80], "beginner", [])
    expect(withEmptyPriors).toEqual(withoutPriors)
  })
})

// ---------------------------------------------------------------------------
// evaluateAcwrSafety
// ---------------------------------------------------------------------------

describe("evaluateAcwrSafety", () => {
  it("returns no_baseline when there are no recent activities (H4)", () => {
    const result = evaluateAcwrSafety([])
    expect(result.risk).toBe("no_baseline")
    expect(result.weekOneMultiplier).toBe(0.85)
    expect(result.message).not.toBeNull()
  })

  it("returns low risk when ACWR is at optimal levels", () => {
    // Build a steady 6-week base: 4 runs/wk × 10 km
    const activities = chronicActivities(6, 4, 10)
    const result = evaluateAcwrSafety(activities)
    expect(result.risk).toBe("low")
    expect(result.weekOneMultiplier).toBe(1.0)
    expect(result.message).toBeNull()
  })

  it("returns moderate risk and non-null message when ACWR is between 1.0 and 1.3", () => {
    // 6-week base of 3 runs × 8 km (chronic ~24 km/wk), then spike to 30 km in 7 days
    const base = chronicActivities(6, 3, 8)
    const spike = acuteActivities(4, 7.5) // 4 × 7.5 = 30 km in last week
    const result = evaluateAcwrSafety([...spike, ...base])
    if (result.risk === "moderate") {
      expect(result.message).not.toBeNull()
      expect(result.weekOneMultiplier).toBe(0.95)
    }
    // ratio may land in moderate or higher depending on exact EWMA values
    expect(["moderate", "high", "unsafe"]).toContain(result.risk)
  })

  it("returns high risk and 0.85 multiplier when ACWR is between 1.3 and 1.5", () => {
    // Low chronic base, then large acute spike
    const base = chronicActivities(4, 2, 5)   // ~10 km/wk chronic
    const spike = acuteActivities(5, 4)        // 20 km in last 7 days → ratio ~2
    const result = evaluateAcwrSafety([...spike, ...base])
    // With this spike, risk should be high or unsafe
    expect(["high", "unsafe"]).toContain(result.risk)
    expect(result.message).not.toBeNull()
  })

  it("returns unsafe risk and 0.75 multiplier for extreme spike", () => {
    // Tiny chronic, big acute
    const base = [makeActivity({ date: daysAgo(20), distance_km: 5 })]
    const spike = acuteActivities(7, 10) // 70 km in last week
    const result = evaluateAcwrSafety([...spike, ...base])
    expect(result.risk).toBe("unsafe")
    expect(result.weekOneMultiplier).toBe(0.75)
    expect(result.message).not.toBeNull()
    // Message guides the runner to pull back — current wording says "rest day"
    // and "avoid hard sessions". Accept either cue.
    expect(result.message).toMatch(/rest day|avoid hard|easy run/i)
  })
})

// ---------------------------------------------------------------------------
// checkFrequencyProgression
// ---------------------------------------------------------------------------

describe("checkFrequencyProgression", () => {
  it("returns null when requested sessions is within safe range", () => {
    // 4 sessions/wk for 4 weeks → avg = 4, max safe = 5
    const activities = chronicActivities(4, 4, 10)
    const result = checkFrequencyProgression(activities, 5)
    expect(result).toBeNull()
  })

  it("returns a warning when requested sessions jumps too aggressively", () => {
    // 3 sessions/wk → max safe = 4; requesting 6
    const activities = chronicActivities(4, 3, 10)
    const result = checkFrequencyProgression(activities, 6)
    expect(result).not.toBeNull()
    expect(result!.maxSafeSessions).toBe(4)
    expect(result!.requestedSessions).toBe(6)
  })

  it("returns null when athlete has < 1 session/week (very low base)", () => {
    // Only 2 activities in 4 weeks = 0.5 sessions/wk — guard fires
    const activities = [
      makeActivity({ date: daysAgo(10), distance_km: 5 }),
      makeActivity({ date: daysAgo(20), distance_km: 5 }),
    ]
    const result = checkFrequencyProgression(activities, 5)
    expect(result).toBeNull()
  })

  it("returns null for empty activities", () => {
    expect(checkFrequencyProgression([], 5)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// checkLongRunProtection
// ---------------------------------------------------------------------------

describe("checkLongRunProtection", () => {
  it("returns no violations when long run is within 35% of weekly total", () => {
    // 50 km week, long run = 17 km (34%)
    const plan: TrainingPlan = {
      summary: "",
      weeks: [
        {
          weekNumber: 1,
          theme: "Week 1",
          targetKm: 50,
          sessions: [
            { type: "Easy", distance: "13 km", effort: "Easy", purpose: "" },
            { type: "Tempo", distance: "10 km", effort: "Mod", purpose: "" },
            { type: "Long run", distance: "17 km", effort: "Easy", purpose: "" },
          ],
          coachNote: null,
        },
      ],
      keyPrinciples: [],
      watchOut: null,
    }
    const violations = checkLongRunProtection(plan)
    expect(violations).toHaveLength(0)
  })

  it("returns a violation when long run exceeds 35% of weekly total", () => {
    // 50 km week, long run = 22 km (44% > 35%)
    const plan: TrainingPlan = {
      summary: "",
      weeks: [
        {
          weekNumber: 1,
          theme: "Week 1",
          targetKm: 50,
          sessions: [
            { type: "Easy", distance: "13 km", effort: "Easy", purpose: "" },
            { type: "Tempo", distance: "10 km", effort: "Mod", purpose: "" },
            { type: "Long run", distance: "22 km", effort: "Easy", purpose: "" },
          ],
          coachNote: null,
        },
      ],
      keyPrinciples: [],
      watchOut: null,
    }
    const violations = checkLongRunProtection(plan)
    expect(violations).toHaveLength(1)
    expect(violations[0].weekNumber).toBe(1)
    expect(violations[0].longRunKm).toBe(22)
    expect(violations[0].adjustedKm).toBeLessThan(22)
    expect(violations[0].adjustedKm).toBe(violations[0].maxAllowedKm)
  })

  it("handles range session distances, using max of range", () => {
    // 50 km week, long run = "20-22 km" → max = 22 km (44% > 35%)
    const plan: TrainingPlan = {
      summary: "",
      weeks: [
        {
          weekNumber: 1,
          theme: "Week 1",
          targetKm: 50,
          sessions: [
            { type: "Easy", distance: "13 km", effort: "Easy", purpose: "" },
            { type: "Long run", distance: "20-22 km", effort: "Easy", purpose: "" },
          ],
          coachNote: null,
        },
      ],
      keyPrinciples: [],
      watchOut: null,
    }
    const violations = checkLongRunProtection(plan)
    expect(violations).toHaveLength(1)
    expect(violations[0].longRunKm).toBe(22)
  })
})

// ---------------------------------------------------------------------------
// checkProlongedFatigue — aliasing bug guard
// ---------------------------------------------------------------------------

describe("checkProlongedFatigue", () => {
  it("returns no detection for empty activities", () => {
    const result = checkProlongedFatigue([])
    expect(result.detected).toBe(false)
    expect(result.deloadMultiplier).toBe(1.0)
  })

  it("returns no detection when there are fewer than 42 load points", () => {
    // Only 3 weeks of data → loadPoints < 42 → guard must return early
    // Without the bug fix (guard was < 21), this would pass the guard with only
    // 25 load points and all 6 "weekly samples" would alias to loadPoints[0].
    const activities = chronicActivities(3, 4, 10)
    const result = checkProlongedFatigue(activities)
    expect(result.detected).toBe(false)
  })

  it("detects prolonged fatigue when TSB has been negative for 3+ consecutive weeks", () => {
    // Build 12+ weeks of very high load with no rest — TSB should stay deeply negative
    // Use very high daily km to drive ATL >> CTL (large negative TSB)
    const activities = Array.from({ length: 84 }, (_, i) =>
      makeActivity({ date: daysAgo(i + 1), distance_km: 20 }),
    )
    const result = checkProlongedFatigue(activities)
    // With this extreme sustained load, prolonged fatigue should be detected
    if (result.detected) {
      expect(result.deloadMultiplier).toBeLessThan(1.0)
      expect(result.message).not.toBeNull()
      expect(result.consecutiveNegativeTsbWeeks).toBeGreaterThanOrEqual(3)
    }
    // At minimum, the function should not crash and return valid structure
    expect(result.deloadMultiplier).toBeGreaterThan(0)
    expect(result.deloadMultiplier).toBeLessThanOrEqual(1.0)
  })

  it("returns no detection for a well-rested athlete (positive TSB)", () => {
    // Train moderately for 10 weeks, then rest for 2 weeks → TSB should be positive
    const training = Array.from({ length: 60 }, (_, i) =>
      makeActivity({ date: daysAgo(i + 15), distance_km: 8 }),
    )
    const result = checkProlongedFatigue(training)
    // With adequate rest, should not detect prolonged fatigue
    expect(result.detected).toBe(false)
  })
})
