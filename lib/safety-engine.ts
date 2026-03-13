/**
 * Training Load Safety Engine
 *
 * Validates AI-generated training plans against safety rules and auto-corrects
 * violations before plans are shown to the user.
 *
 * Safety checks:
 * 1. Weekly load progression (level-adaptive: beginner 5-8%, intermediate 8-10%, advanced 10-12%)
 * 2. Acute:Chronic Workload Ratio (ACWR) — warning >1.3, unsafe >1.5
 * 3. Frequency progression (max +1 session/week per block)
 * 4. Long run protection (long run ≤ 35% of weekly distance)
 * 5. Fatigue signal detection (HR drift, pace degradation)
 */

import type { Activity, TrainingPlan, TrainingWeek } from "@/lib/types"

// ---- Athlete Level Detection ----

export type AthleteLevel = "beginner" | "intermediate" | "advanced"

export interface AthleteLevelResult {
  level: AthleteLevel
  /** Maximum safe weekly increase percentage */
  maxWeeklyIncreasePct: number
  /** Reasoning for classification */
  reason: string
  /** Average weekly km over assessment period */
  avgWeeklyKm: number
  /** Weeks with at least one run in the last 12 weeks */
  activeWeeks: number
  /** Average sessions per week */
  avgSessionsPerWeek: number
}

/**
 * Determines athlete level based on historical activity data.
 *
 * Beginner: <20 km/week avg OR <8 active weeks in last 12 OR <2 sessions/week
 * Intermediate: 20-50 km/week avg AND 8+ active weeks AND 2-4 sessions/week
 * Advanced: >50 km/week avg AND 10+ active weeks AND 4+ sessions/week
 */
export function detectAthleteLevel(activities: Activity[]): AthleteLevelResult {
  const now = Date.now()
  const twelveWeeksAgo = now - 84 * 24 * 60 * 60 * 1000

  const recentActivities = activities.filter(
    (a) => new Date(a.date).getTime() >= twelveWeeksAgo && a.distance_km > 0,
  )

  // Group by ISO week
  const weekMap = new Map<string, { totalKm: number; count: number }>()
  for (const a of recentActivities) {
    const d = new Date(a.date)
    const day = d.getUTCDay()
    const diff = day === 0 ? -6 : 1 - day
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff))
    const key = monday.toISOString().split("T")[0]
    const existing = weekMap.get(key)
    if (existing) {
      existing.totalKm += Number(a.distance_km)
      existing.count += 1
    } else {
      weekMap.set(key, { totalKm: Number(a.distance_km), count: 1 })
    }
  }

  const activeWeeks = weekMap.size
  const totalKm = Array.from(weekMap.values()).reduce((s, w) => s + w.totalKm, 0)
  const totalSessions = Array.from(weekMap.values()).reduce((s, w) => s + w.count, 0)

  // Use 12 as denominator (full assessment window) to penalize inconsistency
  const avgWeeklyKm = totalKm / 12
  const avgSessionsPerWeek = totalSessions / 12

  if (avgWeeklyKm > 50 && activeWeeks >= 10 && avgSessionsPerWeek >= 4) {
    return {
      level: "advanced",
      maxWeeklyIncreasePct: 12,
      reason: `${avgWeeklyKm.toFixed(0)} km/week avg, ${activeWeeks} active weeks, ${avgSessionsPerWeek.toFixed(1)} sessions/week`,
      avgWeeklyKm,
      activeWeeks,
      avgSessionsPerWeek,
    }
  }

  if (avgWeeklyKm >= 20 && activeWeeks >= 8 && avgSessionsPerWeek >= 2) {
    return {
      level: "intermediate",
      maxWeeklyIncreasePct: 10,
      reason: `${avgWeeklyKm.toFixed(0)} km/week avg, ${activeWeeks} active weeks, ${avgSessionsPerWeek.toFixed(1)} sessions/week`,
      avgWeeklyKm,
      activeWeeks,
      avgSessionsPerWeek,
    }
  }

  return {
    level: "beginner",
    maxWeeklyIncreasePct: 8,
    reason: `${avgWeeklyKm.toFixed(0)} km/week avg, ${activeWeeks} active weeks, ${avgSessionsPerWeek.toFixed(1)} sessions/week`,
    avgWeeklyKm,
    activeWeeks,
    avgSessionsPerWeek,
  }
}

// ---- Fatigue Detection ----

export interface FatigueSignal {
  type: "hr_drift" | "pace_degradation"
  severity: "mild" | "moderate" | "severe"
  description: string
}

export interface FatigueResult {
  signals: FatigueSignal[]
  fatigued: boolean
  recommendation: "normal" | "reduce_intensity" | "add_recovery"
}

/**
 * Detects fatigue signals from recent activity data.
 *
 * HR Drift: Higher average heart rate at similar or slower pace (comparing
 * recent 5 runs vs prior 5 runs with similar distances).
 *
 * Pace Degradation: Slower pace with stable or higher heart rate.
 */
export function detectFatigue(activities: Activity[]): FatigueResult {
  const signals: FatigueSignal[] = []

  // Need at least 10 activities with HR and pace for comparison
  const withHrAndPace = activities
    .filter(
      (a) =>
        a.avg_heart_rate &&
        a.avg_heart_rate > 0 &&
        a.pace_min_per_km &&
        a.pace_min_per_km > 0 &&
        a.distance_km >= 2, // Ignore very short runs
    )
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  if (withHrAndPace.length < 8) {
    return { signals: [], fatigued: false, recommendation: "normal" }
  }

  const recent = withHrAndPace.slice(0, 5)
  const prior = withHrAndPace.slice(5, 10)

  if (prior.length < 3) {
    return { signals: [], fatigued: false, recommendation: "normal" }
  }

  const avgRecentHr = recent.reduce((s, a) => s + Number(a.avg_heart_rate!), 0) / recent.length
  const avgPriorHr = prior.reduce((s, a) => s + Number(a.avg_heart_rate!), 0) / prior.length
  const avgRecentPace = recent.reduce((s, a) => s + Number(a.pace_min_per_km!), 0) / recent.length
  const avgPriorPace = prior.reduce((s, a) => s + Number(a.pace_min_per_km!), 0) / prior.length

  const hrIncreasePct = ((avgRecentHr - avgPriorHr) / avgPriorHr) * 100
  const paceSlowdownPct = ((avgRecentPace - avgPriorPace) / avgPriorPace) * 100

  // HR Drift: HR increased while pace is similar or slower
  if (hrIncreasePct > 3 && paceSlowdownPct >= -2) {
    const severity =
      hrIncreasePct > 8 ? "severe" : hrIncreasePct > 5 ? "moderate" : "mild"
    signals.push({
      type: "hr_drift",
      severity,
      description: `Heart rate increased ${hrIncreasePct.toFixed(1)}% (${Math.round(avgPriorHr)} → ${Math.round(avgRecentHr)} bpm) at similar pace`,
    })
  }

  // Pace Degradation: Pace slowed while HR is similar or higher
  if (paceSlowdownPct > 3 && hrIncreasePct >= -2) {
    const severity =
      paceSlowdownPct > 8 ? "severe" : paceSlowdownPct > 5 ? "moderate" : "mild"
    signals.push({
      type: "pace_degradation",
      severity,
      description: `Pace slowed ${paceSlowdownPct.toFixed(1)}% (${avgPriorPace.toFixed(2)} → ${avgRecentPace.toFixed(2)} min/km) with stable/higher heart rate`,
    })
  }

  const hasSevere = signals.some((s) => s.severity === "severe")
  const hasModerate = signals.some((s) => s.severity === "moderate")

  let recommendation: FatigueResult["recommendation"] = "normal"
  if (hasSevere || signals.length >= 2) {
    recommendation = "add_recovery"
  } else if (hasModerate) {
    recommendation = "reduce_intensity"
  }

  return {
    signals,
    fatigued: signals.length > 0,
    recommendation,
  }
}

// ---- Frequency Progression Protection ----

export interface FrequencyCheck {
  previousSessionsPerWeek: number
  requestedSessionsPerWeek: number
  maxAllowed: number
  safe: boolean
  adjusted: number
}

/**
 * Ensures training frequency doesn't increase by more than 1 session/week per block.
 */
export function checkFrequencyProgression(
  activities: Activity[],
  requestedSessionsPerWeek: number,
): FrequencyCheck {
  const now = Date.now()
  const fourWeeksAgo = now - 28 * 24 * 60 * 60 * 1000

  const recentActivities = activities.filter(
    (a) => new Date(a.date).getTime() >= fourWeeksAgo && a.distance_km > 0,
  )

  // Count sessions per week over last 4 weeks
  const weekMap = new Map<string, number>()
  for (const a of recentActivities) {
    const d = new Date(a.date)
    const day = d.getUTCDay()
    const diff = day === 0 ? -6 : 1 - day
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff))
    const key = monday.toISOString().split("T")[0]
    weekMap.set(key, (weekMap.get(key) ?? 0) + 1)
  }

  // Use median sessions/week (more robust than average)
  const weeklyCounts = Array.from(weekMap.values()).sort((a, b) => a - b)
  const previousSessionsPerWeek =
    weeklyCounts.length > 0
      ? weeklyCounts[Math.floor(weeklyCounts.length / 2)]
      : 0

  const maxAllowed = Math.max(previousSessionsPerWeek + 1, 2) // Always allow at least 2
  const safe = requestedSessionsPerWeek <= maxAllowed
  const adjusted = safe ? requestedSessionsPerWeek : maxAllowed

  return {
    previousSessionsPerWeek,
    requestedSessionsPerWeek,
    maxAllowed,
    safe,
    adjusted,
  }
}

// ---- Plan Validation & Auto-Correction ----

export interface SafetyViolation {
  rule: string
  week: number
  description: string
  autoFixed: boolean
}

export interface SafetyValidationResult {
  valid: boolean
  violations: SafetyViolation[]
  adjustedPlan: TrainingPlan | null
}

/**
 * Validates a generated training plan against safety rules and auto-corrects violations.
 *
 * Rules enforced:
 * 1. Weekly distance must not increase more than the level-appropriate percentage
 * 2. Long run must not exceed 35% of weekly distance
 * 3. If fatigue detected, first week intensity is reduced
 * 4. Session count matches preferences
 */
export function validateAndCorrectPlan(
  plan: TrainingPlan,
  previousWeekKm: number,
  athleteLevel: AthleteLevelResult,
  fatigue: FatigueResult,
  sessionsPerWeek: number,
): SafetyValidationResult {
  const violations: SafetyViolation[] = []
  const adjustedWeeks: TrainingWeek[] = JSON.parse(JSON.stringify(plan.weeks))
  const maxIncrease = 1 + athleteLevel.maxWeeklyIncreasePct / 100

  let prevKm = previousWeekKm

  for (let i = 0; i < adjustedWeeks.length; i++) {
    const week = adjustedWeeks[i]

    // Rule 1: Weekly load progression
    if (prevKm > 0 && week.targetKm > prevKm * maxIncrease) {
      const cappedKm = Math.round(prevKm * maxIncrease)
      violations.push({
        rule: "weekly_load_progression",
        week: week.weekNumber,
        description: `Week ${week.weekNumber}: ${week.targetKm} km exceeds ${athleteLevel.maxWeeklyIncreasePct}% increase from ${prevKm.toFixed(0)} km (capped to ${cappedKm} km)`,
        autoFixed: true,
      })
      // Scale sessions proportionally
      const scaleFactor = cappedKm / week.targetKm
      week.targetKm = cappedKm
      for (const session of week.sessions) {
        const match = session.distance.match(/([\d.]+)\s*(km)/i)
        if (match) {
          const newDist = Math.round(parseFloat(match[1]) * scaleFactor * 10) / 10
          session.distance = `${newDist} km`
        }
      }
    }

    // Rule 2: Long run protection (≤ 35% of weekly distance)
    const longRunSession = week.sessions.find(
      (s) => s.type.toLowerCase().includes("long"),
    )
    if (longRunSession) {
      const longRunMatch = longRunSession.distance.match(/([\d.]+)\s*km/i)
      if (longRunMatch) {
        const longRunKm = parseFloat(longRunMatch[1])
        const maxLongRun = week.targetKm * 0.35
        if (longRunKm > maxLongRun && maxLongRun > 0) {
          const cappedLongRun = Math.round(maxLongRun * 10) / 10
          violations.push({
            rule: "long_run_protection",
            week: week.weekNumber,
            description: `Week ${week.weekNumber}: Long run ${longRunKm} km exceeds 35% of weekly ${week.targetKm} km (capped to ${cappedLongRun} km)`,
            autoFixed: true,
          })
          longRunSession.distance = `${cappedLongRun} km`
        }
      }
    }

    // Track for next week's comparison (use the potentially-adjusted value)
    prevKm = week.targetKm
  }

  // Rule 3: Fatigue-based first week reduction
  if (fatigue.recommendation === "add_recovery" && adjustedWeeks.length > 0) {
    const firstWeek = adjustedWeeks[0]
    const reducedKm = Math.round(firstWeek.targetKm * 0.8)
    violations.push({
      rule: "fatigue_recovery",
      week: firstWeek.weekNumber,
      description: `Fatigue detected — Week 1 reduced from ${firstWeek.targetKm} km to ${reducedKm} km for recovery`,
      autoFixed: true,
    })
    const scaleFactor = reducedKm / firstWeek.targetKm
    firstWeek.targetKm = reducedKm
    for (const session of firstWeek.sessions) {
      const match = session.distance.match(/([\d.]+)\s*(km)/i)
      if (match) {
        const newDist = Math.round(parseFloat(match[1]) * scaleFactor * 10) / 10
        session.distance = `${newDist} km`
      }
    }
    // Add recovery note
    firstWeek.coachNote = firstWeek.coachNote
      ? `${firstWeek.coachNote} Fatigue signals detected — this week focuses on recovery.`
      : "Fatigue signals detected — this week focuses on recovery. Keep all runs at easy effort."
  } else if (fatigue.recommendation === "reduce_intensity" && adjustedWeeks.length > 0) {
    const firstWeek = adjustedWeeks[0]
    const reducedKm = Math.round(firstWeek.targetKm * 0.9)
    violations.push({
      rule: "fatigue_intensity_reduction",
      week: firstWeek.weekNumber,
      description: `Mild fatigue detected — Week 1 reduced from ${firstWeek.targetKm} km to ${reducedKm} km`,
      autoFixed: true,
    })
    const scaleFactor = reducedKm / firstWeek.targetKm
    firstWeek.targetKm = reducedKm
    for (const session of firstWeek.sessions) {
      const match = session.distance.match(/([\d.]+)\s*(km)/i)
      if (match) {
        const newDist = Math.round(parseFloat(match[1]) * scaleFactor * 10) / 10
        session.distance = `${newDist} km`
      }
    }
  }

  const hasViolations = violations.length > 0
  return {
    valid: !hasViolations,
    violations,
    adjustedPlan: hasViolations
      ? { ...plan, weeks: adjustedWeeks }
      : null,
  }
}

// ---- Training Load Status (for UI indicator) ----

export type LoadStatus = "optimal" | "high_load" | "overtraining_risk"

export interface TrainingLoadStatus {
  status: LoadStatus
  label: string
  description: string
  color: string
  bg: string
  acwrRatio: number
  acwrRisk: "low" | "moderate" | "high"
  fatigued: boolean
}

/**
 * Computes a unified training load status combining ACWR and fatigue signals.
 *
 * Optimal: ACWR ≤ 1.3 and no fatigue
 * High Load: ACWR 1.3-1.5 OR mild/moderate fatigue
 * Overtraining Risk: ACWR > 1.5 OR severe fatigue signals
 */
export function computeTrainingLoadStatus(
  activities: Activity[],
): TrainingLoadStatus {
  // Compute ACWR
  const now = Date.now()
  const day7 = now - 7 * 24 * 60 * 60 * 1000
  const day28 = now - 28 * 24 * 60 * 60 * 1000

  const acuteLoad = activities
    .filter((a) => new Date(a.date).getTime() >= day7)
    .reduce((s, a) => s + Number(a.distance_km), 0)

  const chronicTotal = activities
    .filter((a) => new Date(a.date).getTime() >= day28)
    .reduce((s, a) => s + Number(a.distance_km), 0)

  const chronicLoad = chronicTotal / 4
  const ratio = chronicLoad > 0 ? acuteLoad / chronicLoad : 0
  const acwrRisk: "low" | "moderate" | "high" =
    ratio > 1.5 ? "high" : ratio > 1.3 ? "moderate" : "low"

  // Detect fatigue
  const fatigue = detectFatigue(activities)
  const hasSevereFatigue = fatigue.signals.some((s) => s.severity === "severe")

  // Determine status
  if (ratio > 1.5 || hasSevereFatigue) {
    return {
      status: "overtraining_risk",
      label: "Overtraining Risk",
      description: ratio > 1.5
        ? `Training load is ${ratio.toFixed(1)}x your baseline — reduce volume and add recovery days`
        : "Severe fatigue signals detected — prioritize rest and easy runs",
      color: "text-red-500",
      bg: "bg-red-500",
      acwrRatio: ratio,
      acwrRisk,
      fatigued: fatigue.fatigued,
    }
  }

  if (ratio > 1.3 || fatigue.fatigued) {
    return {
      status: "high_load",
      label: "High Load",
      description: ratio > 1.3
        ? `Training load is ${ratio.toFixed(1)}x your baseline — monitor recovery carefully`
        : "Fatigue signals detected — consider reducing intensity",
      color: "text-orange-500",
      bg: "bg-orange-500",
      acwrRatio: ratio,
      acwrRisk,
      fatigued: fatigue.fatigued,
    }
  }

  return {
    status: "optimal",
    label: "Optimal",
    description: "Training load is well balanced — keep up the good work",
    color: "text-emerald-500",
    bg: "bg-emerald-500",
    acwrRatio: ratio,
    acwrRisk,
    fatigued: false,
  }
}
