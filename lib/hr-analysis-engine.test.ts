import { describe, it, expect } from "vitest"
import { analyzeHeartRateZones } from "./hr-analysis-engine"
import type { Activity } from "./types"
import { HR_ZONE_PCTS, HR_PEAK_SPIKE_GAP } from "./training-constants"

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
    max_heart_rate: null,
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

/** Build N activities carrying a recorded peak HR */
function makePeakActivities(count: number, avgHr: number, peakHr: number): Activity[] {
  return Array.from({ length: count }, (_, i) =>
    makeActivity({ avg_heart_rate: avgHr, max_heart_rate: peakHr, date: daysAgo(i + 1) }),
  )
}

/**
 * A polarised training block from a runner whose max HR really is 180: mostly
 * easy aerobic work with a handful of harder sessions, spread across zones.
 * Nothing here should trip a misalignment check when 180 is configured.
 */
function healthyTrainingBlock(): Activity[] {
  const sessions: [avg: number, peak: number, count: number][] = [
    [118, 150, 6], // easy — squarely in Z2
    [135, 160, 2], // steady — Z3
    [150, 170, 2], // tempo — Z4
    [168, 180, 2], // intervals — Z5, and the source of the true peak
  ]
  return sessions.flatMap(([avg, peak, count], group) =>
    Array.from({ length: count }, (_, i) =>
      makeActivity({
        avg_heart_rate: avg,
        max_heart_rate: peak,
        date: daysAgo(group * 10 + i + 1),
      }),
    ),
  )
}

const codes = (r: ReturnType<typeof analyzeHeartRateZones>) => r.explanations.map((e) => e.code)

// ---------------------------------------------------------------------------
// The regression this engine was rewritten for
// ---------------------------------------------------------------------------

describe("analyzeHeartRateZones — no invented baseline", () => {
  // Previously the engine substituted `observedMax × 1.2` for a missing
  // configured max HR and compared it against its own `× 1.05–1.15`
  // recommendation. The two could never agree, so every athlete above ~160 bpm
  // was told their zones were "likely misconfigured" no matter what their data
  // said. Nothing in the app ever stored that 1.2× figure.
  it("never reports a misconfiguration when no max HR is configured", () => {
    for (const peak of [150, 160, 170, 180, 190]) {
      const result = analyzeHeartRateZones(makeHrActivities(20, peak))
      expect(result.calibrationStatus).toBe("not_configured")
      expect(result.configuredMaxHr).toBeNull()
    }
  })

  it("shows a single zone set when nothing is configured", () => {
    const result = analyzeHeartRateZones(makeHrActivities(10, 175))
    expect(result.currentZones).toEqual(result.recommendedZones)
    expect(result.zonesMatch).toBe(true)
    expect(codes(result)).toContain("not_configured")
  })

  it("can reach well_calibrated once a matching max HR is configured", () => {
    // The old engine could not produce this verdict for any athlete at all.
    const result = analyzeHeartRateZones(healthyTrainingBlock(), { configuredMaxHr: 180 })
    expect(result.estimatedMaxHr).toBe(180)
    expect(result.calibrationStatus).toBe("well_calibrated")
    expect(result.zonesMatch).toBe(true)
    expect(codes(result)).toContain("well_calibrated")
  })
})

// ---------------------------------------------------------------------------
// Which activities drive the numbers
// ---------------------------------------------------------------------------

describe("analyzeHeartRateZones — analysis basis", () => {
  it("does not let a walk's sensor spike set max HR", () => {
    // Taken from real data: a 78-minute stroll at 20:33 min/km whose monitor
    // logged a 199 bpm peak against a 138 bpm average. The spike filter alone
    // let it through, because a genuine 190 bpm run peak sat only 9 bpm below
    // it — close enough to read as corroboration.
    const walkSpike = makeActivity({
      type: "Walk",
      name: "Lunch Walk",
      avg_heart_rate: 138,
      max_heart_rate: 199,
      distance_km: 3.775,
      duration_seconds: 4655,
      pace_min_per_km: 20.55,
    })
    const runs = [
      makeActivity({ type: "Run", name: "Evening Run", avg_heart_rate: 159, max_heart_rate: 190 }),
      makeActivity({ type: "Run", avg_heart_rate: 175, max_heart_rate: 189 }),
      makeActivity({ type: "Run", avg_heart_rate: 171, max_heart_rate: 188 }),
      makeActivity({ type: "Run", avg_heart_rate: 156, max_heart_rate: 183 }),
      makeActivity({ type: "Run", avg_heart_rate: 163, max_heart_rate: 181 }),
    ]
    const result = analyzeHeartRateZones([walkSpike, ...runs])

    expect(result.analysisBasis).toBe("runs")
    expect(result.estimatedMaxHr).toBe(190)
    expect(result.dataQuality.highestHrActivity?.name).toBe("Evening Run")
    expect(result.dataQuality.excludedNonRunWithHr).toBe(1)
  })

  it("counts only runs once running data carries the analysis", () => {
    const result = analyzeHeartRateZones([
      ...makePeakActivities(6, 150, 180),
      makeActivity({ type: "Ride", avg_heart_rate: 165, max_heart_rate: 195 }),
      makeActivity({ type: "Walk", avg_heart_rate: 110, max_heart_rate: 130 }),
    ])
    expect(result.analysisBasis).toBe("runs")
    expect(result.dataQuality.activitiesWithHr).toBe(6)
    expect(result.dataQuality.excludedNonRunWithHr).toBe(2)
    // The whole history is still reported, just not used to derive the zones.
    expect(result.dataQuality.totalActivities).toBe(8)
  })

  it("falls back to all activities for someone who mostly rides", () => {
    // Refusing to answer a cyclist is worse than answering with a caveat.
    const result = analyzeHeartRateZones([
      ...Array.from({ length: 8 }, () =>
        makeActivity({ type: "Ride", avg_heart_rate: 150, max_heart_rate: 178 }),
      ),
      makeActivity({ type: "Run", avg_heart_rate: 150, max_heart_rate: 170 }),
    ])
    expect(result.analysisBasis).toBe("all_activities")
    expect(result.calibrationStatus).not.toBe("insufficient_data")
    expect(result.estimatedMaxHr).toBe(178)
    expect(codes(result)).toContain("basis_all_activities")
    // Nothing was held back, so nothing is reported as excluded.
    expect(result.dataQuality.excludedNonRunWithHr).toBe(0)
  })

  it("adds no caveat when the athlete only runs", () => {
    const result = analyzeHeartRateZones(makePeakActivities(8, 150, 185))
    expect(result.analysisBasis).toBe("runs")
    expect(codes(result)).not.toContain("basis_all_activities")
  })

  it("treats every configured run type as running", () => {
    const result = analyzeHeartRateZones([
      makeActivity({ type: "Trail Run", avg_heart_rate: 160, max_heart_rate: 185 }),
      makeActivity({ type: "Race", avg_heart_rate: 172, max_heart_rate: 188 }),
      makeActivity({ type: "Virtual Run", avg_heart_rate: 150, max_heart_rate: 175 }),
      makeActivity({ type: "Treadmill", avg_heart_rate: 148, max_heart_rate: 170 }),
      makeActivity({ type: "Run", avg_heart_rate: 155, max_heart_rate: 178 }),
    ])
    expect(result.analysisBasis).toBe("runs")
    expect(result.dataQuality.excludedNonRunWithHr).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Max HR resolution
// ---------------------------------------------------------------------------

describe("analyzeHeartRateZones — max HR from recorded peaks", () => {
  it("takes max HR straight from recorded peaks, without a multiplier", () => {
    const result = analyzeHeartRateZones(makePeakActivities(8, 150, 186))
    expect(result.maxHrSource).toBe("recorded_peaks")
    expect(result.observedMaxHr).toBe(186)
    expect(result.estimatedMaxHr).toBe(186)
    expect(result.peakSamples).toBe(8)
  })

  it("discards an isolated strap spike instead of adopting it as max HR", () => {
    const normal = makePeakActivities(8, 150, 185)
    const spike = makeActivity({ avg_heart_rate: 150, max_heart_rate: 228, date: daysAgo(40) })
    const result = analyzeHeartRateZones([spike, ...normal])
    expect(result.estimatedMaxHr).toBe(185)
    expect(result.estimatedMaxHr).toBeLessThan(228)
  })

  it("keeps a high peak that the surrounding samples corroborate", () => {
    // Several peaks near 196 — not an artifact, so it must not be discarded.
    const result = analyzeHeartRateZones([
      ...makePeakActivities(4, 165, 196),
      ...makePeakActivities(5, 150, 180),
    ])
    expect(result.estimatedMaxHr).toBe(196)
  })

  it("keeps a single genuine max effort that stands above easy weeks", () => {
    // One hard session peaking 15 bpm above the rest is a real effort, not a
    // glitch — and it is the only sample that reaches anywhere near max HR.
    // A filter judging peaks against the *typical* peak would discard exactly
    // this one.
    const result = analyzeHeartRateZones([
      makeActivity({ avg_heart_rate: 172, max_heart_rate: 180 + HR_PEAK_SPIKE_GAP }),
      ...makePeakActivities(8, 148, 180),
    ])
    expect(result.estimatedMaxHr).toBe(180 + HR_PEAK_SPIKE_GAP)
  })

  it("walks past several stacked artifacts down to credible data", () => {
    const result = analyzeHeartRateZones([
      makeActivity({ avg_heart_rate: 150, max_heart_rate: 229 }),
      makeActivity({ avg_heart_rate: 150, max_heart_rate: 210 }),
      ...makePeakActivities(6, 150, 184),
    ])
    expect(result.estimatedMaxHr).toBe(184)
  })

  it("keeps a lone race peak that the session's own average corroborates", () => {
    // A hard race: peak 195, and an average of 180 across the whole effort.
    // No other session comes near it, but you cannot average 180 bpm without
    // having genuinely been up there — so this is not a strap artifact.
    const result = analyzeHeartRateZones([
      makeActivity({ avg_heart_rate: 180, max_heart_rate: 195, name: "Race" }),
      ...makePeakActivities(20, 150, 170),
    ])
    expect(result.estimatedMaxHr).toBe(195)
    expect(result.dataQuality.highestHrActivity?.name).toBe("Race")
  })

  it("still rejects a lone spike on an otherwise ordinary run", () => {
    // Same 25 bpm gap as the race above, but the average says it was an easy
    // hour — the peak has nothing behind it.
    const result = analyzeHeartRateZones([
      makeActivity({ avg_heart_rate: 132, max_heart_rate: 195, name: "Easy run" }),
      ...makePeakActivities(20, 150, 170),
    ])
    expect(result.estimatedMaxHr).toBe(170)
  })

  it("reports which activity the peak came from", () => {
    const result = analyzeHeartRateZones([
      ...makePeakActivities(5, 150, 175),
      makeActivity({ avg_heart_rate: 168, max_heart_rate: 182, name: "Hill reps" }),
    ])
    expect(result.dataQuality.highestHrActivity?.maxHr).toBe(182)
    expect(result.dataQuality.highestHrActivity?.name).toBe("Hill reps")
  })
})

describe("analyzeHeartRateZones — max HR estimated from averages", () => {
  it("falls back to the average-based estimate when no peaks are recorded", () => {
    const result = analyzeHeartRateZones(makeHrActivities(8, 182))
    expect(result.maxHrSource).toBe("estimated_from_averages")
    expect(result.estimatedMaxHr).toBe(Math.round(182 * 1.05))
    expect(result.peakSamples).toBe(0)
    // The uncertainty is surfaced rather than left implicit.
    expect(codes(result)).toContain("max_hr_estimated_from_averages")
  })

  it("applies 1.10x for observed avg HR between 160 and 170", () => {
    const result = analyzeHeartRateZones(makeHrActivities(8, 163))
    expect(result.estimatedMaxHr).toBe(Math.round(163 * 1.10))
  })

  it("applies 1.15x for observed avg HR below 160", () => {
    const result = analyzeHeartRateZones(makeHrActivities(8, 145))
    expect(result.estimatedMaxHr).toBe(Math.round(145 * 1.15))
  })

  it("reports observedMaxHr as 0 when no peak was ever recorded", () => {
    const result = analyzeHeartRateZones(makeHrActivities(8, 160))
    expect(result.observedMaxHr).toBe(0)
  })

  it("needs at least 3 peaks before treating max HR as observed", () => {
    const result = analyzeHeartRateZones([
      ...makePeakActivities(2, 150, 190),
      ...makeHrActivities(6, 150),
    ])
    expect(result.maxHrSource).toBe("estimated_from_averages")
  })
})

// ---------------------------------------------------------------------------
// Zone construction
// ---------------------------------------------------------------------------

describe("analyzeHeartRateZones — zone boundaries", () => {
  it("produces 5 ascending zones", () => {
    const result = analyzeHeartRateZones(makeHrActivities(8, 160))
    expect(result.currentZones).toHaveLength(5)
    expect(result.recommendedZones).toHaveLength(5)
    for (const zone of [...result.currentZones, ...result.recommendedZones]) {
      expect(zone.min).toBeLessThan(zone.max)
    }
  })

  it("Zone 1 min uses HR_ZONE_PCTS[0][0] fraction of max HR (not hard-coded 0)", () => {
    const result = analyzeHeartRateZones(makeHrActivities(8, 160), { configuredMaxHr: 180 })
    const z1Min = result.currentZones[0].min
    expect(z1Min).toBe(Math.round(180 * HR_ZONE_PCTS[0][0]))
    expect(z1Min).toBeGreaterThan(0)
  })

  it("uses Karvonen for both zone sets when a resting HR is configured", () => {
    const result = analyzeHeartRateZones(makePeakActivities(8, 150, 190), {
      configuredMaxHr: 195,
      restingHr: 48,
    })
    expect(result.zoneModel).toBe("karvonen")
    expect(result.restingHr).toBe(48)

    const expectedRec = Math.round(48 + (result.estimatedMaxHr - 48) * HR_ZONE_PCTS[0][0])
    expect(result.recommendedZones[0].min).toBe(expectedRec)
    // Current zones must use the same model, or the Diff column would be
    // showing a model change dressed up as a max HR change.
    const expectedCur = Math.round(48 + (195 - 48) * HR_ZONE_PCTS[0][0])
    expect(result.currentZones[0].min).toBe(expectedCur)
  })

  it("uses percentage-of-max for both zone sets when no resting HR is set", () => {
    const result = analyzeHeartRateZones(makePeakActivities(8, 150, 190), {
      configuredMaxHr: 195,
    })
    expect(result.zoneModel).toBe("percent_max")
    expect(result.restingHr).toBeNull()
    expect(result.recommendedZones[0].min).toBe(Math.round(190 * HR_ZONE_PCTS[0][0]))
    expect(result.currentZones[0].min).toBe(Math.round(195 * HR_ZONE_PCTS[0][0]))
  })

  it("never infers a resting HR from training data", () => {
    // The old engine derived resting HR as "easy-run average − 45", which
    // returned values around 104 bpm for ordinary runners and then silently
    // reshaped every Karvonen boundary.
    const easyLong = Array.from({ length: 5 }, (_, i) =>
      makeActivity({
        avg_heart_rate: 149,
        duration_seconds: 45 * 60,
        distance_km: 12,
        date: daysAgo(i + 5),
      }),
    )
    const result = analyzeHeartRateZones([...easyLong, ...makeHrActivities(6, 165)])
    expect(result.restingHr).toBeNull()
    expect(result.zoneModel).toBe("percent_max")
  })

  it("rejects an implausible configured resting HR rather than modelling with it", () => {
    const result = analyzeHeartRateZones(makePeakActivities(8, 150, 190), { restingHr: 150 })
    expect(result.restingHr).toBeNull()
    expect(result.zoneModel).toBe("percent_max")
  })
})

// ---------------------------------------------------------------------------
// Calibration status
// ---------------------------------------------------------------------------

describe("analyzeHeartRateZones — calibration status", () => {
  it("flags a configured max HR that is far below the recorded peaks", () => {
    const result = analyzeHeartRateZones(makePeakActivities(10, 170, 190), {
      configuredMaxHr: 155,
    })
    expect(result.calibrationStatus).toBe("likely_misconfigured")
    expect(codes(result)).toContain("max_hr_higher_than_configured")
  })

  it("flags a configured max HR that is far above the recorded peaks", () => {
    const result = analyzeHeartRateZones(makePeakActivities(10, 150, 175), {
      configuredMaxHr: 210,
    })
    expect(result.calibrationStatus).toBe("likely_misconfigured")
    expect(codes(result)).toContain("max_hr_lower_than_configured")
  })

  it("reports only a slight difference for a small discrepancy", () => {
    // Recorded peak 180 vs configured 170 → 5.6%, past the minor threshold
    // but well short of the major one.
    const result = analyzeHeartRateZones(healthyTrainingBlock(), { configuredMaxHr: 170 })
    expect(result.calibrationStatus).toBe("slightly_misaligned")
    expect(codes(result)).toContain("max_hr_slight_difference")
  })

  it("notices when every workout lands in one zone", () => {
    const result = analyzeHeartRateZones(makePeakActivities(12, 178, 190), {
      configuredMaxHr: 190,
    })
    expect(codes(result)).toContain("activities_cluster_in_one_zone")
  })

  it("populates dataQuality fields correctly", () => {
    const withHr = makeHrActivities(6, 155)
    const withoutHr = Array.from({ length: 3 }, () => makeActivity({ avg_heart_rate: null }))
    const result = analyzeHeartRateZones([...withHr, ...withoutHr])
    expect(result.dataQuality.totalActivities).toBe(9)
    expect(result.dataQuality.activitiesWithHr).toBe(6)
  })

  it("zonesMatch is false when the configured max HR is far from the peaks", () => {
    const result = analyzeHeartRateZones(makePeakActivities(8, 160, 185), {
      configuredMaxHr: 150,
    })
    expect(result.zonesMatch).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Insufficient data
// ---------------------------------------------------------------------------

describe("analyzeHeartRateZones — insufficient data", () => {
  it("returns insufficient_data when fewer than 5 activities have HR", () => {
    const result = analyzeHeartRateZones(makeHrActivities(3, 150))
    expect(result.calibrationStatus).toBe("insufficient_data")
    expect(result.zonesMatch).toBe(true)
    expect(codes(result)).toEqual(["insufficient_data"])
  })

  it("returns insufficient_data for empty activities", () => {
    const result = analyzeHeartRateZones([])
    expect(result.calibrationStatus).toBe("insufficient_data")
    expect(result.observedMaxHr).toBe(0)
  })

  it("uses the configured max HR as fallback when data is insufficient", () => {
    const result = analyzeHeartRateZones(makeHrActivities(2, 150), { configuredMaxHr: 185 })
    expect(result.estimatedMaxHr).toBe(185)
    expect(result.currentZones[0].max).toBe(Math.round(185 * HR_ZONE_PCTS[0][1]))
  })

  it("uses 190 bpm as fallback when nothing is configured", () => {
    expect(analyzeHeartRateZones([]).estimatedMaxHr).toBe(190)
  })
})

// ---------------------------------------------------------------------------
// Threshold HR
// ---------------------------------------------------------------------------

describe("analyzeHeartRateZones — threshold HR estimation", () => {
  it("returns null threshold HR when fewer than 3 sustained efforts exist", () => {
    const short = makeHrActivities(8, 155).map((a) => ({
      ...a,
      duration_seconds: 15 * 60,
      distance_km: 2,
    }))
    expect(analyzeHeartRateZones(short).estimatedThresholdHr).toBeNull()
  })

  it("estimates threshold HR from the top 20% of sustained hard efforts", () => {
    const hard = Array.from({ length: 2 }, (_, i) =>
      makeActivity({ avg_heart_rate: 175, duration_seconds: 35 * 60, distance_km: 7, date: daysAgo(i + 1) }),
    )
    const moderate = Array.from({ length: 8 }, (_, i) =>
      makeActivity({ avg_heart_rate: 150, duration_seconds: 35 * 60, distance_km: 7, date: daysAgo(i + 3) }),
    )
    const result = analyzeHeartRateZones([...hard, ...moderate])
    expect(result.estimatedThresholdHr).toBeGreaterThanOrEqual(165)
  })

  it("includes analyzedAt timestamp", () => {
    const result = analyzeHeartRateZones(makeHrActivities(8, 155))
    expect(result.analyzedAt).toBeTruthy()
    expect(new Date(result.analyzedAt).getTime()).not.toBeNaN()
  })
})

// ---------------------------------------------------------------------------
// Explanations are translatable, not prose
// ---------------------------------------------------------------------------

describe("analyzeHeartRateZones — explanations", () => {
  it("emits codes with parameters rather than English sentences", () => {
    const result = analyzeHeartRateZones(makePeakActivities(10, 170, 190), {
      configuredMaxHr: 155,
    })
    const misalignment = result.explanations.find(
      (e) => e.code === "max_hr_higher_than_configured",
    )
    expect(misalignment?.params).toEqual({ recommended: 190, configured: 155, diff: 35 })
    for (const exp of result.explanations) {
      expect(typeof exp.code).toBe("string")
    }
  })

  it("always states where the max HR figure came from", () => {
    expect(codes(analyzeHeartRateZones(makePeakActivities(8, 150, 185)))).toContain(
      "max_hr_from_recorded_peaks",
    )
    expect(codes(analyzeHeartRateZones(makeHrActivities(8, 150)))).toContain(
      "max_hr_estimated_from_averages",
    )
  })
})
