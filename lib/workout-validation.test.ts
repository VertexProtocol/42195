import { describe, it, expect } from "vitest"
import {
  computeExpectedDistanceKm,
  parseDeclaredDistanceKm,
  reconcileSession,
  reconcileWorkoutDistances,
} from "./workout-validation"
import type { TrainingPlan, TrainingSession, Workout } from "./types"

// ─── Helpers ────────────────────────────────────────────────────────────────

const mockSession = (overrides: Partial<TrainingSession> = {}): TrainingSession => ({
  type: "Tempo intervals",
  distance: "10 km",
  effort: "Tempo",
  purpose: "Threshold stimulus",
  ...overrides,
})

// ─── parseDeclaredDistanceKm ────────────────────────────────────────────────

describe("parseDeclaredDistanceKm", () => {
  it("parses a single km value", () => {
    expect(parseDeclaredDistanceKm("7.5 km")).toBe(7.5)
    expect(parseDeclaredDistanceKm("10 km")).toBe(10)
  })

  it("parses a range and averages", () => {
    expect(parseDeclaredDistanceKm("8–10 km")).toBe(9)
    expect(parseDeclaredDistanceKm("6-8 km")).toBe(7)
  })

  it('handles "km total" and similar tails', () => {
    expect(parseDeclaredDistanceKm("11 km total")).toBe(11)
  })

  it("returns null when no km value is found", () => {
    expect(parseDeclaredDistanceKm("45 min")).toBeNull()
    expect(parseDeclaredDistanceKm("")).toBeNull()
  })
})

// ─── computeExpectedDistanceKm ──────────────────────────────────────────────

describe("computeExpectedDistanceKm", () => {
  it("sums steady-only workout directly", () => {
    const workout: Workout = {
      blocks: [{ kind: "steady", distance_km: 6 }],
    }
    expect(computeExpectedDistanceKm(workout)).toBe(6)
  })

  it("converts warmup/cooldown via easy pace", () => {
    const workout: Workout = {
      blocks: [
        { kind: "warmup", minutes: 13 },
        { kind: "cooldown", minutes: 13 },
      ],
    }
    // 26 min / 6.5 min/km default easy = 4 km
    expect(computeExpectedDistanceKm(workout)).toBeCloseTo(4, 2)
  })

  it("honours a supplied easy pace", () => {
    const workout: Workout = {
      blocks: [{ kind: "warmup", minutes: 10 }],
    }
    // 10 min / 5 min/km = 2 km
    expect(computeExpectedDistanceKm(workout, { easyPaceMinPerKm: 5 })).toBe(2)
  })

  it("sums reps with recovery distance", () => {
    const workout: Workout = {
      blocks: [
        { kind: "reps", count: 4, distance_m: 1000, recovery_m: 400 },
      ],
    }
    // 4 km work + 4 * 0.4 km recovery = 5.6 km
    expect(computeExpectedDistanceKm(workout)).toBeCloseTo(5.6, 2)
  })

  it("sums reps with recovery minutes", () => {
    const workout: Workout = {
      blocks: [
        { kind: "reps", count: 3, distance_m: 800, recovery_minutes: 2 },
      ],
    }
    // Work: 2.4 km. Recovery: 3 * 2 min / 6.5 min/km ≈ 0.923 km
    expect(computeExpectedDistanceKm(workout)).toBeCloseTo(3.323, 2)
  })

  it("handles a full tempo-intervals session", () => {
    const workout: Workout = {
      blocks: [
        { kind: "warmup", minutes: 12 },
        { kind: "reps", count: 4, distance_m: 1000, recovery_m: 400 },
        { kind: "cooldown", minutes: 10 },
      ],
    }
    // 12/6.5 ≈ 1.846 + 4 + 4*0.4 = 1.6 + 10/6.5 ≈ 1.538
    // = 1.846 + 4 + 1.6 + 1.538 ≈ 8.98 km
    const expected = computeExpectedDistanceKm(workout)
    expect(expected).toBeGreaterThan(8.5)
    expect(expected).toBeLessThan(9.5)
  })

  it("handles the screenshot variable-pace session", () => {
    // Warmup 10 min + 20 min fartlek + cooldown 10 min — session shown as 7.5 km
    const workout: Workout = {
      blocks: [
        { kind: "warmup", minutes: 10 },
        { kind: "fartlek", total_minutes: 20, description: "90s on / 90s off × 6" },
        { kind: "cooldown", minutes: 10 },
      ],
    }
    // 20/6.5 easy = 3.077
    // Fartlek: blended pace = (6.5 + 4.5)/2 = 5.5, 20/5.5 = 3.636
    // Total ≈ 6.71 km — clearly less than declared 7.5
    const expected = computeExpectedDistanceKm(workout)
    expect(expected).toBeLessThan(7.0)
  })
})

// ─── reconcileSession ───────────────────────────────────────────────────────

describe("reconcileSession", () => {
  it("leaves a session without workout untouched", () => {
    const session = mockSession({ workout: undefined })
    const result = reconcileSession(session)
    expect(result.issue).toBeNull()
    expect(result.session).toBe(session)
  })

  it("leaves a consistent session untouched", () => {
    const session = mockSession({
      distance: "9 km total",
      workout: {
        blocks: [
          { kind: "warmup", minutes: 12 },
          { kind: "reps", count: 4, distance_m: 1000, recovery_m: 400 },
          { kind: "cooldown", minutes: 10 },
        ],
      },
    })
    const result = reconcileSession(session)
    expect(result.issue).toBeNull()
    expect(result.session.distance).toBe("9 km total")
  })

  it("rewrites the declared distance when blocks disagree materially", () => {
    // Declared 7.5 km, actual ≈ 6.7 km → 11.4% — within tolerance, no rewrite
    const session1 = mockSession({
      distance: "7.5 km",
      workout: {
        blocks: [
          { kind: "warmup", minutes: 10 },
          { kind: "fartlek", total_minutes: 20, description: "..." },
          { kind: "cooldown", minutes: 10 },
        ],
      },
    })
    const result1 = reconcileSession(session1)
    expect(result1.issue).toBeNull()

    // Declared 10 km, actual ≈ 5.6 km → ~79% deviation → rewrite
    const session2 = mockSession({
      distance: "10 km",
      workout: {
        blocks: [
          { kind: "reps", count: 4, distance_m: 1000, recovery_m: 400 },
        ],
      },
    })
    const result2 = reconcileSession(session2)
    expect(result2.issue).not.toBeNull()
    expect(result2.session.distance).toMatch(/5\.6\s*km/)
    expect(result2.issue!.declaredKm).toBe(10)
    expect(result2.issue!.expectedKm).toBeCloseTo(5.6, 1)
  })

  it("ignores sessions with unparseable distance strings", () => {
    const session = mockSession({
      distance: "about 45 minutes",
      workout: {
        blocks: [{ kind: "steady", distance_km: 5 }],
      },
    })
    const result = reconcileSession(session)
    expect(result.issue).toBeNull()
    expect(result.session.distance).toBe("about 45 minutes")
  })
})

// ─── reconcileWorkoutDistances (plan-level) ─────────────────────────────────

describe("reconcileWorkoutDistances", () => {
  it("propagates issues with correct week/session indices", () => {
    const plan: TrainingPlan = {
      summary: "test",
      keyPrinciples: [],
      watchOut: null,
      weeks: [
        {
          weekNumber: 1,
          theme: "test",
          targetKm: 30,
          coachNote: null,
          sessions: [
            mockSession({ type: "Base run", distance: "6 km" }), // no workout
            mockSession({
              type: "Tempo intervals",
              distance: "10 km",
              workout: {
                blocks: [{ kind: "reps", count: 4, distance_m: 1000, recovery_m: 400 }],
              },
            }),
          ],
        },
      ],
    }
    const result = reconcileWorkoutDistances(plan)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0].weekNumber).toBe(1)
    expect(result.issues[0].sessionIndex).toBe(1)
    expect(result.issues[0].sessionType).toBe("Tempo intervals")
    expect(result.reconciledPlan.weeks[0].sessions[1].distance).toMatch(/km total$/)
    expect(result.reconciledPlan.weeks[0].sessions[0].distance).toBe("6 km") // untouched
  })
})
