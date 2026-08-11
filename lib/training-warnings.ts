/**
 * Proactive training warnings.
 *
 * Pure evaluator that turns training signals (ACWR, fatigue, training load)
 * into user-facing warnings with debounce + cooldown, so the UI can surface
 * them without spamming the runner.
 *
 * The evaluator is stateless on its own — callers pass in the previous
 * `WarningState` (e.g. persisted on the user profile) and receive the next
 * state to persist. This keeps the logic testable and framework-agnostic.
 *
 * Anti-spam guardrails baked in:
 *   - ACWR warning requires the ratio to have stayed elevated for at least
 *     one week, not a single spiky point.
 *   - Fatigue (HR / pace drift) comes from detectFatigue, which already
 *     needs 8+ runs and 5% deltas — a single noisy run cannot trigger it.
 *   - Prolonged fatigue requires 3+ consecutive weeks below the TSB floor
 *     (PROLONGED_FATIGUE_CONSECUTIVE_WEEKS).
 *   - Cooldown (default 14 days) between re-surfacing the same warning so
 *     dismissing a warning doesn't immediately re-appear on next page load.
 */

import type { FatigueSignal, SafetyActivity } from "@/lib/training-safety"
import { detectFatigue } from "@/lib/training-safety"
import { computeACWR, computeTrainingLoad, effortAdjustedKm } from "@/lib/training-utils"
import {
  ACWR_HIGH_THRESHOLD,
  PROLONGED_FATIGUE_CONSECUTIVE_WEEKS,
  PROLONGED_FATIGUE_TSB_THRESHOLD,
  ACWR_CHRONIC_DAYS,
  ACWR_ACUTE_DAYS,
} from "@/lib/training-constants"

export type WarningType =
  | "elevated_acwr"
  | "prolonged_fatigue"
  | "hr_drift"
  | "pace_drift"

export type WarningSeverity = "info" | "warn" | "critical"

export interface Warning {
  type: WarningType
  severity: WarningSeverity
  title: string
  message: string
  triggeredAt: string
  /** Optional structured payload for UI to render specifics (bpm, ratio, etc.) */
  data?: Record<string, number | string | boolean>
}

export interface WarningEntry {
  /** Last time the warning was surfaced to the user — drives the cooldown */
  lastSurfacedAt: string | null
}

export type WarningState = Partial<Record<WarningType, WarningEntry>>

export interface WarningContext {
  /** Current 7-day acute / 28-day chronic load ratio */
  acwr: number
  /** ACWR one week ago — required for the "two-week persistence" guard */
  acwrOneWeekAgo: number
  /** Signal from detectFatigue over the runner's recent runs */
  fatigueSignal: FatigueSignal
  /** Consecutive weeks with TSB below PROLONGED_FATIGUE_TSB_THRESHOLD */
  tsbBelowThresholdWeeks: number
}

export interface EvaluateWarningsOptions {
  /** Days between re-surfacing the same warning. Defaults to 14. */
  cooldownDays?: number
}

export interface EvaluateWarningsResult {
  newWarnings: Warning[]
  nextState: WarningState
}

const DEFAULT_COOLDOWN_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000

function canSurface(
  state: WarningState,
  type: WarningType,
  referenceDate: Date,
  cooldownDays: number,
): boolean {
  const entry = state[type]
  if (!entry?.lastSurfacedAt) return true
  const last = new Date(entry.lastSurfacedAt).getTime()
  const days = (referenceDate.getTime() - last) / DAY_MS
  return days >= cooldownDays
}

function toWarning(
  type: WarningType,
  severity: WarningSeverity,
  title: string,
  message: string,
  triggeredAt: string,
  data?: Warning["data"],
): Warning {
  return { type, severity, title, message, triggeredAt, data }
}

export function evaluateWarnings(
  ctx: WarningContext,
  state: WarningState,
  referenceDate: Date = new Date(),
  options: EvaluateWarningsOptions = {},
): EvaluateWarningsResult {
  const cooldownDays = options.cooldownDays ?? DEFAULT_COOLDOWN_DAYS
  const now = referenceDate.toISOString()
  const newWarnings: Warning[] = []
  const nextState: WarningState = { ...state }

  // ── Elevated ACWR — requires sustained elevation, not a one-week spike ────
  if (
    ctx.acwr > ACWR_HIGH_THRESHOLD &&
    ctx.acwrOneWeekAgo > ACWR_HIGH_THRESHOLD &&
    canSurface(state, "elevated_acwr", referenceDate, cooldownDays)
  ) {
    const severity: WarningSeverity = ctx.acwr > 1.5 ? "critical" : "warn"
    newWarnings.push(
      toWarning(
        "elevated_acwr",
        severity,
        "Training load is climbing fast",
        severity === "critical"
          ? `Your acute load is ${ctx.acwr.toFixed(2)}× your chronic baseline — injury risk is high. Consider an easy week.`
          : `Your load has been elevated (${ctx.acwr.toFixed(2)}×) for the second week in a row. Consider pulling back.`,
        now,
        { acwr: ctx.acwr, previous: ctx.acwrOneWeekAgo },
      ),
    )
    nextState.elevated_acwr = { lastSurfacedAt: now }
  }

  // ── Prolonged fatigue — multi-week TSB below threshold ────────────────────
  if (
    ctx.tsbBelowThresholdWeeks >= PROLONGED_FATIGUE_CONSECUTIVE_WEEKS &&
    canSurface(state, "prolonged_fatigue", referenceDate, cooldownDays)
  ) {
    newWarnings.push(
      toWarning(
        "prolonged_fatigue",
        "critical",
        "You've been running fatigued for a while",
        `Training stress balance has stayed low for ${ctx.tsbBelowThresholdWeeks} straight weeks. A recovery week would help your body absorb the work.`,
        now,
        { weeks: ctx.tsbBelowThresholdWeeks },
      ),
    )
    nextState.prolonged_fatigue = { lastSurfacedAt: now }
  }

  // ── HR drift — detectFatigue already requires 8+ runs and 5 bpm deltas ────
  if (
    (ctx.fatigueSignal === "hr_elevated" || ctx.fatigueSignal === "both") &&
    canSurface(state, "hr_drift", referenceDate, cooldownDays)
  ) {
    newWarnings.push(
      toWarning(
        "hr_drift",
        ctx.fatigueSignal === "both" ? "critical" : "warn",
        "Heart rate is trending up",
        "Your average heart rate has crept higher on recent runs compared to your baseline. That's a common fatigue signal — consider an easier week.",
        now,
        { fatigueSignal: ctx.fatigueSignal },
      ),
    )
    nextState.hr_drift = { lastSurfacedAt: now }
  }

  // ── Pace drift — detectFatigue guards against single noisy runs ───────────
  if (
    (ctx.fatigueSignal === "pace_declining" || ctx.fatigueSignal === "both") &&
    canSurface(state, "pace_drift", referenceDate, cooldownDays)
  ) {
    newWarnings.push(
      toWarning(
        "pace_drift",
        ctx.fatigueSignal === "both" ? "critical" : "warn",
        "Easy pace is slipping",
        "Your grade-adjusted pace has drifted slower recently at similar effort. Consider an easy week or extra rest.",
        now,
        { fatigueSignal: ctx.fatigueSignal },
      ),
    )
    nextState.pace_drift = { lastSurfacedAt: now }
  }

  return { newWarnings, nextState }
}

/**
 * Derives WarningContext from raw signals. Callers typically already have
 * these numbers lying around (plan generator computes ACWR, checkpoint
 * computes fatigue). This helper keeps the shape construction in one place.
 */
export function buildWarningContext(input: {
  currentAcwr: number
  acwrOneWeekAgo: number
  fatigueSignal: FatigueSignal
  tsbBelowThresholdWeeks: number
}): WarningContext {
  return {
    acwr: input.currentAcwr,
    acwrOneWeekAgo: input.acwrOneWeekAgo,
    fatigueSignal: input.fatigueSignal,
    tsbBelowThresholdWeeks: input.tsbBelowThresholdWeeks,
  }
}

/**
 * Utility for the UI layer: counts warnings below a given cooldown to display
 * in a badge (e.g. "2 new warnings").
 */
export function countActiveWarnings(warnings: Warning[]): number {
  return warnings.length
}

// ── Context derivation from raw activities ──────────────────────────────────

/**
 * Activity shape needed by the context builder. Matches the runtime DB shape
 * but kept local here so callers can pass any structurally-compatible object.
 */
export interface WarningActivity {
  date: string
  distance_km: number
  duration_seconds: number
  pace_min_per_km: number | null
  avg_heart_rate: number | null
  elevation_gain_m: number | null
}

/** One week of calendar time in milliseconds */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const DAY_MS_LOCAL = 24 * 60 * 60 * 1000

/**
 * Derives the WarningContext from an activity list + reference date. Runs
 * ACWR twice (current and one week ago) and counts consecutive weeks below
 * the TSB fatigue floor.
 */
export function deriveWarningContext(
  activities: WarningActivity[],
  referenceDate: Date = new Date(),
): WarningContext {
  // ── Current ACWR ──
  const currentAcwr = computeACWR(
    activities.map((a) => ({
      date: a.date,
      distance_km: a.distance_km,
      elevation_gain_m: a.elevation_gain_m,
    })),
    referenceDate.getTime(),
  ).ratio

  // ── ACWR one week ago (shift windows back 7 days) ──
  // The existing computeACWR is now-anchored, so we compute this manually
  // against the same constants (ACWR_ACUTE_DAYS, ACWR_CHRONIC_DAYS).
  const anchorMs = referenceDate.getTime() - 7 * DAY_MS_LOCAL
  const acuteStartMs = anchorMs - ACWR_ACUTE_DAYS * DAY_MS_LOCAL
  const chronicStartMs = anchorMs - ACWR_CHRONIC_DAYS * DAY_MS_LOCAL
  const acutePrev = activities
    .filter((a) => {
      const t = new Date(a.date).getTime()
      return t >= acuteStartMs && t <= anchorMs
    })
    .reduce((s, a) => s + effortAdjustedKm(a.distance_km, a.elevation_gain_m), 0)
  const chronicTotalPrev = activities
    .filter((a) => {
      const t = new Date(a.date).getTime()
      return t >= chronicStartMs && t <= anchorMs
    })
    .reduce((s, a) => s + effortAdjustedKm(a.distance_km, a.elevation_gain_m), 0)
  const chronicPrev = chronicTotalPrev / 4
  const acwrOneWeekAgo = chronicPrev > 0 ? acutePrev / chronicPrev : 0

  // ── Fatigue signal (HR / pace drift) ──
  const safetyActs: SafetyActivity[] = activities.map((a) => ({
    date: a.date,
    distance_km: a.distance_km,
    duration_seconds: a.duration_seconds,
    pace_min_per_km: a.pace_min_per_km,
    avg_heart_rate: a.avg_heart_rate,
    elevation_gain_m: a.elevation_gain_m,
  }))
  const fatigue = detectFatigue(safetyActs, referenceDate.getTime())

  // ── Consecutive weeks below TSB threshold ──
  // computeTrainingLoad returns daily ATL/CTL/TSB points; bucket into weeks
  // (Mon-Sun) and count trailing weeks whose average TSB is below the floor.
  const loadPoints = computeTrainingLoad(
    activities.map((a) => ({
      date: a.date,
      distance_km: a.distance_km,
      elevation_gain_m: a.elevation_gain_m,
    })),
    referenceDate,
  )
  const tsbBelowThresholdWeeks = countTrailingFatigueWeeks(loadPoints, referenceDate)

  return {
    acwr: currentAcwr,
    acwrOneWeekAgo,
    fatigueSignal: fatigue.signal,
    tsbBelowThresholdWeeks,
  }
}

/**
 * Counts the number of trailing full weeks in which the *average* TSB was
 * below PROLONGED_FATIGUE_TSB_THRESHOLD. Counting stops at the first week
 * that is NOT below the threshold, so the result is always "how many weeks
 * in a row right now", not lifetime.
 */
function countTrailingFatigueWeeks(
  loadPoints: Array<{ date: string; tsb: number }>,
  referenceDate: Date,
): number {
  if (loadPoints.length === 0) return 0
  // Group into weekly buckets ending at referenceDate, oldest to newest
  const maxWeeksBack = 12
  const weeklyAvgTsb: number[] = []
  for (let w = 0; w < maxWeeksBack; w++) {
    const windowEnd = referenceDate.getTime() - w * WEEK_MS
    const windowStart = windowEnd - WEEK_MS
    const inWindow = loadPoints.filter((p) => {
      const t = new Date(p.date).getTime()
      return t >= windowStart && t < windowEnd
    })
    if (inWindow.length === 0) {
      weeklyAvgTsb.push(NaN)
      continue
    }
    const avg = inWindow.reduce((s, p) => s + p.tsb, 0) / inWindow.length
    weeklyAvgTsb.push(avg)
  }
  // Count consecutive weeks (from the most recent) below threshold
  let count = 0
  for (const avg of weeklyAvgTsb) {
    if (!Number.isFinite(avg)) break
    if (avg < PROLONGED_FATIGUE_TSB_THRESHOLD) count++
    else break
  }
  return count
}
