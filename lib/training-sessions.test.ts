import { describe, it, expect } from "vitest"
import {
  allocateSessionDistances,
  longRunMaxFraction,
  longRunWithinCap,
  minSessionKm,
  parseSessionDistanceKm,
  isLongRunType,
} from "./training-sessions"
import { LONG_RUN_MIN_LEAD_KM, SESSION_DISTANCE_STEP_KM } from "./training-constants"

const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 10) / 10

describe("longRunMaxFraction", () => {
  it("relaxes the cap when 35% is unreachable", () => {
    // Two sessions: the longest one is at least 50% of the week by definition,
    // so a literal 0.35 cap can never be met.
    expect(longRunMaxFraction(2)).toBeGreaterThan(0.5)
    expect(longRunMaxFraction(3)).toBeGreaterThan(1 / 3)
  })

  it("holds the 35% cap once the session count makes it reachable", () => {
    expect(longRunMaxFraction(4)).toBe(0.35)
    expect(longRunMaxFraction(6)).toBe(0.35)
  })

  it("always exceeds 1/n, which is what makes the long run strictly longest", () => {
    for (let n = 2; n <= 8; n++) {
      expect(longRunMaxFraction(n)).toBeGreaterThan(1 / n)
    }
  })
})

describe("allocateSessionDistances", () => {
  it("keeps the long run inside the cap for the case the old pipeline broke", () => {
    // Regression: a 40 km week that the safety engine capped at 14 km came back
    // out at 16 km (40% of the week) once the correction pass rescaled sessions
    // to the weekly target and gave the long run the remainder.
    const { distances } = allocateSessionDistances(40, ["Long run", "Base run", "Base run"])
    const longest = Math.max(...distances)

    expect(longest).toBeLessThanOrEqual(40 * longRunMaxFraction(3))
    expect(longest).toBeLessThan(16)
    expect(longRunWithinCap(distances, 40)).toBe(true)
  })

  it("sums exactly to the target", () => {
    for (const target of [12, 15, 20, 27.5, 33, 40, 61.5, 84]) {
      for (const n of [2, 3, 4, 5, 6]) {
        const types = ["Long run", ...Array(n - 1).fill("Base run")]
        const { distances } = allocateSessionDistances(target, types)
        expect(sum(distances)).toBe(Math.round(target / SESSION_DISTANCE_STEP_KM) * SESSION_DISTANCE_STEP_KM)
      }
    }
  })

  it("puts the long run on the long-run session and makes it strictly longest", () => {
    const types = ["Base run", "Long run", "Tempo run", "Recovery run"]
    const { distances } = allocateSessionDistances(50, types)
    const longIdx = types.findIndex(isLongRunType)

    expect(distances[longIdx]).toBe(Math.max(...distances))
    const others = distances.filter((_, i) => i !== longIdx)
    expect(distances[longIdx]).toBeGreaterThan(Math.max(...others))
  })

  it("gives the long run a usable lead at realistic volumes", () => {
    const { distances } = allocateSessionDistances(45, ["Long run", "Base run", "Base run", "Base run"])
    const [long, ...others] = distances
    expect(long - Math.max(...others)).toBeGreaterThanOrEqual(LONG_RUN_MIN_LEAD_KM)
  })

  it("lets the share cap win over the lead when the two conflict", () => {
    // A small two-session week cannot have both a 2 km lead and a bounded
    // long-run share. The cap is the safety rule, so it wins; the lead does not.
    const { distances } = allocateSessionDistances(12, ["Long run", "Base run"])
    expect(longRunWithinCap(distances, 12)).toBe(true)
    expect(distances[0]).toBeGreaterThan(distances[1])
    expect(sum(distances)).toBe(12)
  })

  it("rounds every distance to a half kilometre", () => {
    const { distances } = allocateSessionDistances(37, ["Long run", "Base run", "Base run"])
    for (const d of distances) {
      expect(Math.round(d * 2) / 2).toBe(d)
    }
  })

  it("never allocates a zero-length session", () => {
    const { distances } = allocateSessionDistances(9, ["Long run", "Base run", "Base run", "Base run"])
    for (const d of distances) expect(d).toBeGreaterThan(0)
  })

  it("reports when the week cannot support the session count", () => {
    // 5 sessions in a 12 km week means ~2.4 km each — under any useful minimum.
    const tooMany = allocateSessionDistances(12, ["Long run", ...Array(4).fill("Base run")])
    expect(tooMany.belowMinimum).toBe(true)

    const comfortable = allocateSessionDistances(45, ["Long run", "Base run", "Base run"])
    expect(comfortable.belowMinimum).toBe(false)
  })

  it("uses the relaxed minimum below 15 km/week", () => {
    expect(minSessionKm(12)).toBe(4)
    expect(minSessionKm(15)).toBe(5)
    expect(minSessionKm(40)).toBe(5)
  })

  it("splits evenly when the week has no long run", () => {
    const { distances } = allocateSessionDistances(30, ["Base run", "Tempo run", "Recovery run"])
    expect(sum(distances)).toBe(30)
    expect(Math.max(...distances) - Math.min(...distances)).toBeLessThanOrEqual(SESSION_DISTANCE_STEP_KM)
  })

  it("handles the degenerate cases", () => {
    expect(allocateSessionDistances(40, []).distances).toEqual([])
    expect(allocateSessionDistances(18, ["Long run"]).distances).toEqual([18])
    expect(allocateSessionDistances(0, ["Long run", "Base run"]).distances).toEqual([0, 0])
  })
})

describe("parseSessionDistanceKm", () => {
  it("reads single values and the high end of ranges", () => {
    expect(parseSessionDistanceKm("12 km")).toBe(12)
    expect(parseSessionDistanceKm("10.5km")).toBe(10.5)
    expect(parseSessionDistanceKm("8-10 km")).toBe(10)
    expect(parseSessionDistanceKm("8–10 km")).toBe(10)
  })

  it("returns 0 for unparseable input rather than NaN", () => {
    expect(parseSessionDistanceKm("easy 45 minutes")).toBe(0)
    expect(parseSessionDistanceKm("")).toBe(0)
  })
})
