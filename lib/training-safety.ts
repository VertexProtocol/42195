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
import {
  computeACWR,
  computeTrainingLoad,
  gradeAdjustedPace,
  type TrainingLoadPoint,
} from "@/lib/training-utils"
import {
  ACWR_HIGH_THRESHOLD,
  ACWR_UNSAFE_THRESHOLD,
  ACWR_LOW_THRESHOLD,
  FATIGUE_INTENSITY_MATCH_TOLERANCE,
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
  hasAthleteLevelEvidence,
  MAX_WEEKLY_INCREASE,
  type SafetyActivity,
  type AthleteLevel,
  type SkipLoadWarning,
} from "@/lib/training-safety-client"
import type { SafetyActivity, AthleteLevel } from "@/lib/training-safety-client"
import {
  MAX_WEEKLY_INCREASE,
  classifyAthleteLevel,
  hasAthleteLevelEvidence,
} from "@/lib/training-safety-client"
import { logWarn } from "@/lib/log"

// Distance parsing lives in training-sessions.ts, alongside the allocation that
// produces those strings. Re-exported here so existing importers keep working.
export { parseSessionDistanceParts, parseSessionDistanceKm } from "@/lib/training-sessions"
import { parseSessionDistanceKm } from "@/lib/training-sessions"

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
/**
 * Clamps 3-week cumulative volume jumps against the runner's rolling history.
 *
 * @param weekTargets         Planned km for each week in the NEW plan.
 * @param level               Athlete tier — drives the max cumulative cap.
 * @param priorWeekTargets    Weekly km for the 1–3 weeks immediately BEFORE
 *                            the plan starts. Optional, but without it the
 *                            cap can't see a pre-plan high-load window and
 *                            the first 3 plan weeks are effectively exempt.
 *                            Pass oldest-first (index 0 = earliest).
 *
 * Violations are always reported with a 1-based weekNumber within the PLAN
 * (priorWeekTargets never produce violations themselves — we can't adjust
 * the past).
 */
export function checkCumulativeProgression(
  weekTargets: number[],
  level: AthleteLevel,
  priorWeekTargets: number[] = [],
): CumulativeLoadViolation[] {
  const maxCumulative = MAX_CUMULATIVE_INCREASE[level]
  const violations: CumulativeLoadViolation[] = []
  const windowSize = 3

  // Build a combined view so the reference week can live in the prior segment.
  const combined = [...priorWeekTargets, ...weekTargets]
  const priorCount = priorWeekTargets.length

  // Start at the first index where (a) we have `windowSize` lookback and
  // (b) we're inside the plan (so we don't emit violations for priors).
  const startIdx = Math.max(windowSize, priorCount)
  for (let i = startIdx; i < combined.length; i++) {
    const reference = combined[i - windowSize]
    const current = combined[i]

    // Skip if reference week was a recovery week (very low volume)
    if (reference < 5) continue

    // Skip if current week is a recovery/taper (lower than reference)
    if (current <= reference) continue

    const pctIncrease = (current - reference) / reference
    if (pctIncrease > maxCumulative) {
      const maxAllowed = Math.round(reference * (1 + maxCumulative))
      const planWeekNumber = i - priorCount + 1 // 1-based within plan
      violations.push({
        weekNumber: planWeekNumber,
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

/**
 * Computes the runner's actual weekly km for the N weeks immediately before
 * the reference date (rolling 7-day windows, most-recent last). Used as the
 * prior-week context for checkCumulativeProgression so the first plan week
 * can't spike past the runner's real pre-plan volume.
 */
export function computeRecentWeeklyVolumes(
  activities: SafetyActivity[],
  weeksBack: number,
  referenceDate: Date = new Date(),
): number[] {
  const weekMs = 7 * 24 * 60 * 60 * 1000
  const anchorMs = referenceDate.getTime()
  const weeks: number[] = []
  for (let w = weeksBack; w >= 1; w--) {
    const end = anchorMs - (w - 1) * weekMs
    const start = end - weekMs
    const km = activities
      .filter((a) => {
        const t = new Date(a.date).getTime()
        return t >= start && t < end
      })
      .reduce((s, a) => s + a.distance_km, 0)
    weeks.push(km)
  }
  return weeks
}

// ── ACWR load safety ──────────────────────────────────────────────────────────

export interface AcwrSafety {
  ratio: number
  /**
   * - "no_baseline" — no chronic load to compare against (new user or
   *   returning after a long pause). Treat any reported ratio as meaningless
   *   and start cautiously.
   * - "detraining" — running well under their own baseline (ACWR below
   *   ACWR_LOW_THRESHOLD). Not a safety problem, but not "fine" either: this
   *   used to be folded into "low" with a null message, so a runner losing
   *   fitness got the same green "Optimal" as a runner sitting in the band.
   * - "low" / "moderate" / "high" / "unsafe" — normal ACWR tiers.
   */
  risk: "no_baseline" | "detraining" | "low" | "moderate" | "high" | "unsafe"
  /** Recommended multiplier to apply to the first week's target (e.g. 0.8 for 20% cut) */
  weekOneMultiplier: number
  message: string | null
}

/**
 * Extends the basic ACWR computation with "unsafe" tier and concrete week-1
 * adjustment recommendations.
 */
export function evaluateAcwrSafety(
  activities: SafetyActivity[],
  /** The instant the ACWR windows are measured from. Defaults to now. */
  referenceDate: Date = new Date(),
): AcwrSafety {
  const { acuteLoad, chronicLoad, ratio } = computeACWR(activities, referenceDate.getTime())

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
  // Below the band the runner is detraining, not "safe". The week-one
  // multiplier stays at 1.0 — the plan should not be cut further for someone
  // who is already running less than they used to.
  if (ratio < ACWR_LOW_THRESHOLD) {
    return {
      ratio,
      risk: "detraining",
      weekOneMultiplier: 1.0,
      message: `You're running well below your own baseline (ACWR ${ratio.toFixed(2)}). Fitness fades from here — a steady week back at your usual volume is the way out.`,
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
  /** The instant the 4-week lookback is measured from. Defaults to now. */
  now: number = Date.now(),
): FrequencyWarning | null {
  const fourWeeksMs = 28 * 24 * 60 * 60 * 1000
  const cutoff = now - fourWeeksMs
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
  /**
   * Whether the comparison actually ran. False means "not enough runs, or the
   * newest one is too old to compare" — NOT "no fatigue detected".
   *
   * Both cases return signal "none", which the load card was rendering as a
   * confident "Normal". Callers that display the result must check this;
   * callers that only branch on the signal can ignore it, since an absent
   * signal and an unknown one both mean "do not act".
   */
  hasEnoughData: boolean
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
 * Both signals are gated on a like-for-like check (see
 * FATIGUE_INTENSITY_MATCH_TOLERANCE). Recent and baseline are whole samples of
 * whatever the runner happened to do, so a week of intervals against a week of
 * easy running raised HR by design and reported it as fatigue. HR only counts
 * as elevated when the recent runs were not meaningfully faster, and pace only
 * counts as declining when the effort was not meaningfully lower. The gate is
 * skipped when the other variable is missing, so pace-only (no HR strap)
 * runners keep the pace signal they had before.
 *
 * Requires 8+ qualifying runs (4 recent + 4 baseline minimum).
 */
export function detectFatigue(
  activities: SafetyActivity[],
  /**
   * The instant "recent" is measured from, used by the freshness guard below.
   * Defaults to the current time.
   */
  now: number = Date.now(),
): FatigueResult {
  const runs = activities
    .filter((a) => a.distance_km > 3 && a.duration_seconds > 0)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  if (runs.length < FATIGUE_MIN_QUALIFYING_RUNS) {
    return unknownFatigue()
  }

  // Freshness guard: if the latest qualifying run is older than
  // FATIGUE_FRESHNESS_DAYS, comparing its HR/pace to even older baseline runs
  // produces a stale signal the runner cannot act on. Skip detection during
  // multi-week pauses — the comeback calculator handles return-to-training.
  const latestMs = new Date(runs[0].date).getTime()
  const ageDays = (now - latestMs) / (24 * 60 * 60 * 1000)
  if (ageDays > FATIGUE_FRESHNESS_DAYS) {
    return unknownFatigue()
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
  const hasHr = recentHrs.length >= 3 && baselineHrs.length >= 4

  // Pace fatigue signal — use grade-adjusted pace so hilly runs don't falsely
  // register as "slower" (higher pace value = slower, using median)
  const recentPaces = recent
    .filter((a) => a.pace_min_per_km && a.pace_min_per_km > 0)
    .map((a) => gradeAdjustedPace(a.pace_min_per_km!, a.distance_km, a.elevation_gain_m))
  const baselinePaces = baseline
    .filter((a) => a.pace_min_per_km && a.pace_min_per_km > 0)
    .map((a) => gradeAdjustedPace(a.pace_min_per_km!, a.distance_km, a.elevation_gain_m))
  const hasPace = recentPaces.length >= 3 && baselinePaces.length >= 4

  // Like-for-like gates. `ranFaster` means the recent sample was harder than
  // the baseline (lower GAP = quicker), which explains a higher HR without any
  // fatigue; `ranEasier` means the recent sample was run at a lower effort,
  // which explains a slower pace the same way.
  const tol = FATIGUE_INTENSITY_MATCH_TOLERANCE
  const ranFaster =
    hasPace && median(recentPaces) < median(baselinePaces) * (1 - tol)
  const ranEasier =
    hasHr && median(recentHrs) < median(baselineHrs) * (1 - tol)

  const hrElevated =
    hasHr &&
    median(recentHrs) > median(baselineHrs) + FATIGUE_HR_ELEVATION_BPM &&
    !ranFaster

  const paceDeclining =
    hasPace &&
    median(recentPaces) > median(baselinePaces) * FATIGUE_PACE_DECLINE_FACTOR &&
    !ranEasier

  if (hrElevated && paceDeclining) {
    return {
      signal: "both",
      description: "Heart rate elevated and pace declining — strong fatigue signal. Reduce intensity and add recovery sessions.",
      intensityMultiplier: 0.75,
      hasEnoughData: true,
    }
  }
  if (hrElevated) {
    return {
      signal: "hr_elevated",
      description: "Heart rate is elevated vs recent baseline — possible fatigue. Consider reducing intensity.",
      intensityMultiplier: 0.85,
      hasEnoughData: true,
    }
  }
  if (paceDeclining) {
    return {
      signal: "pace_declining",
      description: "Pace is declining with stable heart rate — possible fatigue. Consider an easy week.",
      intensityMultiplier: 0.90,
      hasEnoughData: true,
    }
  }

  // A clean "none" only counts as a finding if at least one of the two
  // comparisons could be made. Eight runs with neither HR nor pace recorded
  // tell us nothing.
  return {
    signal: "none",
    description: null,
    intensityMultiplier: 1.0,
    hasEnoughData: hasHr || hasPace,
  }
}

/** The "we could not compare" result: no signal, and no claim that there is none. */
function unknownFatigue(): FatigueResult {
  return { signal: "none", description: null, intensityMultiplier: 1.0, hasEnoughData: false }
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
      logWarn("safety", 
        `Week ${week.weekNumber}: long run ${longestSessionKm} km exceeds ${Math.round(LONG_RUN_MAX_FRACTION * 100)}% of ${week.targetKm} km weekly total (max ${maxAllowed} km). Session: "${longestSessionType}"`
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
export function checkProlongedFatigue(
  activities: SafetyActivity[],
  /** The last day of the load series this reads. Defaults to today. */
  referenceDate: Date = new Date(),
  /**
   * Pre-computed load series for the same activities and reference date.
   * computeTrainingLoad walks 120 days of EWMA; callers that already have the
   * series (computeTrainingLoadStatus, and the card that renders it) pass it in
   * rather than paying for a second identical pass.
   */
  precomputedLoad?: TrainingLoadPoint[],
): ProlongedFatigueResult {
  const loadPoints = precomputedLoad ?? computeTrainingLoad(activities, referenceDate)
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

export type LoadStatus =
  | "insufficient_data"
  | "detraining"
  | "optimal"
  | "high"
  | "overtraining_risk"

export interface TrainingLoadStatus {
  status: LoadStatus
  acwr: ReturnType<typeof evaluateAcwrSafety>
  fatigue: FatigueResult
  prolongedFatigue: ProlongedFatigueResult
  athleteLevel: AthleteLevel
  /**
   * False when `athleteLevel` is the "beginner" fallback for thin history
   * rather than a classification. Display code must not present the level as a
   * finding when this is false.
   */
  athleteLevelKnown: boolean
  /**
   * The ATL/CTL/TSB series every other field was derived from, measured to the
   * same `referenceDate`. Exposed so the UI can chart fitness without running
   * the 120-day EWMA a second time — and so it cannot accidentally chart a
   * series anchored to a different instant than the status it sits next to.
   */
  loadPoints: TrainingLoadPoint[]
}

/**
 * Computes the composite training load status for UI display.
 *
 * Every signal is measured from the same `referenceDate` — including the
 * athlete level, which used to read Date.now() internally.
 */
export function computeTrainingLoadStatus(
  activities: SafetyActivity[],
  /** The instant every window is measured from. Defaults to now. */
  referenceDate: Date = new Date(),
): TrainingLoadStatus {
  const loadPoints = computeTrainingLoad(activities, referenceDate)
  const acwr = evaluateAcwrSafety(activities, referenceDate)
  const fatigue = detectFatigue(activities, referenceDate.getTime())
  const prolongedFatigue = checkProlongedFatigue(activities, referenceDate, loadPoints)
  const athleteLevel = classifyAthleteLevel(activities, referenceDate)
  const athleteLevelKnown = hasAthleteLevelEvidence(activities, referenceDate)

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
  } else if (acwr.risk === "detraining") {
    // Ranked below every fatigue signal: a runner who is both under their
    // baseline AND showing drift needs to hear about the drift first.
    status = "detraining"
  }

  return {
    status,
    acwr,
    fatigue,
    prolongedFatigue,
    athleteLevel,
    athleteLevelKnown,
    loadPoints,
  }
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
 * The checks above are now verification, not mutation.
 *
 * Weekly volume is decided before the plan is generated, in
 * lib/training-volume.ts, and session distances are allocated afterwards in
 * lib/training-sessions.ts. A validate-and-rewrite pass used to run between the
 * two and quietly disagreed with both: it capped the long run at 35% of the
 * week, and the correction pass that followed scaled every session back up to
 * the weekly target and handed the long run the remainder, undoing the cap
 * entirely. It also prefixed "Safety: reduced to X km" onto the coach note,
 * exposing internal machinery to explain a gap that no longer exists.
 */
