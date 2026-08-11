/**
 * Heart Rate Analysis Engine
 *
 * Analyzes historical HR data to:
 * - Determine max HR from recorded peaks (falling back to an estimate)
 * - Evaluate whether the athlete's *configured* zones are well calibrated
 * - Generate recommended zone boundaries
 * - Explain, in translatable terms, why an adjustment is recommended
 *
 * Two rules keep the output honest:
 *
 *   1. Calibration is only judged against a max HR the athlete actually set.
 *      With nothing configured there is nothing to be misconfigured about, so
 *      the result is `not_configured`, not a warning.
 *   2. Current and recommended zones always use the same zone model, so the
 *      difference between them reflects the max HR alone — never a silent
 *      switch between percentage-of-max and Karvonen.
 *
 * Zone model: 5 zones, either percentage-of-max-HR or, when a resting HR is
 * known, Karvonen (percentage of HR reserve).
 *   Z1 Recovery  50–60%
 *   Z2 Aerobic   60–70%
 *   Z3 Tempo     70–80%
 *   Z4 Threshold 80–90%
 *   Z5 VO2 Max   90–100%
 */

import type { Activity } from "@/lib/types"
import { gradeAdjustedPace } from "@/lib/training-utils"
import {
  HR_ZONE_LABELS,
  HR_ZONE_PCTS,
  HR_ZONE_MATCH_TOLERANCE,
  HR_MAJOR_MISALIGNMENT_THRESHOLD,
  HR_MINOR_MISALIGNMENT_THRESHOLD,
  HR_ZONE_CLUSTER_THRESHOLD,
  HR_MIN_PEAK_SAMPLES,
  HR_PEAK_SPIKE_GAP,
  HR_PEAK_EFFORT_RATIO,
  RESTING_HR_MIN,
  RESTING_HR_MAX,
  RUN_TYPES,
} from "@/lib/training-constants"

/** Below this many runs with HR, running data alone cannot carry the analysis. */
const MIN_RUNS_FOR_RUN_ONLY_BASIS = 5

// ─── Types ──────────────────────────────────────────

export interface HrZoneBoundary {
  zone: number
  label: string
  min: number   // bpm
  max: number   // bpm
}

export type CalibrationStatus =
  | "well_calibrated"
  | "slightly_misaligned"
  | "likely_misconfigured"
  /** No max HR configured — the engine reports its estimate and judges nothing */
  | "not_configured"
  | "insufficient_data"

/** Which model produced the zone boundaries. Both zone sets always share one. */
export type ZoneModel = "percent_max" | "karvonen"

/**
 * Which activities the HR figures were derived from.
 *
 * Running is preferred: these zones are prescribed for running, and other
 * sports distort them in both directions — cycling sustains a higher HR for
 * the same effort, while a walk that spikes the sensor can hand the athlete a
 * max HR no run of theirs ever produced. But an athlete who mostly walks or
 * rides still deserves an answer, so the analysis falls back to everything
 * rather than refusing, and says which basis it used.
 */
export type AnalysisBasis = "runs" | "all_activities"

/** Where the max HR driving the recommendation came from, worst confidence last */
export type MaxHrSource =
  /** Highest peak actually recorded by the athlete's HR monitor */
  | "recorded_peaks"
  /** Inferred from the highest *average* HR — a guess, used when no peaks exist */
  | "estimated_from_averages"

/**
 * Explanations are emitted as codes plus parameters rather than prose so the
 * UI can render them in the user's language. The engine has no locale.
 */
export type HrExplanationCode =
  | "insufficient_data"
  | "not_configured"
  | "max_hr_higher_than_configured"
  | "max_hr_lower_than_configured"
  | "max_hr_slight_difference"
  | "easy_runs_above_zone2"
  | "activities_cluster_in_one_zone"
  | "threshold_within_zone4"
  | "threshold_above_zone4"
  | "max_hr_from_recorded_peaks"
  | "max_hr_estimated_from_averages"
  | "basis_all_activities"
  | "well_calibrated"

export interface HrExplanation {
  code: HrExplanationCode
  params?: Record<string, string | number>
}

export interface HrAnalysisResult {
  /** Highest max HR actually recorded, after outlier rejection. 0 when unknown. */
  observedMaxHr: number
  /** Max HR the recommendation is built on */
  estimatedMaxHr: number
  /** How `estimatedMaxHr` was arrived at */
  maxHrSource: MaxHrSource
  /** How many activities carried a recorded peak */
  peakSamples: number
  /** Estimated threshold HR from sustained efforts */
  estimatedThresholdHr: number | null
  /** The athlete's configured max HR, or null if they have not set one */
  configuredMaxHr: number | null
  /** The athlete's configured resting HR, or null. Drives the Karvonen model. */
  restingHr: number | null
  /** Model used for both zone sets */
  zoneModel: ZoneModel
  /** Which activities every HR figure above was derived from */
  analysisBasis: AnalysisBasis
  /**
   * Zones implied by the configured max HR. Identical to `recommendedZones`
   * when nothing is configured — there is no second opinion to show.
   */
  currentZones: HrZoneBoundary[]
  /** Recommended zone boundaries */
  recommendedZones: HrZoneBoundary[]
  /** Overall calibration status */
  calibrationStatus: CalibrationStatus
  /** Translatable reasons behind the status */
  explanations: HrExplanation[]
  /** Summary of HR data quality and coverage */
  dataQuality: {
    /** Activities with HR the analysis actually drew on */
    activitiesWithHr: number
    /**
     * Activities with HR held back from the derivation because they were not
     * runs. Always 0 when the basis is all_activities — nothing was excluded.
     */
    excludedNonRunWithHr: number
    totalActivities: number
    recentActivitiesWithHr: number
    highestHrActivity: { name: string; date: string; maxHr: number } | null
  }
  /** Whether recommended zones match current zones (within tolerance) */
  zonesMatch: boolean
  /** Analysis timestamp */
  analyzedAt: string
}

export interface HrAnalysisOptions {
  /** The athlete's configured max HR. Omit when they have not set one. */
  configuredMaxHr?: number | null
  /** The athlete's configured resting HR. Enables the Karvonen model. */
  restingHr?: number | null
}

// ─── Zone construction ──────────────────────────────

/** A resting HR only enters the model when it is physiologically plausible. */
function usableRestingHr(restingHr: number | null | undefined, maxHr: number): number | null {
  if (restingHr == null) return null
  if (restingHr < RESTING_HR_MIN || restingHr > RESTING_HR_MAX) return null
  // Karvonen needs a meaningful reserve; a resting HR near max is bad data.
  if (restingHr >= maxHr * 0.6) return null
  return restingHr
}

/**
 * Builds zones with an explicit model, so the caller — not a hidden threshold
 * inside this function — decides whether Karvonen applies. Both zone sets in
 * a result are built with the same model.
 */
function buildZones(maxHr: number, model: ZoneModel, restingHr: number | null): HrZoneBoundary[] {
  if (model === "karvonen" && restingHr != null) {
    const reserve = maxHr - restingHr
    return HR_ZONE_LABELS.map((label, i) => ({
      zone: i + 1,
      label,
      min: Math.round(restingHr + reserve * HR_ZONE_PCTS[i][0]),
      max: Math.round(restingHr + reserve * HR_ZONE_PCTS[i][1]),
    }))
  }
  return HR_ZONE_LABELS.map((label, i) => ({
    zone: i + 1,
    label,
    min: Math.round(maxHr * HR_ZONE_PCTS[i][0]),
    max: Math.round(maxHr * HR_ZONE_PCTS[i][1]),
  }))
}

// ─── Max HR ─────────────────────────────────────────

/**
 * Determine max HR.
 *
 * Preferred path: the athlete's monitor recorded a peak on each run, so max HR
 * is an observation. The single highest sample is not taken at face value —
 * straps throw isolated spikes — so a peak standing more than
 * HR_PEAK_SPIKE_GAP clear of the next-highest one is discarded as an artifact
 * and the search continues downward, unless the activity's own average HR
 * shows the effort genuinely was maximal.
 *
 * Fallback path (rows synced before peaks were stored, or no HR strap): infer
 * from the highest *average* HR with a buffer, since an average during a hard
 * effort always sits below true max. This is a guess and is labelled as one.
 */
function resolveMaxHr(activitiesWithHr: Activity[]): {
  observedMax: number
  estimatedMax: number
  source: MaxHrSource
  peakSamples: number
  highestActivity: { name: string; date: string; maxHr: number } | null
} {
  const withPeaks = activitiesWithHr.filter(
    (a) => a.max_heart_rate != null && a.max_heart_rate > 0,
  )

  if (withPeaks.length >= HR_MIN_PEAK_SAMPLES) {
    const sorted = [...withPeaks].sort((a, b) => b.max_heart_rate! - a.max_heart_rate!)

    // A peak is credible when either the next-hardest session comes close to
    // it, or the activity's own average HR shows the effort really was
    // maximal. Walk down only past peaks that satisfy neither.
    const credible = (a: Activity, next: Activity | undefined): boolean => {
      const peak = a.max_heart_rate!
      if (next != null && peak - next.max_heart_rate! <= HR_PEAK_SPIKE_GAP) return true
      return a.avg_heart_rate != null && a.avg_heart_rate >= peak * HR_PEAK_EFFORT_RATIO
    }

    let idx = 0
    while (idx < sorted.length - 1 && !credible(sorted[idx], sorted[idx + 1])) {
      idx++
    }

    const best = sorted[idx]
    const observedMax = best.max_heart_rate!

    return {
      observedMax,
      // A recorded peak *is* a max HR observation — multiplying it would
      // reintroduce exactly the fabrication this path removes.
      estimatedMax: observedMax,
      source: "recorded_peaks",
      peakSamples: withPeaks.length,
      highestActivity: { name: best.name, date: best.date, maxHr: observedMax },
    }
  }

  let best = activitiesWithHr[0]
  for (const a of activitiesWithHr) {
    if (a.avg_heart_rate! > best.avg_heart_rate!) best = a
  }
  const observedAvgMax = best.avg_heart_rate!

  // Buffer: a high observed average means the athlete was already near max.
  let multiplier: number
  if (observedAvgMax >= 180) multiplier = 1.05
  else if (observedAvgMax >= 170) multiplier = 1.08
  else if (observedAvgMax >= 160) multiplier = 1.10
  else multiplier = 1.15

  return {
    observedMax: 0,
    estimatedMax: Math.round(observedAvgMax * multiplier),
    source: "estimated_from_averages",
    peakSamples: withPeaks.length,
    highestActivity: { name: best.name, date: best.date, maxHr: observedAvgMax },
  }
}

/**
 * Estimate threshold HR from sustained hard efforts.
 *
 * Looks for activities in the sweet spot: 20-60 min, over 3 km, with HR data.
 * The avg HR of the hardest sustained efforts approximates threshold HR.
 */
function estimateThresholdHr(activities: Activity[]): number | null {
  const sustained = activities.filter(
    (a) =>
      a.avg_heart_rate != null &&
      a.avg_heart_rate > 0 &&
      a.duration_seconds >= 20 * 60 &&
      a.duration_seconds <= 60 * 60 &&
      a.distance_km >= 3,
  )

  if (sustained.length < 3) return null

  // Sort by avg HR descending — top 20% are likely threshold-ish efforts
  const sorted = [...sustained].sort((a, b) => b.avg_heart_rate! - a.avg_heart_rate!)
  const topCount = Math.max(2, Math.ceil(sorted.length * 0.2))
  const topEfforts = sorted.slice(0, topCount)

  const avgOfTop = topEfforts.reduce((s, a) => s + a.avg_heart_rate!, 0) / topEfforts.length
  return Math.round(avgOfTop)
}

/**
 * Detect misalignment between the configured max HR and what the data shows.
 * Only ever called with a max HR the athlete actually set.
 */
function detectMisalignment(
  configuredMaxHr: number,
  recommendedMaxHr: number,
  thresholdHr: number | null,
  activities: Activity[],
  model: ZoneModel,
  restingHr: number | null,
): { status: CalibrationStatus; explanations: HrExplanation[] } {
  const explanations: HrExplanation[] = []
  let severity = 0

  const maxHrDiff = Math.abs(recommendedMaxHr - configuredMaxHr)
  const maxHrPctDiff = maxHrDiff / recommendedMaxHr

  // 1. Max HR significantly different
  if (maxHrPctDiff > HR_MAJOR_MISALIGNMENT_THRESHOLD) {
    severity += 2
    explanations.push({
      code:
        recommendedMaxHr > configuredMaxHr
          ? "max_hr_higher_than_configured"
          : "max_hr_lower_than_configured",
      params: { recommended: recommendedMaxHr, configured: configuredMaxHr, diff: maxHrDiff },
    })
  } else if (maxHrPctDiff > HR_MINOR_MISALIGNMENT_THRESHOLD) {
    severity += 1
    explanations.push({
      code: "max_hr_slight_difference",
      params: { recommended: recommendedMaxHr, configured: configuredMaxHr },
    })
  }

  // Zone boundaries the athlete is training against today.
  const configuredZones = buildZones(configuredMaxHr, model, restingHr)

  // 2. Zone 2 runs appearing too hard
  if (thresholdHr != null) {
    const currentZ2Max = configuredZones[1].max

    // Count easy/long runs where avg HR falls above current Z2 max.
    // Use grade-adjusted pace so hilly runs with artificially slow raw pace
    // don't get misclassified as easy when they were actually hard efforts.
    const longEasyRuns = activities.filter(
      (a) =>
        a.avg_heart_rate != null &&
        a.avg_heart_rate > 0 &&
        a.duration_seconds >= 30 * 60 &&
        a.distance_km >= 5 &&
        a.pace_min_per_km != null &&
        gradeAdjustedPace(a.pace_min_per_km, a.distance_km, a.elevation_gain_m) > 5.5, // slower GAP = likely easy run
    )

    const z2Misclassified = longEasyRuns.filter((a) => a.avg_heart_rate! > currentZ2Max)

    if (longEasyRuns.length >= 3 && z2Misclassified.length / longEasyRuns.length > 0.5) {
      severity += 1
      explanations.push({
        code: "easy_runs_above_zone2",
        params: {
          count: z2Misclassified.length,
          total: longEasyRuns.length,
          zone2Max: currentZ2Max,
        },
      })
    }
  }

  // 3. Most workouts clustering in a single zone
  const withHr = activities.filter((a) => a.avg_heart_rate != null && a.avg_heart_rate > 0)
  if (withHr.length >= 8) {
    const zoneCounts = [0, 0, 0, 0, 0]
    for (const a of withHr) {
      const hr = a.avg_heart_rate!
      // Zone index by upper boundary; anything above Z4 lands in Z5.
      const idx = configuredZones.findIndex((z) => hr < z.max)
      zoneCounts[idx === -1 ? 4 : idx]++
    }

    const maxInOneZone = Math.max(...zoneCounts)
    if (maxInOneZone / withHr.length > HR_ZONE_CLUSTER_THRESHOLD) {
      const dominantZone = zoneCounts.indexOf(maxInOneZone) + 1
      severity += 1
      explanations.push({
        code: "activities_cluster_in_one_zone",
        params: {
          percent: Math.round((maxInOneZone / withHr.length) * 100),
          zone: dominantZone,
        },
      })
    }
  }

  let status: CalibrationStatus
  if (severity === 0) {
    status = "well_calibrated"
    explanations.push({ code: "well_calibrated" })
  } else if (severity <= 1) {
    status = "slightly_misaligned"
  } else {
    status = "likely_misconfigured"
  }

  return { status, explanations }
}

/**
 * Check if two zone sets match within tolerance.
 */
function zonesMatch(a: HrZoneBoundary[], b: HrZoneBoundary[]): boolean {
  if (a.length !== b.length) return false
  return a.every((z, i) =>
    Math.abs(z.min - b[i].min) <= HR_ZONE_MATCH_TOLERANCE &&
    Math.abs(z.max - b[i].max) <= HR_ZONE_MATCH_TOLERANCE,
  )
}

// ─── Public API ─────────────────────────────────────

/**
 * Run the full heart rate zone analysis on a set of activities.
 *
 * Pass every activity: the function decides for itself which ones may drive
 * the HR figures (see AnalysisBasis) while still reporting on the whole
 * history.
 *
 * @param activities All user activities (sorted by date desc preferred)
 * @param options    The athlete's configured max/resting HR. With no
 *                   configured max HR the result is `not_configured`: the
 *                   engine reports its estimate and asserts nothing about
 *                   whether the athlete's setup is wrong.
 */
export function analyzeHeartRateZones(
  activities: Activity[],
  options: HrAnalysisOptions = {},
): HrAnalysisResult {
  const now = new Date().toISOString()
  const configuredMaxHr = options.configuredMaxHr ?? null

  const allWithHr = activities.filter(
    (a) => a.avg_heart_rate != null && a.avg_heart_rate > 0,
  )
  const runsWithHr = allWithHr.filter((a) => RUN_TYPES.has(a.type))

  // Prefer running data, but never at the cost of having no answer at all:
  // an athlete who mostly walks or rides falls back to their full history.
  const basis: AnalysisBasis =
    runsWithHr.length >= MIN_RUNS_FOR_RUN_ONLY_BASIS ? "runs" : "all_activities"
  const withHr = basis === "runs" ? runsWithHr : allWithHr
  const excludedNonRunWithHr = basis === "runs" ? allWithHr.length - runsWithHr.length : 0

  // Insufficient data
  if (withHr.length < 5) {
    const fallbackMax = configuredMaxHr ?? 190
    const resting = usableRestingHr(options.restingHr, fallbackMax)
    const model: ZoneModel = resting != null ? "karvonen" : "percent_max"
    const zones = buildZones(fallbackMax, model, resting)
    return {
      observedMaxHr: 0,
      estimatedMaxHr: fallbackMax,
      maxHrSource: "estimated_from_averages",
      peakSamples: 0,
      estimatedThresholdHr: null,
      configuredMaxHr,
      restingHr: resting,
      zoneModel: model,
      analysisBasis: basis,
      currentZones: zones,
      recommendedZones: zones,
      calibrationStatus: "insufficient_data",
      explanations: [{ code: "insufficient_data" }],
      dataQuality: {
        activitiesWithHr: withHr.length,
        excludedNonRunWithHr,
        totalActivities: activities.length,
        recentActivitiesWithHr: 0,
        highestHrActivity: null,
      },
      zonesMatch: true,
      analyzedAt: now,
    }
  }

  // Recent = last 90 days
  const cutoff90d = Date.now() - 90 * 24 * 60 * 60 * 1000
  const recentWithHr = withHr.filter(
    (a) => new Date(a.date).getTime() >= cutoff90d,
  )

  const { observedMax, estimatedMax, source, peakSamples, highestActivity } =
    resolveMaxHr(withHr)

  const thresholdHr = estimateThresholdHr(withHr)

  // One model for both zone sets, chosen from the configured resting HR only.
  // Nothing here infers a resting HR from training data: subtracting a fixed
  // offset from easy-run averages produced values like 104 bpm, which then
  // silently distorted every Karvonen boundary.
  const restingHr = usableRestingHr(options.restingHr, estimatedMax)
  const zoneModel: ZoneModel = restingHr != null ? "karvonen" : "percent_max"

  const recommendedZones = buildZones(estimatedMax, zoneModel, restingHr)
  const currentZones =
    configuredMaxHr != null
      ? buildZones(configuredMaxHr, zoneModel, restingHr)
      : recommendedZones

  let status: CalibrationStatus
  let explanations: HrExplanation[]

  if (configuredMaxHr == null) {
    // Nothing to compare against — report, don't judge.
    status = "not_configured"
    explanations = [{ code: "not_configured", params: { estimated: estimatedMax } }]
  } else {
    const result = detectMisalignment(
      configuredMaxHr,
      estimatedMax,
      thresholdHr,
      withHr,
      zoneModel,
      restingHr,
    )
    status = result.status
    explanations = result.explanations
  }

  // How much the max HR figure can be trusted, stated either way.
  explanations.push(
    source === "recorded_peaks"
      ? { code: "max_hr_from_recorded_peaks", params: { samples: peakSamples } }
      : { code: "max_hr_estimated_from_averages" },
  )

  // Zones built on rides and walks are worth a caveat; zones built on runs are
  // the expected case and need none.
  if (basis === "all_activities" && allWithHr.length > runsWithHr.length) {
    explanations.push({ code: "basis_all_activities" })
  }

  // Threshold HR corroborates (or contradicts) the Z4 boundary.
  if (thresholdHr != null) {
    const recZ4 = recommendedZones[3]
    if (thresholdHr >= recZ4.min && thresholdHr <= recZ4.max) {
      explanations.push({
        code: "threshold_within_zone4",
        params: { threshold: thresholdHr, zone4Min: recZ4.min, zone4Max: recZ4.max },
      })
    } else if (thresholdHr > recZ4.max) {
      explanations.push({
        code: "threshold_above_zone4",
        params: { threshold: thresholdHr, zone4Max: recZ4.max },
      })
    }
  }

  return {
    observedMaxHr: observedMax,
    estimatedMaxHr: estimatedMax,
    maxHrSource: source,
    peakSamples,
    estimatedThresholdHr: thresholdHr,
    configuredMaxHr,
    restingHr,
    zoneModel,
    analysisBasis: basis,
    currentZones,
    recommendedZones,
    calibrationStatus: status,
    explanations,
    dataQuality: {
      activitiesWithHr: withHr.length,
      excludedNonRunWithHr,
      totalActivities: activities.length,
      recentActivitiesWithHr: recentWithHr.length,
      highestHrActivity: highestActivity,
    },
    zonesMatch: zonesMatch(currentZones, recommendedZones),
    analyzedAt: now,
  }
}
