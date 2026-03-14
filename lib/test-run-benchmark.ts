/**
 * Test Run Benchmark Extraction System
 *
 * Computes derived fitness metrics from test run data:
 * - Estimated VO2max (Jack Daniels formula)
 * - Threshold pace estimation
 * - Threshold heart rate estimation
 * - Running efficiency (pace-to-HR ratio)
 * - Aerobic capacity indicator
 */

import type { Activity, TestRun, TestRunType, DerivedMetrics, PredictionValidation, PredictionValidationResult } from "@/lib/types"
import type { RacePrediction } from "@/lib/training-utils"

/**
 * Estimates VO2max using the Jack Daniels / VDOT formula.
 *
 * Based on the relationship between running velocity, time, and oxygen consumption.
 * Uses a simplified version of the Daniels & Gilbert formula:
 *   VO2 = -4.60 + 0.182258 * v + 0.000104 * v^2
 *   %VO2max = 0.8 + 0.1894393 * e^(-0.012778 * t) + 0.2989558 * e^(-0.1932605 * t)
 *   VO2max = VO2 / %VO2max
 *
 * Where v = velocity in m/min, t = time in minutes.
 */
function estimateVO2max(distanceKm: number, timeSeconds: number): number | null {
  if (distanceKm <= 0 || timeSeconds <= 0) return null

  const distanceM = distanceKm * 1000
  const timeMin = timeSeconds / 60
  const velocity = distanceM / timeMin // m/min

  // VO2 at race pace
  const vo2 = -4.60 + 0.182258 * velocity + 0.000104 * velocity * velocity

  // Fraction of VO2max sustained (time-dependent)
  const pctVO2max =
    0.8 +
    0.1894393 * Math.exp(-0.012778 * timeMin) +
    0.2989558 * Math.exp(-0.1932605 * timeMin)

  if (pctVO2max <= 0) return null

  const vo2max = vo2 / pctVO2max
  return Math.round(vo2max * 10) / 10
}

/**
 * Estimates threshold pace from a test run.
 *
 * For time trials: threshold pace ≈ race pace + 3-8% depending on distance.
 * For threshold tests: use the actual pace directly.
 * For max effort/short runs: use 88% of max pace as threshold estimate.
 */
function estimateThresholdPace(
  paceMinPerKm: number | null,
  distanceKm: number,
  testType: TestRunType,
): number | null {
  if (!paceMinPerKm || paceMinPerKm <= 0) return null

  switch (testType) {
    case "threshold_test":
      // Direct measurement — pace IS threshold pace
      return Math.round(paceMinPerKm * 100) / 100
    case "5k_time_trial":
      // 5K pace is roughly 95-97% VO2max; threshold ≈ 83-88%.
      // Threshold pace ≈ 5K pace × 1.08
      return Math.round(paceMinPerKm * 1.08 * 100) / 100
    case "10k_time_trial":
      // 10K pace is roughly 90-93% VO2max; threshold is slightly slower.
      // Threshold pace ≈ 10K pace × 1.04
      return Math.round(paceMinPerKm * 1.04 * 100) / 100
    case "max_effort":
      // Short max effort — threshold is notably slower
      if (distanceKm < 3) return Math.round(paceMinPerKm * 1.15 * 100) / 100
      return Math.round(paceMinPerKm * 1.10 * 100) / 100
    case "custom":
      // For custom runs, estimate based on distance
      if (distanceKm <= 5) return Math.round(paceMinPerKm * 1.08 * 100) / 100
      if (distanceKm <= 10) return Math.round(paceMinPerKm * 1.04 * 100) / 100
      return Math.round(paceMinPerKm * 1.02 * 100) / 100
  }
}

/**
 * Estimates threshold heart rate from test run data.
 *
 * For high-effort test runs:
 * - Threshold HR ≈ 85-90% of max HR observed
 * - If only avg HR available, use avg HR as approximation for sustained efforts
 */
function estimateThresholdHr(
  avgHr: number | null,
  maxHr: number | null,
  testType: TestRunType,
): number | null {
  if (testType === "threshold_test" && avgHr && avgHr > 0) {
    // Direct measurement
    return avgHr
  }

  if (maxHr && maxHr > 0) {
    // Threshold HR ≈ 88% of observed max HR
    return Math.round(maxHr * 0.88)
  }

  // Fallback: for sustained high-effort runs, avg HR approximates threshold
  if (avgHr && avgHr > 0 && testType !== "max_effort") {
    return avgHr
  }

  return null
}

/**
 * Running efficiency: how much pace you get per unit of HR.
 * Lower values = more efficient (faster at lower HR).
 * Calculated as pace_min_per_km / avg_hr * 100
 */
function computeRunningEfficiency(
  paceMinPerKm: number | null,
  avgHr: number | null,
): number | null {
  if (!paceMinPerKm || !avgHr || paceMinPerKm <= 0 || avgHr <= 0) return null
  return Math.round((paceMinPerKm / avgHr) * 10000) / 100
}

/**
 * Aerobic capacity indicator: a composite of duration and HR response.
 * Higher distance at controlled HR = better aerobic capacity.
 * Simple metric: distance_km * (220 - avg_hr) / 100
 */
function computeAerobicCapacity(
  distanceKm: number,
  avgHr: number | null,
): number | null {
  if (!avgHr || avgHr <= 0 || distanceKm <= 0) return null
  // HR reserve proxy (assuming max ~220 for normalization)
  return Math.round(distanceKm * (220 - avgHr) / 10) / 10
}

/**
 * Extracts all derived metrics from a test run activity.
 */
export function extractDerivedMetrics(
  activity: Activity,
  testType: TestRunType,
): DerivedMetrics {
  return {
    estimated_vo2max: estimateVO2max(activity.distance_km, activity.duration_seconds),
    threshold_pace: estimateThresholdPace(
      activity.pace_min_per_km,
      activity.distance_km,
      testType,
    ),
    threshold_hr: estimateThresholdHr(
      activity.avg_heart_rate,
      null, // max HR not available from activity summary — would need streams
      testType,
    ),
    running_efficiency: computeRunningEfficiency(
      activity.pace_min_per_km,
      activity.avg_heart_rate,
    ),
    aerobic_capacity: computeAerobicCapacity(
      activity.distance_km,
      activity.avg_heart_rate,
    ),
  }
}

/**
 * Computes the fitness trend from a series of test runs of the same type.
 * Returns the change in VO2max and threshold pace between the two most recent tests.
 */
export function computeTestRunTrend(testRuns: TestRun[]): {
  vo2maxDelta: number | null
  thresholdPaceDelta: number | null
  trend: "improving" | "stable" | "declining" | "insufficient_data"
} {
  if (testRuns.length < 2) {
    return { vo2maxDelta: null, thresholdPaceDelta: null, trend: "insufficient_data" }
  }

  const sorted = [...testRuns].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )
  const latest = sorted[0]
  const previous = sorted[1]

  const vo2maxDelta =
    latest.derived_metrics.estimated_vo2max != null &&
    previous.derived_metrics.estimated_vo2max != null
      ? latest.derived_metrics.estimated_vo2max - previous.derived_metrics.estimated_vo2max
      : null

  const thresholdPaceDelta =
    latest.derived_metrics.threshold_pace != null &&
    previous.derived_metrics.threshold_pace != null
      ? previous.derived_metrics.threshold_pace - latest.derived_metrics.threshold_pace // positive = faster
      : null

  let trend: "improving" | "stable" | "declining" = "stable"
  if (vo2maxDelta != null) {
    if (vo2maxDelta > 0.5) trend = "improving"
    else if (vo2maxDelta < -0.5) trend = "declining"
  } else if (thresholdPaceDelta != null) {
    if (thresholdPaceDelta > 0.05) trend = "improving"
    else if (thresholdPaceDelta < -0.05) trend = "declining"
  }

  return { vo2maxDelta, thresholdPaceDelta, trend }
}

/**
 * Recommends test run calibration adjustments for training plan generation.
 *
 * Returns multipliers for pace targets and intensity based on test run performance.
 * Adjustments are conservative (±5% max) to avoid overreacting to single tests.
 */
export function getTestRunCalibration(testRuns: TestRun[]): {
  paceMultiplier: number
  intensityMultiplier: number
  confidenceLevel: "high" | "medium" | "low"
  latestVO2max: number | null
  latestThresholdPace: number | null
} {
  if (testRuns.length === 0) {
    return {
      paceMultiplier: 1.0,
      intensityMultiplier: 1.0,
      confidenceLevel: "low",
      latestVO2max: null,
      latestThresholdPace: null,
    }
  }

  // Use most recent test runs (within 8 weeks)
  const eightWeeksMs = 56 * 24 * 60 * 60 * 1000
  const cutoff = Date.now() - eightWeeksMs
  const recent = testRuns
    .filter((tr) => new Date(tr.created_at).getTime() >= cutoff)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  if (recent.length === 0) {
    return {
      paceMultiplier: 1.0,
      intensityMultiplier: 1.0,
      confidenceLevel: "low",
      latestVO2max: testRuns[0]?.derived_metrics.estimated_vo2max ?? null,
      latestThresholdPace: testRuns[0]?.derived_metrics.threshold_pace ?? null,
    }
  }

  const latest = recent[0]
  const trend = computeTestRunTrend(recent)

  let paceMultiplier = 1.0
  let intensityMultiplier = 1.0

  // Adjust based on trend — conservative ±5% max
  if (trend.trend === "improving") {
    paceMultiplier = 0.97 // slightly faster targets
    intensityMultiplier = 1.03 // slightly higher intensity
  } else if (trend.trend === "declining") {
    paceMultiplier = 1.03 // slightly slower targets
    intensityMultiplier = 0.97 // slightly lower intensity
  }

  const confidenceLevel = recent.length >= 3 ? "high" : recent.length >= 2 ? "medium" : "low"

  return {
    paceMultiplier,
    intensityMultiplier,
    confidenceLevel,
    latestVO2max: latest.derived_metrics.estimated_vo2max,
    latestThresholdPace: latest.derived_metrics.threshold_pace,
  }
}

/**
 * Validates a test run against a race prediction.
 *
 * Compares the actual performance to the predicted pace/time and classifies
 * the result as validated, slightly optimistic, too aggressive, or too conservative.
 *
 * Thresholds:
 *  - Within ±2%  → validated
 *  - 2-5% slower → slightly optimistic
 *  - >5% slower  → too aggressive
 *  - >2% faster  → too conservative
 */
export function validatePrediction(
  prediction: RacePrediction,
  actualSeconds: number,
  actualDistanceKm: number,
): PredictionValidation {
  const predictedPaceMin = prediction.predicted_seconds / 60 / prediction.distance_km  // min/km
  // Normalize actual time to prediction distance using Riegel
  const normalizedSeconds = actualSeconds * (prediction.distance_km / actualDistanceKm) ** 1.06
  const actualPaceMin = normalizedSeconds / 60 / prediction.distance_km  // min/km

  const paceDiff = actualPaceMin - predictedPaceMin  // positive = slower than predicted
  const timeDiff = normalizedSeconds - prediction.predicted_seconds
  const pctDiff = paceDiff / predictedPaceMin     // fractional

  let result: PredictionValidationResult
  if (pctDiff <= -0.02) {
    result = "too_conservative"     // ran >2% faster than predicted
  } else if (pctDiff <= 0.02) {
    result = "validated"            // within ±2%
  } else if (pctDiff <= 0.05) {
    result = "slightly_optimistic"  // 2-5% slower
  } else {
    result = "too_aggressive"       // >5% slower
  }

  return {
    prediction_distance_km: prediction.distance_km,
    prediction_distance_label: prediction.distance_label,
    predicted_seconds: prediction.predicted_seconds,
    predicted_pace: Math.round(predictedPaceMin * 100) / 100,
    actual_seconds: Math.round(normalizedSeconds),
    actual_pace: Math.round(actualPaceMin * 100) / 100,
    pace_diff: Math.round(paceDiff * 100) / 100,
    time_diff_seconds: Math.round(timeDiff),
    result,
  }
}

/**
 * Computes prediction adjustment signals from validated test runs.
 *
 * Uses test runs that have prediction validations to suggest adjustments
 * to the prediction model. Adjustments are gradual and require multiple
 * consistent signals before shifting significantly.
 *
 * Returns a multiplier for the Riegel exponent (1.06 baseline):
 *  - consistently faster → slightly lower exponent (faster predictions)
 *  - consistently slower → slightly higher exponent (slower predictions)
 *  - mixed signals → no adjustment
 */
export function computePredictionAdjustment(testRuns: TestRun[]): {
  exponentAdjustment: number
  signalStrength: "strong" | "moderate" | "weak" | "none"
  summary: string
} {
  const validated = testRuns.filter(
    (tr) => tr.prediction_validation != null,
  )

  if (validated.length === 0) {
    return { exponentAdjustment: 0, signalStrength: "none", summary: "No prediction test runs yet" }
  }

  // Count results
  let fasterCount = 0
  let validatedCount = 0
  let slowerCount = 0

  for (const tr of validated) {
    const v = tr.prediction_validation!
    if (v.result === "too_conservative") fasterCount++
    else if (v.result === "validated") validatedCount++
    else slowerCount++
  }

  const total = validated.length

  // Need at least 2 signals in the same direction
  if (total < 2) {
    return { exponentAdjustment: 0, signalStrength: "weak", summary: "Need more test runs to adjust predictions" }
  }

  // Strong signal: 70%+ in one direction
  if (fasterCount / total >= 0.7) {
    const adj = total >= 3 ? -0.02 : -0.01
    return {
      exponentAdjustment: adj,
      signalStrength: total >= 3 ? "strong" : "moderate",
      summary: "Predictions appear conservative — you're running faster than expected",
    }
  }

  if (slowerCount / total >= 0.7) {
    const adj = total >= 3 ? 0.02 : 0.01
    return {
      exponentAdjustment: adj,
      signalStrength: total >= 3 ? "strong" : "moderate",
      summary: "Predictions appear optimistic — actual times are slower than predicted",
    }
  }

  return {
    exponentAdjustment: 0,
    signalStrength: validatedCount / total >= 0.5 ? "moderate" : "weak",
    summary: "Predictions are reasonably accurate",
  }
}
