/**
 * Client-safe subset of training-safety utilities.
 *
 * These functions are pure, deterministic, and have zero server-side imports,
 * making them safe to use in "use client" React components.
 *
 * The main training-safety.ts re-exports these so server-side callers
 * don't need to change their imports.
 */

import {
  RECOVERY_WEEK_THRESHOLD,
  ATHLETE_CLASSIFICATION_WEEKS,
  ATHLETE_MIN_CLASSIFIABLE_RUNS,
  ATHLETE_ADVANCED_KM_PER_WEEK,
  ATHLETE_ADVANCED_SESSIONS_PER_WEEK,
  ATHLETE_INTERMEDIATE_KM_PER_WEEK,
  ATHLETE_INTERMEDIATE_SESSIONS_PER_WEEK,
  SKIP_LOAD_SPIKE_DANGER_THRESHOLD,
} from "@/lib/training-constants"

// ── Types ─────────────────────────────────────────────────────────────────────

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
  elevation_gain_m?: number | null
}

export type AthleteLevel = "beginner" | "intermediate" | "advanced"

/** Maximum weekly volume increase allowed per level (as a fraction, e.g. 0.08 = 8%) */
export const MAX_WEEKLY_INCREASE: Record<AthleteLevel, number> = {
  beginner: 0.08,
  intermediate: 0.10,
  advanced: 0.12,
}

// ── Athlete level classification ──────────────────────────────────────────────

/**
 * Classifies an athlete based on their 12-week activity history.
 *
 * Volume and frequency are averaged over ACTIVE WEEKS ONLY (weeks with at
 * least one run), not the full 12-week window. Averaging over the full
 * window penalised athletes with planned breaks (e.g. 8 weeks at 70 km/wk
 * + 4 weeks injured got reported as 47 km/wk and dropped to intermediate),
 * and over-classified sporadic runners (a single 100 km week got smoothed
 * down toward "beginner").
 *
 * Consistency (% of 12 weeks that were active) gates whether a tier is
 * available at all, so a runner whose active-weeks average looks like
 * "advanced" but only ran 4 of 12 weeks is still capped at intermediate.
 *
 * - History length: fewer than ATHLETE_MIN_CLASSIFIABLE_RUNS qualifying
 *   activities ⇒ beginner. That is a FALLBACK, not a finding — ask
 *   hasAthleteLevelEvidence before presenting the result as a classification.
 *
 * Tiers (all three conditions must hold):
 * - Advanced:     active-week avg km > 50  AND sessions/active-week > 4   AND ≥50% active weeks
 * - Intermediate: active-week avg km > 20  AND sessions/active-week >= 2  AND ≥33% active weeks
 * - Beginner:     everything else
 */
export function classifyAthleteLevel(
  activities: SafetyActivity[],
  /**
   * The instant the 12-week window is measured back from. Defaults to now.
   * Passed explicitly by computeTrainingLoadStatus so that every signal in one
   * status object is measured from the same instant — this used to read
   * Date.now() directly, which also made the level differ between a server
   * render and the client render that followed it across a day boundary.
   */
  referenceDate: Date = new Date(),
): AthleteLevel {
  if (activities.length === 0) return "beginner"

  const cutoff = classificationCutoff(referenceDate)
  const recent = activities.filter((a) => new Date(a.date).getTime() >= cutoff)

  // Not enough history to classify above beginner
  if (recent.length < ATHLETE_MIN_CLASSIFIABLE_RUNS) return "beginner"

  const totalKm = recent.reduce((s, a) => s + a.distance_km, 0)

  // Compute active weeks: weeks that had at least one run
  const weekMs = 7 * 24 * 60 * 60 * 1000
  const weeksSeen = new Set<number>()
  for (const a of recent) {
    const t = new Date(a.date).getTime()
    const weekBucket = Math.floor((t - cutoff) / weekMs)
    weeksSeen.add(weekBucket)
  }
  const activeWeeks = weeksSeen.size
  if (activeWeeks === 0) return "beginner"

  // Average across active weeks only — see docstring for rationale
  const avgWeeklyKm = totalKm / activeWeeks
  const avgSessionsPerWeek = recent.length / activeWeeks
  const consistencyPct = activeWeeks / ATHLETE_CLASSIFICATION_WEEKS

  if (
    avgWeeklyKm > ATHLETE_ADVANCED_KM_PER_WEEK &&
    avgSessionsPerWeek > ATHLETE_ADVANCED_SESSIONS_PER_WEEK &&
    consistencyPct >= 0.50
  ) return "advanced"

  if (
    avgWeeklyKm > ATHLETE_INTERMEDIATE_KM_PER_WEEK &&
    avgSessionsPerWeek >= ATHLETE_INTERMEDIATE_SESSIONS_PER_WEEK &&
    consistencyPct >= 0.33
  ) return "intermediate"

  return "beginner"
}

/** Start of the classification window, as an epoch millisecond value. */
function classificationCutoff(referenceDate: Date): number {
  const lookbackMs = ATHLETE_CLASSIFICATION_WEEKS * 7 * 24 * 60 * 60 * 1000
  return referenceDate.getTime() - lookbackMs
}

/**
 * Whether classifyAthleteLevel had enough history to actually classify, as
 * opposed to falling back to "beginner".
 *
 * The two are indistinguishable in the return value, and the UI was presenting
 * the fallback as a finding: a runner with two logged runs was told they are a
 * "Beginner" on the same card that admitted it had no baseline. Anything that
 * DISPLAYS the level should gate on this; anything that only uses it to pick a
 * progression cap can keep using the conservative fallback.
 */
export function hasAthleteLevelEvidence(
  activities: SafetyActivity[],
  referenceDate: Date = new Date(),
): boolean {
  const cutoff = classificationCutoff(referenceDate)
  const recent = activities.filter((a) => new Date(a.date).getTime() >= cutoff)
  return recent.length >= ATHLETE_MIN_CLASSIFIABLE_RUNS
}

// ── Reactive skip-load spike detection ────────────────────────────────────────

export interface SkipLoadWarning {
  actualKm: number
  nextPlannedKm: number
  safeMaxKm: number
  spikePct: number
  maxAllowedPct: number
  severity: "caution" | "danger"
}

/**
 * Compares the runner's actual km from a recently completed week against the
 * next planned week's target. Returns a warning when the jump exceeds the
 * level-appropriate progression cap, indicating a potential injury risk
 * caused by skipped sessions.
 *
 * Pure, deterministic, no API calls.
 */
export function checkSkipLoadSpike(
  recentActualKm: number,
  nextPlannedKm: number,
  level: AthleteLevel,
  previousPlannedKm?: number,
): SkipLoadWarning | null {
  // If next week is a recovery week (planned drop ≥15% from previous planned), skip check
  if (previousPlannedKm && nextPlannedKm < previousPlannedKm * RECOVERY_WEEK_THRESHOLD) return null

  // If actual >= planned (runner is on track or ahead), no spike
  if (recentActualKm >= nextPlannedKm) return null

  const maxAllowedPct = MAX_WEEKLY_INCREASE[level]

  // Complete rest week — any meaningful next week is dangerous
  if (recentActualKm === 0 && nextPlannedKm > 0) {
    return {
      actualKm: 0,
      nextPlannedKm,
      safeMaxKm: 0,
      spikePct: 100,
      maxAllowedPct: Math.round(maxAllowedPct * 100),
      severity: "danger",
    }
  }

  const spikeFraction = (nextPlannedKm - recentActualKm) / recentActualKm
  if (spikeFraction <= maxAllowedPct) return null

  const safeMaxKm = Math.round(recentActualKm * (1 + maxAllowedPct))
  const spikePct = Math.round(spikeFraction * 100)

  return {
    actualKm: Math.round(recentActualKm * 10) / 10,
    nextPlannedKm,
    safeMaxKm,
    spikePct,
    maxAllowedPct: Math.round(maxAllowedPct * 100),
    severity: spikePct > SKIP_LOAD_SPIKE_DANGER_THRESHOLD ? "danger" : "caution",
  }
}
