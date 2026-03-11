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
import { computeACWR, computeTrainingLoad } from "@/lib/training-utils"

/**
 * Minimal activity shape required by the safety engine.
 * Accepts both full Activity objects and the partial selects used in API routes.
 */
export interface SafetyActivity {
  date: string
  distance_km: number
  duration_seconds: number
  pace_min_per_km: number | null
  avg_heart_rate: number | null
}

// ── Athlete level classification ──────────────────────────────────────────────

export type AthleteLevel = "beginner" | "intermediate" | "advanced"

/** Maximum weekly volume increase allowed per level (as a fraction, e.g. 0.08 = 8%) */
const MAX_WEEKLY_INCREASE: Record<AthleteLevel, number> = {
  beginner: 0.08,
  intermediate: 0.10,
  advanced: 0.12,
}

/**
 * Classifies an athlete based on their 12-week activity history.
 * - Beginner:     avg weekly km < 20  OR  avg sessions/week < 2
 * - Intermediate: avg weekly km 20–50 OR  avg sessions/week 2–4
 * - Advanced:     avg weekly km > 50  OR  avg sessions/week > 4
 */
export function classifyAthleteLevel(activities: SafetyActivity[]): AthleteLevel {
  if (activities.length === 0) return "beginner"

  const twelveWeeksMs = 84 * 24 * 60 * 60 * 1000
  const cutoff = Date.now() - twelveWeeksMs
  const recent = activities.filter((a) => new Date(a.date).getTime() >= cutoff)

  if (recent.length === 0) return "beginner"

  const totalKm = recent.reduce((s, a) => s + a.distance_km, 0)
  const avgWeeklyKm = totalKm / 12
  const avgSessionsPerWeek = recent.length / 12

  if (avgWeeklyKm > 50 || avgSessionsPerWeek > 4) return "advanced"
  if (avgWeeklyKm > 20 || avgSessionsPerWeek >= 2) return "intermediate"
  return "beginner"
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
    const isRecoveryWeek = curr < prev * 0.85
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

// ── ACWR load safety ──────────────────────────────────────────────────────────

export interface AcwrSafety {
  ratio: number
  risk: "low" | "moderate" | "high" | "unsafe"
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

  if (ratio > 1.5) {
    return {
      ratio,
      risk: "unsafe",
      weekOneMultiplier: 0.75,
      message: `Acute load (${acuteLoad.toFixed(1)} km) is ${ratio.toFixed(2)}x chronic (${chronicLoad.toFixed(1)} km/wk). Plan reduced 25% — prioritise recovery before building volume.`,
    }
  }
  if (ratio > 1.3) {
    return {
      ratio,
      risk: "high",
      weekOneMultiplier: 0.85,
      message: `ACWR ${ratio.toFixed(2)} — elevated injury risk. Plan reduced 15% this week.`,
    }
  }
  if (ratio > 1.0) {
    return {
      ratio,
      risk: "moderate",
      weekOneMultiplier: 0.95,
      message: null,
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

/**
 * Detects fatigue by examining HR and pace drift over the last N runs.
 * - HR elevated: recent avg HR > overall avg + 5 bpm at the same distance
 * - Pace declining: recent avg pace worse than overall avg by >5%
 */
export function detectFatigue(activities: SafetyActivity[]): FatigueResult {
  const runs = activities
    .filter((a) => a.distance_km > 3 && a.duration_seconds > 0)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  if (runs.length < 6) {
    return { signal: "none", description: null, intensityMultiplier: 1.0 }
  }

  const recent = runs.slice(0, 3)
  const baseline = runs.slice(3, 10)

  // HR fatigue signal
  const recentWithHr = recent.filter((a) => a.avg_heart_rate && a.avg_heart_rate > 0)
  const baselineWithHr = baseline.filter((a) => a.avg_heart_rate && a.avg_heart_rate > 0)
  let hrElevated = false
  if (recentWithHr.length >= 2 && baselineWithHr.length >= 3) {
    const recentAvgHr = recentWithHr.reduce((s, a) => s + a.avg_heart_rate!, 0) / recentWithHr.length
    const baselineAvgHr = baselineWithHr.reduce((s, a) => s + a.avg_heart_rate!, 0) / baselineWithHr.length
    hrElevated = recentAvgHr > baselineAvgHr + 5
  }

  // Pace fatigue signal (higher pace value = slower)
  const recentWithPace = recent.filter((a) => a.pace_min_per_km && a.pace_min_per_km > 0)
  const baselineWithPace = baseline.filter((a) => a.pace_min_per_km && a.pace_min_per_km > 0)
  let paceDeclining = false
  if (recentWithPace.length >= 2 && baselineWithPace.length >= 3) {
    const recentAvgPace = recentWithPace.reduce((s, a) => s + a.pace_min_per_km!, 0) / recentWithPace.length
    const baselineAvgPace = baselineWithPace.reduce((s, a) => s + a.pace_min_per_km!, 0) / baselineWithPace.length
    // Pace declining = getting slower (higher pace value) by more than 5%
    paceDeclining = recentAvgPace > baselineAvgPace * 1.05
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

const LONG_RUN_MAX_FRACTION = 0.35

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
      const match = session.distance.match(/([\d.]+)\s*km/i)
      if (match) {
        const km = parseFloat(match[1])
        if (km > longestSessionKm) {
          longestSessionKm = km
          longestSessionType = session.type
        }
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
        `[safety] Week ${week.weekNumber}: long run ${longestSessionKm} km exceeds 35% of ${week.targetKm} km weekly total (max ${maxAllowed} km). Session: "${longestSessionType}"`
      )
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
  if (loadPoints.length < 21) {
    return { detected: false, consecutiveNegativeTsbWeeks: 0, deloadMultiplier: 1.0, message: null }
  }

  // Sample one point per week (last 6 weeks)
  const weeklyPoints = [6, 5, 4, 3, 2, 1].map((weeksAgo) => {
    const idx = Math.max(0, loadPoints.length - weeksAgo * 7)
    return loadPoints[idx]
  })

  let consecutiveNegative = 0
  for (let i = weeklyPoints.length - 1; i >= 0; i--) {
    if (weeklyPoints[i].tsb < -15) {
      consecutiveNegative++
    } else {
      break
    }
  }

  if (consecutiveNegative >= 3) {
    return {
      detected: true,
      consecutiveNegativeTsbWeeks: consecutiveNegative,
      deloadMultiplier: 0.60,
      message: `TSB has been below -15 for ${consecutiveNegative} consecutive weeks — forced 40% deload recommended before resuming volume increases.`,
    }
  }

  return { detected: false, consecutiveNegativeTsbWeeks: consecutiveNegative, deloadMultiplier: 1.0, message: null }
}

// ── Composite training load status ───────────────────────────────────────────

export type LoadStatus = "optimal" | "high" | "overtraining_risk"

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

  if (
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
 * 3. Detect prolonged fatigue — apply deload multiplier if needed
 * 4. Check weekly progression caps — clamp violations
 * 5. Check long run protection — clamp violations
 * 6. Check frequency progression
 * 7. Detect fatigue signals — attach notes
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

  // Step 1: Apply ACWR week-1 multiplier + prolonged fatigue deload
  const combinedWeek1Multiplier = Math.min(
    acwrSafety.weekOneMultiplier,
    prolongedFatigue.deloadMultiplier,
  )
  if (combinedWeek1Multiplier < 1.0 && adjustedWeeks.length > 0) {
    const original = adjustedWeeks[0].targetKm
    adjustedWeeks[0].targetKm = Math.round(original * combinedWeek1Multiplier)
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
      const match = s.distance.match(/([\d.]+)\s*km/i)
      if (match) {
        const km = parseFloat(match[1])
        if (km > maxKm) { maxKm = km; maxIdx = i }
      }
    })
    if (maxIdx >= 0) {
      week.sessions[maxIdx].distance = `${v.adjustedKm} km`
      const note = `Week ${v.weekNumber}: long run capped at ${v.adjustedKm} km (35% of ${week.targetKm} km week)`
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

  const passed =
    weeklyViolations.length === 0 &&
    longRunViolations.length === 0 &&
    !frequencyWarning &&
    acwrSafety.weekOneMultiplier === 1.0 &&
    !prolongedFatigue.detected &&
    fatigue.signal === "none"

  return {
    passed,
    athleteLevel,
    weeklyLoadViolations: weeklyViolations,
    longRunViolations,
    frequencyWarning,
    acwrSafety,
    fatigue,
    prolongedFatigue,
    adjustedPlan: { ...plan, weeks: adjustedWeeks },
    safetyNotes,
  }
}
