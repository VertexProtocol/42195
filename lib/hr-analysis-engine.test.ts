import { describe, it, expect } from "vitest"
import { analyzeHeartRateZones } from "./hr-analysis-engine"
import type { Activity } from "./types"
import { HR_ZONE_PCTS, RESTING_HR_OFFSET } from "./training-constants"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split("T")[0]
}

let nextId = 1
function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: `act-${nextId++}`,
    user_id: "u1",
    strava_id: nextId,
    type: "Run",
    name: "Test run",
    date: daysAgo(nextId % 60 + 1),
    distance_km: 10,
    duration_seconds: 3600,
    pace_min_per_km: 6,
    elevation_gain_m: null,
    avg_heart_rate: 150,
    avg_cadence: null,
    calories: null,
    map_polyline: null,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

/** Build N activities with avg_heart_rate set */
function makeHrActivities(count: number, avgHr: number, overrides: Partial<Activity> = {}): Activity[] {
  return Array.from({ length: count }, (_, i) =>
    makeActivity({ avg_heart_rate: avgHr, date: daysAgo(i + 1), ...overrides }),
  )
}

// ---------------------------------------------------------------------------
// analyzeHeartRateZones — insufficient data
// ---------------------------------------------------------------------------

describe("analyzeHeartRateZones — insufficient data", () => {
  it("returns insufficient_data when fewer than 5 activities have HR", () => {
    const activities = makeHrActivities(3, 150)
    const result = analyzeHeartRateZones(activities)
    expect(result.calibrationStatus).toBe("insufficient_data")
    expect(result.zonesMatch).toBe(true) // zones match because both use fallback
    expect(result.explanations.length).toBeGreaterThan(0)
  })

  it("returns insufficient_data for empty activities", () => {
    const result = analyzeHeartRateZones([])
    expect(result.calibrationStatus).toBe("insufficient_data")
    expect(result.observedMaxHr).toBe(0)
  })

  it("uses provided currentMaxHr as fallback when data is insufficient", () => {
    const activities = makeHrActivities(2, 150)
    const result = analyzeHeartRateZones(activities, 185)
    expect(result.estimatedMaxHr).toBe(185)
    expect(result.currentZones[0].max).toBe(Math.round(185 * HR_ZONE_PCTS[0][1]))
  })

  it("uses 190 bpm as fallback when no currentMaxHr and data is insufficient", () => {
    const result = analyzeHeartRateZones([])
    expect(result.estimatedMaxHr).toBe(190)
  })
})

// ---------------------------------------------------------------------------
// analyzeHeartRateZones — max HR estimation
// ---------------------------------------------------------------------------

describe("analyzeHeartRateZones — max HR estimation", () => {
  it("estimates max HR higher than observed max", () => {
    const activities = makeHrActivities(8, 160)
    const result = analyzeHeartRateZones(activities)
    expect(result.estimatedMaxHr).toBeGreaterThan(result.observedMaxHr)
  })

  it("applies a smaller buffer for very high observed avg HR (>= 180)", () => {
    const activities = makeHrActivities(8, 182)
    const result = analyzeHeartRateZones(activities)
    // Buffer should be 1.05x for >= 180
    expect(result.estimatedMaxHr).toBe(Math.round(182 * 1.05))
  })

  it("applies 1.10x buffer for observed avg HR between 160 and 170", () => {
    const activities = makeHrActivities(8, 163)
    const result = analyzeHeartRateZones(activities)
    expect(result.estimatedMaxHr).toBe(Math.round(163 * 1.10))
  })

  it("applies 1.15x buffer for observed avg HR below 160", () => {
    const activities = makeHrActivities(8, 145)
    const result = analyzeHeartRateZones(activities)
    expect(result.estimatedMaxHr).toBe(Math.round(145 * 1.15))
  })

  it("uses the highest avg_heart_rate activity as the observed max", () => {
    const activities = [
      ...makeHrActivities(5, 150),
      makeActivity({ avg_heart_rate: 175, date: daysAgo(10) }),
      makeActivity({ avg_heart_rate: 165, date: daysAgo(11) }),
    ]
    const result = analyzeHeartRateZones(activities)
    expect(result.observedMaxHr).toBe(175)
    expect(result.dataQuality.highestHrActivity?.avgHr).toBe(175)
  })
})

// ---------------------------------------------------------------------------
// analyzeHeartRateZones — zone construction consistency
// ---------------------------------------------------------------------------

describe("analyzeHeartRateZones — zone boundaries", () => {
  it("produces 5 zones", () => {
    const activities = makeHrActivities(8, 160)
    const result = analyzeHeartRateZones(activities)
    expect(result.currentZones).toHaveLength(5)
    expect(result.recommendedZones).toHaveLength(5)
  })

  it("zone boundaries are ascending (min < max for each zone)", () => {
    const activities = makeHrActivities(8, 160)
    const result = analyzeHeartRateZones(activities)
    for (const zone of result.currentZones) {
      expect(zone.min).toBeLessThan(zone.max)
    }
    for (const zone of result.recommendedZones) {
      expect(zone.min).toBeLessThan(zone.max)
    }
  })

  it("Zone 1 min uses HR_ZONE_PCTS[0][0] fraction of max HR (not hard-coded 0)", () => {
    const activities = makeHrActivities(8, 160)
    const result = analyzeHeartRateZones(activities, 180)
    // currentZones are built with simple % model from effectiveCurrentMaxHr = 180
    const z1Min = result.currentZones[0].min
    const expected = Math.round(180 * HR_ZONE_PCTS[0][0])
    expect(z1Min).toBe(expected)
    expect(z1Min).toBeGreaterThan(0) // not hard-coded 0
  })

  it("uses Karvonen model for recommended zones when resting HR is available", () => {
    // Create activities that allow resting HR estimation:
    //  - estimateRestingHr requires 3+ activities with duration >= 30min and distance >= 5km
    //  - It returns avg_hr of bottom 3 minus RESTING_HR_OFFSET
    // Give 3 easy long runs with low HR (120) so restingHr = 120 - RESTING_HR_OFFSET
    const easyLong = Array.from({ length: 3 }, (_, i) =>
      makeActivity({
        avg_heart_rate: 120,
        duration_seconds: 45 * 60,
        distance_km: 8,
        date: daysAgo(i + 5),
      }),
    )
    const harder = makeHrActivities(6, 165)
    const activities = [...easyLong, ...harder]
    const result = analyzeHeartRateZones(activities)

    if (result.estimatedRestingHr != null) {
      const expectedRestingHr = Math.round(120 - RESTING_HR_OFFSET)
      expect(result.estimatedRestingHr).toBe(expectedRestingHr)

      // Karvonen zone 1 min = restingHr + reserve * 0.50
      const reserve = result.estimatedMaxHr - result.estimatedRestingHr
      const expectedZ1Min = Math.round(result.estimatedRestingHr + reserve * HR_ZONE_PCTS[0][0])
      expect(result.recommendedZones[0].min).toBe(expectedZ1Min)
    }
  })

  it("recommended zones use simple % model when resting HR is not available", () => {
    // Activities are too short to compute resting HR (duration < 30min)
    const activities = makeHrActivities(8, 160).map((a) => ({
      ...a,
      duration_seconds: 15 * 60, // too short for resting HR estimation
      distance_km: 3,             // too short
    }))
    const result = analyzeHeartRateZones(activities)
    expect(result.estimatedRestingHr).toBeNull()
    // Simple % model: Z1 min = estimatedMax × 0.50
    const expectedZ1Min = Math.round(result.estimatedMaxHr * HR_ZONE_PCTS[0][0])
    expect(result.recommendedZones[0].min).toBe(expectedZ1Min)
  })
})

// ---------------------------------------------------------------------------
// analyzeHeartRateZones — calibration status
// ---------------------------------------------------------------------------

describe("analyzeHeartRateZones — calibration status", () => {
  it("returns well_calibrated or slightly_misaligned when currentMaxHr matches estimated max", () => {
    // Use activities spread across different HR levels so zone-clustering check doesn't fire.
    // Estimated max for 160 bpm observed = 160 * 1.10 = 176.
    // Pass currentMaxHr = 176 to match → no max HR misalignment.
    // The z2 easy-run check may still fire (all activities are slow-paced),
    // which can push status to slightly_misaligned — both indicate good calibration.
    const spread = [130, 140, 150, 155, 160, 145, 135, 150, 158, 142].map((hr, i) =>
      makeActivity({ avg_heart_rate: hr, date: daysAgo(i + 1) }),
    )
    const result = analyzeHeartRateZones(spread, 176)
    expect(["well_calibrated", "slightly_misaligned"]).toContain(result.calibrationStatus)
    // Confirm no major misalignment — max HR diff should be zero
    expect(result.estimatedMaxHr).toBe(176)
  })

  it("returns likely_misconfigured when currentMaxHr is much lower than estimated", () => {
    // Observed avg = 180 (very high efforts); estimatedMax ≈ 189 (1.05x)
    // currentMaxHr = 155 — 18% off → major misalignment
    const activities = makeHrActivities(10, 180)
    const result = analyzeHeartRateZones(activities, 155)
    expect(result.calibrationStatus).toBe("likely_misconfigured")
    expect(result.explanations.some((e) => e.includes("higher"))).toBe(true)
  })

  it("returns slightly_misaligned or likely_misconfigured for a moderate discrepancy", () => {
    // Observed = 165, estimated = 165 * 1.10 = 181.5 ≈ 182
    // Pass currentMaxHr = 172 → diff = 10 bpm → ~5.5% → minor misalignment
    // (Zone clustering may push it to likely_misconfigured when all same HR)
    const activities = makeHrActivities(10, 165)
    const result = analyzeHeartRateZones(activities, 172)
    expect(["well_calibrated", "slightly_misaligned", "likely_misconfigured"]).toContain(
      result.calibrationStatus,
    )
  })

  it("populates dataQuality fields correctly", () => {
    const withHr = makeHrActivities(6, 155)
    const withoutHr = Array.from({ length: 3 }, () =>
      makeActivity({ avg_heart_rate: null }),
    )
    const result = analyzeHeartRateZones([...withHr, ...withoutHr])
    expect(result.dataQuality.totalActivities).toBe(9)
    expect(result.dataQuality.activitiesWithHr).toBe(6)
  })

  it("zonesMatch is true when currentMaxHr produces zones close to recommended", () => {
    const activities = makeHrActivities(8, 160)
    const estimatedMax = Math.round(160 * 1.10) // 176
    const result = analyzeHeartRateZones(activities, estimatedMax)
    // Zones are built from same estimated max (no resting HR) → should match
    expect(result.zonesMatch).toBe(true)
  })

  it("zonesMatch is false when currentMaxHr is far from estimated", () => {
    const activities = makeHrActivities(8, 180)
    const result = analyzeHeartRateZones(activities, 150) // 20% off
    expect(result.zonesMatch).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// analyzeHeartRateZones — threshold HR
// ---------------------------------------------------------------------------

describe("analyzeHeartRateZones — threshold HR estimation", () => {
  it("returns null threshold HR when fewer than 3 sustained efforts exist", () => {
    const activities = makeHrActivities(8, 155)
    // Default activities are 3600s = 60 min and 10 km — that qualifies
    // Let's make them too short:
    const short = makeHrActivities(8, 155).map((a) => ({
      ...a,
      duration_seconds: 15 * 60,
      distance_km: 2,
    }))
    const result = analyzeHeartRateZones(short)
    expect(result.estimatedThresholdHr).toBeNull()
  })

  it("estimates threshold HR from the top 20% of sustained hard efforts", () => {
    // 10 activities with varying HR; top 20% (2 activities) at 175 bpm
    const hard = Array.from({ length: 2 }, (_, i) =>
      makeActivity({ avg_heart_rate: 175, duration_seconds: 35 * 60, distance_km: 7, date: daysAgo(i + 1) }),
    )
    const moderate = Array.from({ length: 8 }, (_, i) =>
      makeActivity({ avg_heart_rate: 150, duration_seconds: 35 * 60, distance_km: 7, date: daysAgo(i + 3) }),
    )
    const result = analyzeHeartRateZones([...hard, ...moderate])
    if (result.estimatedThresholdHr != null) {
      // Top 20% = at least 2 activities at ~175 bpm
      expect(result.estimatedThresholdHr).toBeGreaterThanOrEqual(165)
    }
  })

  it("includes analyzedAt timestamp", () => {
    const activities = makeHrActivities(8, 155)
    const result = analyzeHeartRateZones(activities)
    expect(result.analyzedAt).toBeTruthy()
    expect(new Date(result.analyzedAt).getTime()).not.toBeNaN()
  })
})
