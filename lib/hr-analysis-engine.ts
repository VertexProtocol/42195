/**
 * Heart Rate Analysis Engine
 *
 * Analyzes historical HR data to:
 * - Determine observed max HR and estimated threshold HR
 * - Evaluate whether current zones are well calibrated
 * - Generate recommended zone boundaries
 * - Provide clear explanations for recommendations
 *
 * Zone model: 5-zone percentage-of-max-HR
 *   Z1 Recovery  50–60%
 *   Z2 Aerobic   60–70%
 *   Z3 Tempo     70–80%
 *   Z4 Threshold 80–90%
 *   Z5 VO2 Max   90–100%
 */

import type { Activity } from "@/lib/types"

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
  | "insufficient_data"

export interface HrAnalysisResult {
  /** Observed max HR across all activities */
  observedMaxHr: number
  /** Estimated true max HR (observed + small buffer for sub-max efforts) */
  estimatedMaxHr: number
  /** Estimated threshold HR from sustained efforts */
  estimatedThresholdHr: number | null
  /** Average resting HR approximation */
  estimatedRestingHr: number | null
  /** Current zone boundaries (derived from current max HR estimate) */
  currentZones: HrZoneBoundary[]
  /** Recommended zone boundaries */
  recommendedZones: HrZoneBoundary[]
  /** Overall calibration status */
  calibrationStatus: CalibrationStatus
  /** Human-readable explanations for why adjustments are recommended */
  explanations: string[]
  /** Summary of HR data quality and coverage */
  dataQuality: {
    activitiesWithHr: number
    totalActivities: number
    recentActivitiesWithHr: number
    highestHrActivity: { name: string; date: string; avgHr: number } | null
  }
  /** Whether recommended zones match current zones (within tolerance) */
  zonesMatch: boolean
  /** Analysis timestamp */
  analyzedAt: string
}

// ─── Constants ──────────────────────────────────────

const ZONE_LABELS = ["Recovery", "Aerobic", "Tempo", "Threshold", "VO2 Max"]

/** Default zone percentages of max HR */
const ZONE_PCTS: [number, number][] = [
  [0.50, 0.60],
  [0.60, 0.70],
  [0.70, 0.80],
  [0.80, 0.90],
  [0.90, 1.00],
]

/** BPM tolerance for zone match comparison */
const ZONE_MATCH_TOLERANCE = 3

// ─── Core Engine ────────────────────────────────────

/**
 * Builds HR zones. If restingHr is provided, uses Karvonen (HR reserve) model
 * which is more accurate for individual athletes:
 *   target = restingHR + (maxHR - restingHR) × intensity%
 * Otherwise falls back to simple percentage-of-max model.
 */
function buildZones(maxHr: number, restingHr?: number | null): HrZoneBoundary[] {
  if (restingHr && restingHr > 30 && restingHr < maxHr * 0.5) {
    const reserve = maxHr - restingHr
    return ZONE_LABELS.map((label, i) => ({
      zone: i + 1,
      label,
      min: Math.round(restingHr + reserve * ZONE_PCTS[i][0]),
      max: Math.round(restingHr + reserve * ZONE_PCTS[i][1]),
    }))
  }
  return ZONE_LABELS.map((label, i) => ({
    zone: i + 1,
    label,
    min: Math.round(maxHr * ZONE_PCTS[i][0]),
    max: Math.round(maxHr * ZONE_PCTS[i][1]),
  }))
}

/**
 * Estimate true max HR from activity data.
 *
 * We take the highest avg HR observed and apply a multiplier,
 * because avg HR during a hard effort is always below true max.
 * For very high avg HR values (>175 bpm) the buffer is smaller
 * since the athlete was likely near max.
 */
function estimateMaxHr(activitiesWithHr: Activity[]): {
  observedMax: number
  estimatedMax: number
  highestActivity: { name: string; date: string; avgHr: number }
} {
  let best = activitiesWithHr[0]
  for (const a of activitiesWithHr) {
    if (a.avg_heart_rate! > best.avg_heart_rate!) best = a
  }

  const observedMax = best.avg_heart_rate!

  // Buffer: high observed avg HR gets a smaller buffer
  let multiplier: number
  if (observedMax >= 180) multiplier = 1.05
  else if (observedMax >= 170) multiplier = 1.08
  else if (observedMax >= 160) multiplier = 1.10
  else multiplier = 1.15

  const estimatedMax = Math.round(observedMax * multiplier)

  return {
    observedMax,
    estimatedMax,
    highestActivity: { name: best.name, date: best.date, avgHr: observedMax },
  }
}

/**
 * Estimate threshold HR from sustained hard efforts.
 *
 * Looks for activities in the sweet spot: 20-60 min, pace > 3 km,
 * with HR data. The avg HR of the hardest sustained efforts
 * approximates threshold HR.
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
 * Estimate resting HR from the lowest avg HR in easy long runs.
 * Not truly resting HR, but a proxy from training data.
 */
function estimateRestingHr(activities: Activity[]): number | null {
  const easy = activities.filter(
    (a) =>
      a.avg_heart_rate != null &&
      a.avg_heart_rate > 0 &&
      a.duration_seconds >= 30 * 60 &&
      a.distance_km >= 5,
  )

  if (easy.length < 3) return null

  const sorted = [...easy].sort((a, b) => a.avg_heart_rate! - b.avg_heart_rate!)
  const lowest3 = sorted.slice(0, 3)
  const avg = lowest3.reduce((s, a) => s + a.avg_heart_rate!, 0) / lowest3.length

  // Resting HR is roughly avg easy run HR minus 40-50 bpm
  // This is a rough approximation
  return Math.round(avg - 45)
}

/**
 * Detect misalignment indicators between current and recommended zones.
 */
function detectMisalignment(
  currentMaxHr: number,
  recommendedMaxHr: number,
  thresholdHr: number | null,
  activities: Activity[],
): { status: CalibrationStatus; explanations: string[] } {
  const explanations: string[] = []
  let severity = 0

  const maxHrDiff = Math.abs(recommendedMaxHr - currentMaxHr)
  const maxHrPctDiff = maxHrDiff / recommendedMaxHr

  // 1. Max HR significantly different
  if (maxHrPctDiff > 0.08) {
    severity += 2
    if (recommendedMaxHr > currentMaxHr) {
      explanations.push(
        `Your highest recorded heart rates suggest a max HR around ${recommendedMaxHr} bpm, ` +
        `which is ${maxHrDiff} bpm higher than the ${currentMaxHr} bpm currently used for zone calculations. ` +
        `This means your zones are set too low.`
      )
    } else {
      explanations.push(
        `Your activity data suggests a max HR around ${recommendedMaxHr} bpm, ` +
        `which is ${maxHrDiff} bpm lower than the ${currentMaxHr} bpm currently used. ` +
        `Your zones may be set too high.`
      )
    }
  } else if (maxHrPctDiff > 0.04) {
    severity += 1
    explanations.push(
      `Your estimated max HR (${recommendedMaxHr} bpm) differs slightly from the current ` +
      `value (${currentMaxHr} bpm). A small adjustment may improve zone accuracy.`
    )
  }

  // 2. Zone 2 runs appearing too hard
  if (thresholdHr != null) {
    const currentZ2Max = Math.round(currentMaxHr * 0.70)
    const recZ2Max = Math.round(recommendedMaxHr * 0.70)

    // Count easy/long runs where avg HR falls above current Z2 max
    const longEasyRuns = activities.filter(
      (a) =>
        a.avg_heart_rate != null &&
        a.avg_heart_rate > 0 &&
        a.duration_seconds >= 30 * 60 &&
        a.distance_km >= 5 &&
        a.pace_min_per_km != null &&
        a.pace_min_per_km > 5.5, // slower pace = likely easy run
    )

    const z2Misclassified = longEasyRuns.filter(
      (a) => a.avg_heart_rate! > currentZ2Max,
    )

    if (longEasyRuns.length >= 3 && z2Misclassified.length / longEasyRuns.length > 0.5) {
      severity += 1
      explanations.push(
        `${z2Misclassified.length} of your ${longEasyRuns.length} easy long runs have an average HR above ` +
        `Zone 2 (${currentZ2Max} bpm). These runs are likely aerobic efforts that should fall within Zone 2. ` +
        `Adjusting your max HR upward would fix this.`
      )
    }
  }

  // 3. Most workouts clustering in a single zone
  if (activities.length >= 10) {
    const withHr = activities.filter((a) => a.avg_heart_rate != null && a.avg_heart_rate > 0)
    if (withHr.length >= 8) {
      const zoneCounts = [0, 0, 0, 0, 0]
      const z1Max = Math.round(currentMaxHr * 0.60)
      const z2Max = Math.round(currentMaxHr * 0.70)
      const z3Max = Math.round(currentMaxHr * 0.80)
      const z4Max = Math.round(currentMaxHr * 0.90)

      for (const a of withHr) {
        const hr = a.avg_heart_rate!
        if (hr < z1Max) zoneCounts[0]++
        else if (hr < z2Max) zoneCounts[1]++
        else if (hr < z3Max) zoneCounts[2]++
        else if (hr < z4Max) zoneCounts[3]++
        else zoneCounts[4]++
      }

      const maxInOneZone = Math.max(...zoneCounts)
      if (maxInOneZone / withHr.length > 0.7) {
        const dominantZone = zoneCounts.indexOf(maxInOneZone) + 1
        severity += 1
        explanations.push(
          `${Math.round((maxInOneZone / withHr.length) * 100)}% of your activities fall into Zone ${dominantZone}. ` +
          `A well-calibrated zone setup typically spreads workouts across multiple zones. ` +
          `Your max HR estimate may need adjustment.`
        )
      }
    }
  }

  // Determine status
  let status: CalibrationStatus
  if (severity === 0) {
    status = "well_calibrated"
    if (explanations.length === 0) {
      explanations.push(
        "Your heart rate zones appear well calibrated based on your recent training data."
      )
    }
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
    Math.abs(z.min - b[i].min) <= ZONE_MATCH_TOLERANCE &&
    Math.abs(z.max - b[i].max) <= ZONE_MATCH_TOLERANCE,
  )
}

// ─── Public API ─────────────────────────────────────

/**
 * Run the full heart rate zone analysis on a set of activities.
 *
 * @param activities All user activities (sorted by date desc preferred)
 * @param currentMaxHr The max HR currently used for zones (if known).
 *                     If not provided, uses the same estimation the app currently does.
 */
export function analyzeHeartRateZones(
  activities: Activity[],
  currentMaxHr?: number,
): HrAnalysisResult {
  const now = new Date().toISOString()

  // Filter to activities with HR data
  const withHr = activities.filter(
    (a) => a.avg_heart_rate != null && a.avg_heart_rate > 0,
  )

  // Insufficient data
  if (withHr.length < 5) {
    const fallbackMax = currentMaxHr ?? 190
    return {
      observedMaxHr: 0,
      estimatedMaxHr: fallbackMax,
      estimatedThresholdHr: null,
      estimatedRestingHr: null,
      currentZones: buildZones(fallbackMax),
      recommendedZones: buildZones(fallbackMax),
      calibrationStatus: "insufficient_data",
      explanations: [
        "Not enough activities with heart rate data to analyze zones. " +
        "Continue training with a heart rate monitor to enable calibration.",
      ],
      dataQuality: {
        activitiesWithHr: withHr.length,
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

  // Estimate max HR
  const { observedMax, estimatedMax, highestActivity } = estimateMaxHr(withHr)

  // Current max HR: use provided value or fallback to same estimation the app does
  const effectiveCurrentMaxHr = currentMaxHr ?? Math.round(observedMax * 1.2)

  // Estimate threshold HR and resting HR first (needed for Karvonen zones)
  const thresholdHr = estimateThresholdHr(withHr)
  const restingHr = estimateRestingHr(withHr)

  // Build current zones (what the app currently uses — without resting HR)
  const currentZones = buildZones(effectiveCurrentMaxHr)

  // Build recommended zones using Karvonen model when resting HR is available
  const recommendedZones = buildZones(estimatedMax, restingHr)

  // Detect misalignment
  const { status, explanations } = detectMisalignment(
    effectiveCurrentMaxHr,
    estimatedMax,
    thresholdHr,
    withHr,
  )

  // Add threshold info if available
  if (thresholdHr != null && status !== "insufficient_data") {
    const recZ4Min = Math.round(estimatedMax * 0.80)
    const recZ4Max = Math.round(estimatedMax * 0.90)
    if (thresholdHr >= recZ4Min && thresholdHr <= recZ4Max) {
      explanations.push(
        `Your estimated threshold HR (${thresholdHr} bpm) falls within the recommended ` +
        `Zone 4 (${recZ4Min}–${recZ4Max} bpm), which confirms the zone boundaries are reasonable.`
      )
    } else if (thresholdHr > recZ4Max) {
      explanations.push(
        `Your estimated threshold HR (${thresholdHr} bpm) is above the recommended Zone 4 ceiling ` +
        `(${recZ4Max} bpm). This suggests your true max HR may be higher than estimated.`
      )
    }
  }

  return {
    observedMaxHr: observedMax,
    estimatedMaxHr: estimatedMax,
    estimatedThresholdHr: thresholdHr,
    estimatedRestingHr: restingHr,
    currentZones,
    recommendedZones,
    calibrationStatus: status,
    explanations,
    dataQuality: {
      activitiesWithHr: withHr.length,
      totalActivities: activities.length,
      recentActivitiesWithHr: recentWithHr.length,
      highestHrActivity: highestActivity,
    },
    zonesMatch: zonesMatch(currentZones, recommendedZones),
    analyzedAt: now,
  }
}
