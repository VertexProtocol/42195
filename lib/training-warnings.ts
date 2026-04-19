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

import type { FatigueSignal } from "@/lib/training-safety"
import {
  ACWR_HIGH_THRESHOLD,
  PROLONGED_FATIGUE_CONSECUTIVE_WEEKS,
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
