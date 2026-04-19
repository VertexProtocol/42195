import { describe, it, expect } from "vitest"
import {
  elevationEffortMultiplier,
  effortAdjustedKm,
  gradeAdjustedPace,
  computeACWR,
  computeTrainingLoad,
  detectPersonalRecords,
  predictRaceTimes,
} from "./training-utils"
import { detectFatigue } from "./training-safety"
import type { Activity } from "./types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split("T")[0]
}

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "a1",
    user_id: "u1",
    strava_id: 1,
    type: "Run",
    name: "Test run",
    date: daysAgo(1),
    distance_km: 10,
    duration_seconds: 3600,
    pace_min_per_km: 6,
    elevation_gain_m: null,
    avg_heart_rate: null,
    avg_cadence: null,
    calories: null,
    map_polyline: null,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// elevationEffortMultiplier
// ---------------------------------------------------------------------------

describe("elevationEffortMultiplier", () => {
  it("returns 1 for flat run (no elevation)", () => {
    expect(elevationEffortMultiplier(10, null)).toBe(1)
    expect(elevationEffortMultiplier(10, 0)).toBe(1)
    expect(elevationEffortMultiplier(10, undefined)).toBe(1)
  })

  it("returns 1 for zero or negative distance", () => {
    expect(elevationEffortMultiplier(0, 100)).toBe(1)
    expect(elevationEffortMultiplier(-1, 100)).toBe(1)
  })

  it("returns > 1 when there is elevation gain", () => {
    // 10 km with 100 m gain → grade = 100/10000 = 1% → multiplier = 1 + 0.01*8 = 1.08
    expect(elevationEffortMultiplier(10, 100)).toBeCloseTo(1.08, 5)
  })

  it("returns 1 for negative elevation (descent — not modelled)", () => {
    // Descents are currently ignored (treated as flat) because the Minetti model
    // used here only adds uphill cost; downhill recovery is not yet accounted for.
    expect(elevationEffortMultiplier(10, -50)).toBe(1)
  })

  it("scales linearly with grade", () => {
    // 5 km with 100 m → grade = 100/5000 = 2% → 1 + 0.02*8 = 1.16
    expect(elevationEffortMultiplier(5, 100)).toBeCloseTo(1.16, 5)
  })

  it("handles a steep mountain run (heavy elevation)", () => {
    // 10 km with 1000 m gain → grade = 10% → multiplier = 1.8
    expect(elevationEffortMultiplier(10, 1000)).toBeCloseTo(1.8, 5)
  })
})

// ---------------------------------------------------------------------------
// effortAdjustedKm
// ---------------------------------------------------------------------------

describe("effortAdjustedKm", () => {
  it("returns raw distance when no elevation", () => {
    expect(effortAdjustedKm(10, null)).toBe(10)
    expect(effortAdjustedKm(10, 0)).toBe(10)
  })

  it("returns distance × multiplier", () => {
    // 10 km + 100 m → 10 × 1.08 = 10.8
    expect(effortAdjustedKm(10, 100)).toBeCloseTo(10.8, 5)
  })

  it("effort-adjusted km is always >= raw km", () => {
    expect(effortAdjustedKm(15, 250)).toBeGreaterThanOrEqual(15)
  })
})

// ---------------------------------------------------------------------------
// gradeAdjustedPace
// ---------------------------------------------------------------------------

describe("gradeAdjustedPace", () => {
  it("returns raw pace for flat run", () => {
    expect(gradeAdjustedPace(6, 10, null)).toBe(6)
    expect(gradeAdjustedPace(6, 10, 0)).toBe(6)
  })

  it("returns faster pace than raw pace on hilly run", () => {
    // Hilly run: raw pace 7 min/km but terrain adds effort → GAP is faster
    const gap = gradeAdjustedPace(7, 10, 100)
    expect(gap).toBeLessThan(7)
  })

  it("is consistent with elevationEffortMultiplier", () => {
    const rawPace = 6
    const distKm = 10
    const elevM = 100
    const expected = rawPace / elevationEffortMultiplier(distKm, elevM)
    expect(gradeAdjustedPace(rawPace, distKm, elevM)).toBeCloseTo(expected, 10)
  })

  it("10 km with 100 m gain: 7 min/km → ~6.48 min/km GAP", () => {
    // multiplier = 1.08, GAP = 7/1.08 ≈ 6.481
    expect(gradeAdjustedPace(7, 10, 100)).toBeCloseTo(7 / 1.08, 3)
  })
})

// ---------------------------------------------------------------------------
// computeACWR — elevation awareness
// ---------------------------------------------------------------------------

describe("computeACWR elevation", () => {
  it("produces same result as flat run when no elevation", () => {
    const activities = [
      { date: daysAgo(2), distance_km: 10, elevation_gain_m: null },
      { date: daysAgo(5), distance_km: 10, elevation_gain_m: 0 },
    ]
    const result = computeACWR(activities)
    expect(result.acuteLoad).toBeCloseTo(20, 1)
  })

  it("increases acute load for hilly runs", () => {
    const flat = [
      { date: daysAgo(2), distance_km: 10, elevation_gain_m: null },
    ]
    const hilly = [
      { date: daysAgo(2), distance_km: 10, elevation_gain_m: 100 },
    ]
    const flatResult = computeACWR(flat)
    const hillyResult = computeACWR(hilly)
    expect(hillyResult.acuteLoad).toBeGreaterThan(flatResult.acuteLoad)
  })

  it("hilly 10km with 100m gain counts as 10.8 km effort", () => {
    const activities = [{ date: daysAgo(2), distance_km: 10, elevation_gain_m: 100 }]
    const result = computeACWR(activities)
    expect(result.acuteLoad).toBeCloseTo(10.8, 1)
  })

  it("elevation only affects load, not the ratio calculation logic", () => {
    const activities = Array.from({ length: 4 }, (_, i) => ({
      date: daysAgo(i * 7 + 1),
      distance_km: 20,
      elevation_gain_m: 200,
    }))
    const result = computeACWR(activities)
    // ratio = acute / chronic should still be a sensible number
    expect(result.ratio).toBeGreaterThan(0)
    expect(result.ratio).toBeLessThan(5)
  })
})

// ---------------------------------------------------------------------------
// computeTrainingLoad — elevation awareness
// ---------------------------------------------------------------------------

describe("computeTrainingLoad elevation", () => {
  it("produces higher ATL/CTL for hilly runs vs flat runs of same distance", () => {
    const flat = [{ date: daysAgo(1), distance_km: 10, elevation_gain_m: null }]
    const hilly = [{ date: daysAgo(1), distance_km: 10, elevation_gain_m: 200 }]

    const flatPoints = computeTrainingLoad(flat)
    const hillyPoints = computeTrainingLoad(hilly)

    const flatLatest = flatPoints[flatPoints.length - 1]
    const hillyLatest = hillyPoints[hillyPoints.length - 1]

    expect(hillyLatest.atl).toBeGreaterThan(flatLatest.atl)
    expect(hillyLatest.ctl).toBeGreaterThan(flatLatest.ctl)
  })

  it("accepts activities without elevation_gain_m field and gives same result as elevation_gain_m: null", () => {
    // Backward-compat: old activities without the field must behave identically to null
    const withoutField = [{ date: daysAgo(1), distance_km: 10 }]
    const withNull = [{ date: daysAgo(1), distance_km: 10, elevation_gain_m: null }]

    const pointsWithout = computeTrainingLoad(withoutField)
    const pointsWithNull = computeTrainingLoad(withNull)

    const latestWithout = pointsWithout[pointsWithout.length - 1]
    const latestWithNull = pointsWithNull[pointsWithNull.length - 1]
    expect(latestWithout.atl).toBe(latestWithNull.atl)
    expect(latestWithout.ctl).toBe(latestWithNull.ctl)
    expect(latestWithout.tsb).toBe(latestWithNull.tsb)
  })

  it("returns empty array for no activities", () => {
    expect(computeTrainingLoad([])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// detectPersonalRecords — elevation-adjusted ranking
// ---------------------------------------------------------------------------

describe("detectPersonalRecords elevation", () => {
  it("hilly run with slower raw time wins when its flat-equivalent time is faster", () => {
    // flatRun: 25:00 flat → flat-equivalent = 25:00
    // hillyRun: 28:00 with 80m on 5km → multiplier = 1 + (80/5000)*8 = 1.128
    //   flat-equivalent = 28:00 / 1.128 ≈ 24:49 → FASTER than the flat run
    const flatRun = makeActivity({
      id: "flat",
      distance_km: 5,
      duration_seconds: 25 * 60,
      elevation_gain_m: null,
      date: daysAgo(10),
    })
    const hillyRun = makeActivity({
      id: "hilly",
      distance_km: 5,
      duration_seconds: 28 * 60,
      elevation_gain_m: 80,
      date: daysAgo(5),
    })

    const records = detectPersonalRecords([flatRun, hillyRun])
    const fiveK = records.find((r) => r.distance_label === "5 km")
    expect(fiveK).toBeDefined()
    // hillyRun has the better flat-equivalent time (24:49 < 25:00) so it should win
    expect(fiveK!.activity.id).toBe("hilly")
  })

  it("flat run wins when it is genuinely faster on flat terrain", () => {
    const flatRun = makeActivity({
      id: "fast-flat",
      distance_km: 5,
      duration_seconds: 22 * 60, // 22 min flat
      elevation_gain_m: null,
      date: daysAgo(10),
    })
    const hillyRun = makeActivity({
      id: "slow-hilly",
      distance_km: 5,
      duration_seconds: 30 * 60, // 30 min with gain — even adjusted, slower
      elevation_gain_m: 80,
      date: daysAgo(5),
    })

    const records = detectPersonalRecords([flatRun, hillyRun])
    const fiveK = records.find((r) => r.distance_label === "5 km")
    expect(fiveK!.activity.id).toBe("fast-flat")
  })
})

// ---------------------------------------------------------------------------
// predictRaceTimes — elevation-adjusted reference
// ---------------------------------------------------------------------------

describe("predictRaceTimes elevation", () => {
  it("predicts faster times when reference run is hilly (flat-equivalent faster)", () => {
    // Same run, one with elevation — the hilly version should project faster predictions
    const flatRef = makeActivity({
      distance_km: 10,
      duration_seconds: 60 * 60, // 60 min flat
      elevation_gain_m: null,
      date: daysAgo(5),
    })
    const hillyRef = makeActivity({
      distance_km: 10,
      duration_seconds: 60 * 60, // same raw time but on hilly course
      elevation_gain_m: 100,     // multiplier = 1.08 → flat-eq = 55.5 min
      date: daysAgo(5),
    })

    const { predictions: flatPreds } = predictRaceTimes([flatRef])
    const { predictions: hillyPreds } = predictRaceTimes([hillyRef])

    const flat5k = flatPreds.find((p) => p.distance_label === "5 km")!
    const hilly5k = hillyPreds.find((p) => p.distance_label === "5 km")!

    // Hilly reference = faster flat-equivalent → faster predicted race time
    expect(hilly5k.predicted_seconds).toBeLessThan(flat5k.predicted_seconds)
  })

  it("flat run produces same predictions regardless of elevation_gain_m = 0 or null", () => {
    const runNull = makeActivity({ distance_km: 5, duration_seconds: 25 * 60, elevation_gain_m: null })
    const runZero = makeActivity({ distance_km: 5, duration_seconds: 25 * 60, elevation_gain_m: 0 })

    const { predictions: predsNull } = predictRaceTimes([runNull])
    const { predictions: predsZero } = predictRaceTimes([runZero])

    for (let i = 0; i < predsNull.length; i++) {
      expect(predsNull[i].predicted_seconds).toBe(predsZero[i].predicted_seconds)
    }
  })
})

// ---------------------------------------------------------------------------
// detectFatigue — grade-adjusted pace comparison
// ---------------------------------------------------------------------------

describe("detectFatigue elevation (GAP)", () => {
  // Build 12 activities: 4 recent + 8 baseline
  // Recent runs are hilly (artificially slow raw pace) but same GAP as baseline
  // Without GAP, this would trigger a false "pace_declining" signal

  function makeRuns(
    count: number,
    startDaysAgo: number,
    pacePerKm: number,
    elevationM: number | null,
  ) {
    return Array.from({ length: count }, (_, i) => ({
      date: daysAgo(startDaysAgo + i),
      distance_km: 10,
      duration_seconds: Math.round(pacePerKm * 10 * 60),
      pace_min_per_km: pacePerKm,
      avg_heart_rate: 150,
      elevation_gain_m: elevationM,
    }))
  }

  it("does NOT flag pace_declining when hilly recent runs have same GAP as baseline", () => {
    // Baseline: 8 flat runs at 6:00/km → GAP = 6:00
    const baseline = makeRuns(8, 30, 6.0, null)
    // Recent: 4 hilly runs at 6.48/km (≈ 6/1.08) but with 100m gain → GAP ≈ 6:00
    const hillyPace = 6.0 * 1.08 // raw pace on a 1.08× course
    const recent = makeRuns(4, 2, hillyPace, 100)

    const result = detectFatigue([...recent, ...baseline])
    expect(result.signal).not.toBe("pace_declining")
    expect(result.signal).not.toBe("both")
  })

  it("DOES flag pace_declining when GAP is genuinely worse (not just hilly)", () => {
    // Baseline: 8 flat runs at 6:00/km
    const baseline = makeRuns(8, 30, 6.0, null)
    // Recent: 4 flat runs at 6.50/km — genuinely slower
    const recent = makeRuns(4, 2, 6.5, null)

    const result = detectFatigue([...recent, ...baseline])
    expect(result.signal).toMatch(/pace_declining|both/)
  })

  it("returns none signal when not enough runs", () => {
    const runs = makeRuns(4, 5, 6.0, null)
    const result = detectFatigue(runs)
    expect(result.signal).toBe("none")
  })

  it("returns none when the latest qualifying run is older than the freshness window", () => {
    // Baseline would produce pace_declining: recent (11-14 days ago) at 6.50/km,
    // baseline (21+ days ago) at 6:00/km. But the latest run is > 10 days old, so
    // the freshness guard should short-circuit to "none" regardless of the trend.
    const baseline = makeRuns(8, 30, 6.0, null)
    const recent = makeRuns(4, 14, 6.5, null) // 14–17 days ago
    const result = detectFatigue([...recent, ...baseline])
    expect(result.signal).toBe("none")
  })

  it("still detects fatigue when the latest run is within the freshness window", () => {
    // Latest run is 2 days ago → inside window → normal detection logic applies
    const baseline = makeRuns(8, 30, 6.0, null)
    const recent = makeRuns(4, 2, 6.5, null)
    const result = detectFatigue([...recent, ...baseline])
    expect(result.signal).toMatch(/pace_declining|both/)
  })
})
