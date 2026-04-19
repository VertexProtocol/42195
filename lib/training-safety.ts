/**
 * Training Load Safety Engine
 *
 * Validates AI-generated training plans against injury-prevention rules and
 * provides structured adjustments when violations are detected.
 *
 * Safety rules implemented:
 * - Weekly load progression cap (level-adaptive: beginner 5-8%, intermediate 8-10%, advanced 10-12%)
 * - Acute:Chronic Workload Ratio enforcement (warning >1.3, unsafe >1.5)
 * - Frequency progression throttle (max +1 session/week per block)
 * - Fatigue detection via HR drift and pace drift
 * - Long run distance cap (≤35% of weekly total)
 * - Plan validation layer integrated into generation flow
 */

import type { TrainingPlan, TrainingWeek, GoalPreferences } from "@/lib/types"
import { computeACWR, computeTrainingLoad, gradeAdjustedPace } from "@/lib/training-utils"
import {
  ACWR_HIGH_THRESHOLD,
  ACWR_UNSAFE_THRESHOLD,
  RECOVERY_WEEK_THRESHOLD,
  LONG_RUN_MAX_FRACTION,
  FATIGUE_MIN_QUALIFYING_RUNS,
  FATIGUE_RECENT_RUNS_COUNT,
  FATIGUE_HR_ELEVATION_BPM,
  FATIGUE_PACE_DECLINE_FACTOR,
  FATIGUE_FRESHNESS_DAYS,
  PROLONGED_FATIGUE_TSB_THRESHOLD,
  PROLONGED_FATIGUE_CONSECUTIVE_WEEKS,
  PROLONGED_FATIGUE_DELOAD_MULTIPLIER,
  PROLONGED_FATIGUE_MIN_POINTS,
} from "@/lib/training-constants"

// Re-export client-safe utilities so server-side callers don't need to change imports
export {
  checkSkipLoadSpike,
  classifyAthleteLevel,
  MAX_WEEKLY_INCREASE,
  type SafetyActivity,
  type AthleteLevel,
  type SkipLoadWarning,
} from "@/lib/training-safety-client"
import type { SafetyActivity, AthleteLevel } from "@/lib/training-safety-client"
import { MAX_WEEKLY_INCREASE, classifyAthleteLevel } from "@/lib/training-safety-client"

/**
 * Parses a session distance string into its low/high numeric km values.
 * For ranges like "8-10 km" returns { low: 8, high: 10 }.
 * For single values like "10 km" returns { low: 10, high: 10 }.
 * Returns null if the string cannot be parsed.
 */
export function parseSessionDistanceParts(
  distance: string,
): { low: number; high: number } | null {
  const rangeMatch = distance.match(/([\d.]+)\s*[-–]\s*([\d.]+)\s*km/i)
  if (rangeMatch) return { low: parseFloat(rangeMatch[1]), high: parseFloat(rangeMatch[2]) }
  const singleMatch = distance.match(/([\d.]+)\s*km/i)
  if (singleMatch) { const v = parseFloat(singleMatch[1]); return { low: v, high: v } }
  return null
}

/**
 * Extracts km from a session distance string.
 * Handles ranges like "8-10 km" (returns max), single values like "10 km",
 * and "10.5km" (no space).
 */
export function parseSessionDistanceKm(distance: string): number {
  const parts = parseSessionDistanceParts(distance)
  return parts ? parts.high : 0
}

// ── Weekly load progression check ─────────────────────────────────────────────

export interface WeeklyLoadViolation {
  weekNumber: number
  targetKm: number
  previousKm: number
  maxAllowedKm: number
  adjustedKm: number
}

/**
 * Validates that no week exceeds the level-appropriate progression cap vs the
 * prior week. Returns violations with suggested adjusted values.
 */
export function checkWeeklyLoadProgression(
  weekTargets: number[],
  level: AthleteLevel,
): WeeklyLoadViolation[] {
  const maxIncrease = MAX_WEEKLY_INCREASE[level]
  const violations: WeeklyLoadViolation[] = []

  for (let i = 1; i < weekTargets.length; i++) {
    const prev = weekTargets[i - 1]
    const curr = weekTargets[i]
    const maxAllowed = Math.round(prev * (1 + maxIncrease))

    // Skip recovery weeks (defined as weeks that drop ≥15% from previous week)
    const isRecoveryWeek = curr < prev * RECOVERY_WEEK_THRESHOLD
    if (isRecoveryWeek) continue

    if (curr > maxAllowed) {
      violations.push({
        weekNumber: i + 1,
        targetKm: curr,
        previousKm: prev,
        maxAllowedKm: maxAllowed,
        adjustedKm: maxAllowed,
      })
    }
  }

  return violations
}

// ── Cumulative load progression check ─────────────────────────────────────────

/** Maximum cumulative increase over a rolling window (as a fraction) */
const MAX_CUMULATIVE_INCREASE: Record<AthleteLevel, number> = {
  beginner: 0.20,     // max 20% over 3 weeks
  intermediate: 0.25, // max 25% over 3 weeks
  advanced: 0.30,     // max 30% over 3 weeks
}

export interface CumulativeLoadViolation {
  weekNumber: number
  targetKm: number
  referenceKm: number
  cumulativePct: number
  maxAllowedPct: number
  adjustedKm: number
}

/**
 * Checks that cumulative volume increase over a 3-week rolling window
 * doesn't exceed level-appropriate limits. This catches scenarios where
 * 3 consecutive small increases compound to a dangerous total increase.
 */
export function checkCumulativeProgression(
  weekTargets: number[],
  level: AthleteLevel,
): CumulativeLoadViolation[] {
  const maxCumulative = MAX_CUMULATIVE_INCREASE[level]
  const violations: CumulativeLoadViolation[] = []
  const windowSize = 3

  for (let i = windowSize; i < weekTargets.length; i++) {
    const reference = weekTargets[i - windowSize]
    const current = weekTargets[i]

    // Skip if reference week was a recovery week (very low volume)
    if (reference < 5) continue

    // Skip if current week is a recovery/taper (lower than reference)
    if (current <= reference) continue

    const pctIncrease = (current - reference) / reference
    if (pctIncrease > maxCumulative) {
      const maxAllowed = Math.round(reference * (1 + maxCumulative))
      violations.push({
        weekNumber: i + 1,
        targetKm: current,
        referenceKm: reference,
        cumulativePct: Math.round(pctIncrease * 100),
        maxAllowedPct: Math.round(maxCumulative * 100),
        adjustedKm: maxAllowed,
      })
    }
  }

  return violations
}

// ── ACWR load safety ──────────────────────────────────────────────────────────

export interface AcwrSafety {
  ratio: number
  /**
   * - "no_baseline" — no chronic load to compare against (new user or
   *   returning after a long pause). Treat any reported ratio as meaningless
   *   and start cautiously.
   * - "low" / "moderate" / "high" / "unsafe" — normal ACWR tiers.
   */
  risk: "no_baseline" | "low" | "moderate" | "high" | "unsafe"
  /** Recommended multiplier to apply to the first week's target (e.g. 0.8 for 20% cut) */
  weekOneMultiplier: number
  message: string | null
}

/**
 * Extends the basic ACWR computation with "unsafe" tier and concrete week-1
 * adjustment recommendations.
 */
export function evaluateAcwrSafety(activities: SafetyActivity[]): AcwrSafety {
  const { acuteLoad, chronicLoad, ratio } = computeACWR(activities)

  // No chronic load = no baseline to compare against. Distinct from "low"
  // because the runner needs to ramp UP cautiously, not because they're
  // "fine" — the message must reflect "build a base first", not "all good".
  if (chronicLoad <= 0) {
    return {
      ratio: 0,
      risk: "no_baseline",
      weekOneMultiplier: 0.85,
      message:
        "No recent training baseline detected. Start conservatively this week and build volume gradually — there's nothing to compare your acute load against yet.",
    }
  }

  if (ratio > ACWR_UNSAFE_THRESHOLD) {
    return {
      ratio,
      risk: "unsafe",
      weekOneMultiplier: 0.75,
      message: `Your recent load (${acuteLoad.toFixed(1)} km) is ${ratio.toFixed(2)}× your baseline (${chronicLoad.toFixed(1)} km/wk). Take a rest day or easy run today — avoid hard sessions until your load comes down.`,
    }
  }
  if (ratio > ACWR_HIGH_THRESHOLD) {
    return {
      ratio,
      risk: "high",
      weekOneMultiplier: 0.85,
      message: `Training load is elevated (ACWR ${ratio.toFixed(2)}). Consider reducing intensity this week and prioritising sleep and recovery.`,
    }
  }
  if (ratio > 1.0) {
    return {
      ratio,
      risk: "moderate",
      weekOneMultiplier: 0.95,
      message: `Load is slightly above your baseline (ACWR ${ratio.toFixed(2)}). Keep this week manageable to stay in the optimal range.`,
    }
  }
  return { ratio, risk: "low", weekOneMultiplier: 1.0, message: null }
}

// ── Frequency progression check ───────────────────────────────────────────────

export interface FrequencyWarning {
  currentAvgSessions: number
  requestedSessions: number
  maxSafeSessions: number
}

/**
 * Verifies that the requested sessions/week doesn't jump too aggressively.
 * Rule: max +1 session per block from the athlete's recent average.
 */
export function checkFrequencyProgression(
  activities: SafetyActivity[],
  requestedSessionsPerWeek: number,
): FrequencyWarning | null {
  const fourWeeksMs = 28 * 24 * 60 * 60 * 1000
  const cutoff = Date.now() - fourWeeksMs
  const recent = activities.filter((a) => new Date(a.date).getTime() >= cutoff)
  const avgSessions = recent.length / 4  // sessions per week over last 4 weeks

  // Allow at most +1 session/week vs recent average (floor to nearest integer)
  const maxSafe = Math.floor(avgSessions) + 1

  if (requestedSessionsPerWeek > maxSafe && avgSessions >= 1) {
    return {
      currentAvgSessions: Math.round(avgSessions * 10) / 10,
      requestedSessions: requestedSessionsPerWeek,
      maxSafeSessions: maxSafe,
    }
  }
  return null
}

// ── Fatigue detection ─────────────────────────────────────────────────────────

export type FatigueSignal = "none" | "hr_elevated" | "pace_declining" | "both"

export interface FatigueResult {
  signal: FatigueSignal
  description: string | null
  /** Recommended intensity reduction (0–1 multiplier for hard session volume) */
  intensityMultiplier: number
}

/** Returns the median of a sorted-ascending numeric array */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * Detects fatigue by examining HR and pace drift over recent runs vs baseline.
 * Uses median (not mean) for robustness against outlier sessions.
 * - HR elevated: recent median HR > baseline median + 5 bpm
 * - Pace declining: recent median pace worse than baseline median by >5%
 *
 * Requires 8+ qualifying runs (4 recent + 4 baseline minimum).
 */
export function detectFatigue(activities: SafetyActivity[]): FatigueResult {
  const runs = activities
    .filter((a) => a.distance_km > 3 && a.duration_seconds > 0)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  if (runs.length < FATIGUE_MIN_QUALIFYING_RUNS) {
    return { signal: "none", description: null, intensityMultiplier: 1.0 }
  }

  // Freshness guard: if the latest qualifying run is older than
  // FATIGUE_FRESHNESS_DAYS, comparing its HR/pace to even older baseline runs
  // produces a stale signal the runner cannot act on. Skip detection during
  // multi-week pauses — the comeback calculator handles return-to-training.
  const latestMs = new Date(runs[0].date).getTime()
  const ageDays = (Date.now() - latestMs) / (24 * 60 * 60 * 1000)
  if (ageDays > FATIGUE_FRESHNESS_DAYS) {
    return { signal: "none", description: null, intensityMultiplier: 1.0 }
  }

  const recent = runs.slice(0, FATIGUE_RECENT_RUNS_COUNT)
  const baseline = runs.slice(FATIGUE_RECENT_RUNS_COUNT, FATIGUE_RECENT_RUNS_COUNT + FATIGUE_MIN_QUALIFYING_RUNS)

  // HR fatigue signal (using median for outlier resistance)
  const recentHrs = recent
    .filter((a) => a.avg_heart_rate && a.avg_heart_rate > 0)
    .map((a) => a.avg_heart_rate!)
  const baselineHrs = baseline
    .filter((a) => a.avg_heart_rate && a.avg_heart_rate > 0)
    .map((a) => a.avg_heart_rate!)
  let hrElevated = false
  if (recentHrs.length >= 3 && baselineHrs.length >= 4) {
    hrElevated = median(recentHrs) > median(baselineHrs) + FATIGUE_HR_ELEVATION_BPM
  }

  // Pace fatigue signal — use grade-adjusted pace so hilly runs don't falsely
  // register as "slower" (higher pace value = slower, using median)
  const recentPaces = recent
    .filter((a) => a.pace_min_per_km && a.pace_min_per_km > 0)
    .map((a) => gradeAdjustedPace(a.pace_min_per_km!, a.distance_km, a.elevation_gain_m))
  const baselinePaces = baseline
    .filter((a) => a.pace_min_per_km && a.pace_min_per_km > 0)
    .map((a) => gradeAdjustedPace(a.pace_min_per_km!, a.distance_km, a.elevation_gain_m))
  let paceDeclining = false
  if (recentPaces.length >= 3 && baselinePaces.length >= 4) {
    paceDeclining = median(recentPaces) > median(baselinePaces) * FATIGUE_PACE_DECLINE_FACTOR
  }

  if (hrElevated && paceDeclining) {
    return {
      signal: "both",
      description: "Heart rate elevated and pace declining — strong fatigue signal. Reduce intensity and add recovery sessions.",
      intensityMultiplier: 0.75,
    }
  }
  if (hrElevated) {
    return {
      signal: "hr_elevated",
      description: "Heart rate is elevated vs recent baseline — possible fatigue. Consider reducing intensity.",
      intensityMultiplier: 0.85,
    }
  }
  if (paceDeclining) {
    return {
      signal: "pace_declining",
      description: "Pace is declining with stable heart rate — possible fatigue. Consider an easy week.",
      intensityMultiplier: 0.90,
    }
  }

  return { signal: "none", description: null, intensityMultiplier: 1.0 }
}

// ── Long run protection ───────────────────────────────────────────────────────

export interface LongRunViolation {
  weekNumber: number
  longRunKm: number
  weeklyKm: number
  maxAllowedKm: number
  adjustedKm: number
}

// LONG_RUN_MAX_FRACTION imported from training-constants

/**
 * Parses session distances from a week and checks the long run cap.
 * Long run must be ≤ 35% of weekly total.
 */
export function checkLongRunProtection(plan: TrainingPlan): LongRunViolation[] {
  const violations: LongRunViolation[] = []

  for (const week of plan.weeks) {
    const maxAllowed = Math.round(week.targetKm * LONG_RUN_MAX_FRACTION * 10) / 10

    // Find the longest session in this week
    let longestSessionKm = 0
    let longestSessionType = ""
    for (const session of week.sessions) {
      const km = parseSessionDistanceKm(session.distance)
      if (km > longestSessionKm) {
        longestSessionKm = km
        longestSessionType = session.type
      }
    }

    if (longestSessionKm > maxAllowed && longestSessionKm > 0) {
      violations.push({
        weekNumber: week.weekNumber,
        longRunKm: longestSessionKm,
        weeklyKm: week.targetKm,
        maxAllowedKm: maxAllowed,
        adjustedKm: maxAllowed,
      })
      console.warn(
        `[safety] Week ${week.weekNumber}: long run ${longestSessionKm} km exceeds ${Math.round(LONG_RUN_MAX_FRACTION * 100)}% of ${week.targetKm} km weekly total (max ${maxAllowed} km). Session: "${longestSessionType}"`
      )
    }
  }

  return violations
}

// ── Taper validation ─────────────────────────────────────────────────────────

export interface TaperViolation {
  weekNumber: number
  taperKm: number
  peakKm: number
  message: string
}

/**
 * Validates that weeks whose theme indicates taper/race-prep have lower volume
 * than the detected peak week. Catches plans where Claude labels a week as
 * "taper" but assigns more km than the preceding peak.
 *
 * A week is considered a taper week if its theme matches "taper", "race",
 * "race week", or "race-ready".
 */
export function checkTaperProgression(plan: TrainingPlan): TaperViolation[] {
  const violations: TaperViolation[] = []
  if (plan.weeks.length < 2) return violations

  const peakKm = Math.max(...plan.weeks.map((w) => w.targetKm))

  for (const week of plan.weeks) {
    const isTaperWeek = /taper|race.?week|race.?ready|race.?prep|peak.?taper/i.test(week.theme ?? "")
    if (!isTaperWeek) continue
    if (week.targetKm >= peakKm) {
      violations.push({
        weekNumber: week.weekNumber,
        taperKm: week.targetKm,
        peakKm,
        message: `Week ${week.weekNumber} is labelled "${week.theme}" but has ${week.targetKm} km — not lower than the block peak of ${peakKm} km.`,
      })
    }
  }

  return violations
}

// ── Prolonged fatigue / forced deload ────────────────────────────────────────

export interface ProlongedFatigueResult {
  detected: boolean
  consecutiveNegativeTsbWeeks: number
  /** Recommended deload fraction for the first plan week (e.g. 0.6 = 60% of computed target) */
  deloadMultiplier: number
  message: string | null
}

/**
 * Detects if TSB has been below -15 for 3+ consecutive weeks,
 * indicating accumulated fatigue that requires a forced deload.
 */
export function checkProlongedFatigue(activities: SafetyActivity[]): ProlongedFatigueResult {
  const loadPoints = computeTrainingLoad(activities)
  if (loadPoints.length < PROLONGED_FATIGUE_MIN_POINTS) {
    return { detected: false, consecutiveNegativeTsbWeeks: 0, deloadMultiplier: 1.0, message: null }
  }

  // Sample one point per week (last 6 weeks)
  const weeklyPoints = [6, 5, 4, 3, 2, 1].map((weeksAgo) => {
    const idx = Math.max(0, loadPoints.length - weeksAgo * 7)
    return loadPoints[idx]
  })

  let consecutiveNegative = 0
  for (let i = weeklyPoints.length - 1; i >= 0; i--) {
    if (weeklyPoints[i].tsb < PROLONGED_FATIGUE_TSB_THRESHOLD) {
      consecutiveNegative++
    } else {
      break
    }
  }

  if (consecutiveNegative >= PROLONGED_FATIGUE_CONSECUTIVE_WEEKS) {
    return {
      detected: true,
      consecutiveNegativeTsbWeeks: consecutiveNegative,
      deloadMultiplier: PROLONGED_FATIGUE_DELOAD_MULTIPLIER,
      message: `TSB has been below ${PROLONGED_FATIGUE_TSB_THRESHOLD} for ${consecutiveNegative} consecutive weeks — forced ${Math.round((1 - PROLONGED_FATIGUE_DELOAD_MULTIPLIER) * 100)}% deload recommended before resuming volume increases.`,
    }
  }

  return { detected: false, consecutiveNegativeTsbWeeks: consecutiveNegative, deloadMultiplier: 1.0, message: null }
}

// ── Composite training load status ───────────────────────────────────────────

export type LoadStatus = "insufficient_data" | "optimal" | "high" | "overtraining_risk"

export interface TrainingLoadStatus {
  status: LoadStatus
  acwr: ReturnType<typeof evaluateAcwrSafety>
  fatigue: FatigueResult
  prolongedFatigue: ProlongedFatigueResult
  athleteLevel: AthleteLevel
}

/**
 * Computes the composite training load status for UI display.
 * Returns one of: "optimal" | "high" | "overtraining_risk"
 */
export function computeTrainingLoadStatus(activities: SafetyActivity[]): TrainingLoadStatus {
  const acwr = evaluateAcwrSafety(activities)
  const fatigue = detectFatigue(activities)
  const prolongedFatigue = checkProlongedFatigue(activities)
  const athleteLevel = classifyAthleteLevel(activities)

  let status: LoadStatus = "optimal"

  // No baseline trumps all other signals — there's nothing meaningful to
  // grade because chronic load is zero (new user / long pause).
  if (acwr.risk === "no_baseline") {
    status = "insufficient_data"
  } else if (
    acwr.risk === "unsafe" ||
    prolongedFatigue.detected ||
    fatigue.signal === "both"
  ) {
    status = "overtraining_risk"
  } else if (
    acwr.risk === "high" ||
    acwr.risk === "moderate" ||
    fatigue.signal === "hr_elevated" ||
    fatigue.signal === "pace_declining"
  ) {
    status = "high"
  }

  return { status, acwr, fatigue, prolongedFatigue, athleteLevel }
}

// ── Full plan validation + adjustment ────────────────────────────────────────

export interface SafetyValidationResult {
  passed: boolean
  athleteLevel: AthleteLevel
  weeklyLoadViolations: WeeklyLoadViolation[]
  longRunViolations: LongRunViolation[]
  taperViolations: TaperViolation[]
  frequencyWarning: FrequencyWarning | null
  acwrSafety: AcwrSafety
  fatigue: FatigueResult
  prolongedFatigue: ProlongedFatigueResult
  adjustedPlan: TrainingPlan
  safetyNotes: string[]
}

/**
 * Full safety validation pipeline:
 *
 * 1. Classify athlete level
 * 2. Check ACWR — apply week-1 multiplier if needed
 *    + Detect prolonged fatigue — apply deload multiplier if needed
 * 2b. Check weekly progression caps — clamp violations
 * 2c. Check cumulative progression caps (3-week rolling window) — clamp violations
 * 3. Check long run protection — clamp violations
 * 4. Detect fatigue signals — attach notes
 * 5. Check frequency progression
 *
 * Returns the validated (and potentially adjusted) plan plus a summary of issues.
 */
export function validateAndAdjustPlan(
  plan: TrainingPlan,
  activities: SafetyActivity[],
  prefs: GoalPreferences,
): SafetyValidationResult {
  const safetyNotes: string[] = []
  const athleteLevel = classifyAthleteLevel(activities)
  const acwrSafety = evaluateAcwrSafety(activities)
  const fatigue = detectFatigue(activities)
  const prolongedFatigue = checkProlongedFatigue(activities)
  const frequencyWarning = checkFrequencyProgression(activities, prefs.sessions_per_week)

  // Deep-clone plan weeks for mutation
  const adjustedWeeks: TrainingWeek[] = plan.weeks.map((w) => ({
    ...w,
    sessions: w.sessions.map((s) => ({ ...s })),
  }))

  // Step 1: Apply ACWR + prolonged fatigue deload across first 3 weeks (graduated)
  // Week 1 gets full adjustment, week 2 gets 50%, week 3 gets 25%
  const combinedMultiplier = Math.min(
    acwrSafety.weekOneMultiplier,
    prolongedFatigue.deloadMultiplier,
  )
  if (combinedMultiplier < 1.0 && adjustedWeeks.length > 0) {
    const graduationFactors = [1.0, 0.5, 0.25] // how much of the reduction to apply
    for (let i = 0; i < Math.min(graduationFactors.length, adjustedWeeks.length); i++) {
      const reduction = 1 - combinedMultiplier // e.g. 0.25 for a 25% cut
      const weekMultiplier = 1 - (reduction * graduationFactors[i])
      const original = adjustedWeeks[i].targetKm
      adjustedWeeks[i].targetKm = Math.round(original * weekMultiplier)
    }
    if (acwrSafety.message) safetyNotes.push(acwrSafety.message)
    if (prolongedFatigue.message) safetyNotes.push(prolongedFatigue.message)
  }

  // Step 2: Clamp weekly progression to level-appropriate cap
  const targets = adjustedWeeks.map((w) => w.targetKm)
  const weeklyViolations = checkWeeklyLoadProgression(targets, athleteLevel)
  for (const v of weeklyViolations) {
    const idx = v.weekNumber - 1
    if (idx >= 0 && idx < adjustedWeeks.length) {
      adjustedWeeks[idx].targetKm = v.adjustedKm
      const note = `Week ${v.weekNumber}: volume reduced from ${v.targetKm} to ${v.adjustedKm} km (${athleteLevel} cap: +${Math.round(MAX_WEEKLY_INCREASE[athleteLevel] * 100)}%/week)`
      safetyNotes.push(note)
      console.warn(`[safety] ${note}`)
    }
  }

  // Step 2b: Clamp cumulative progression over 3-week windows
  const updatedTargets = adjustedWeeks.map((w) => w.targetKm)
  const cumulativeViolations = checkCumulativeProgression(updatedTargets, athleteLevel)
  for (const v of cumulativeViolations) {
    const idx = v.weekNumber - 1
    if (idx >= 0 && idx < adjustedWeeks.length) {
      adjustedWeeks[idx].targetKm = v.adjustedKm
      const note = `Week ${v.weekNumber}: volume reduced from ${v.targetKm} to ${v.adjustedKm} km (cumulative ${v.cumulativePct}% over 3 weeks exceeds ${v.maxAllowedPct}% cap for ${athleteLevel})`
      safetyNotes.push(note)
      console.warn(`[safety] ${note}`)
    }
  }

  // Step 3: Long run protection — re-check after target adjustments
  const adjustedPlanForLongRun: TrainingPlan = { ...plan, weeks: adjustedWeeks }
  const longRunViolations = checkLongRunProtection(adjustedPlanForLongRun)
  for (const v of longRunViolations) {
    const week = adjustedWeeks.find((w) => w.weekNumber === v.weekNumber)
    if (!week) continue

    // Find and clamp the longest session
    let maxKm = 0
    let maxIdx = -1
    week.sessions.forEach((s, i) => {
      const km = parseSessionDistanceKm(s.distance)
      if (km > maxKm) { maxKm = km; maxIdx = i }
    })
    if (maxIdx >= 0) {
      week.sessions[maxIdx].distance = `${v.adjustedKm} km`
      const note = `Week ${v.weekNumber}: long run capped at ${v.adjustedKm} km (${Math.round(LONG_RUN_MAX_FRACTION * 100)}% of ${week.targetKm} km week)`
      safetyNotes.push(note)
    }
  }

  // Step 4: Fatigue notes
  if (fatigue.description) {
    safetyNotes.push(fatigue.description)
  }

  // Step 5: Frequency warning
  if (frequencyWarning) {
    safetyNotes.push(
      `Frequency increase too aggressive: ${frequencyWarning.currentAvgSessions} sessions/week recently → requested ${frequencyWarning.requestedSessions}. Recommended max: ${frequencyWarning.maxSafeSessions}.`
    )
  }

  // Step 6: Taper validation — warn when taper-labelled weeks aren't actually tapering
  const taperViolations = checkTaperProgression({ ...plan, weeks: adjustedWeeks })
  for (const v of taperViolations) {
    // Apply a 30% volume reduction to incorrectly-loaded taper weeks
    const week = adjustedWeeks.find((w) => w.weekNumber === v.weekNumber)
    if (week) {
      const corrected = Math.round(v.peakKm * 0.65) // 65% of peak = meaningful taper
      if (corrected < week.targetKm) {
        week.targetKm = corrected
        safetyNotes.push(v.message + ` Reduced to ${corrected} km (65% of peak).`)
        console.warn(`[safety] ${v.message} Corrected to ${corrected} km.`)
      }
    }
  }

  const passed =
    weeklyViolations.length === 0 &&
    cumulativeViolations.length === 0 &&
    longRunViolations.length === 0 &&
    taperViolations.length === 0 &&
    !frequencyWarning &&
    acwrSafety.weekOneMultiplier === 1.0 &&
    !prolongedFatigue.detected &&
    fatigue.signal === "none"

  return {
    passed,
    athleteLevel,
    weeklyLoadViolations: weeklyViolations,
    longRunViolations,
    taperViolations,
    frequencyWarning,
    acwrSafety,
    fatigue,
    prolongedFatigue,
    adjustedPlan: { ...plan, weeks: adjustedWeeks },
    safetyNotes,
  }
}
