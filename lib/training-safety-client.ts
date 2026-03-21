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
 * Both volume AND frequency must qualify for a given level. Additionally, a
 * consistency factor and training history length are considered:
 * - Consistency: % of the 12 classification weeks that had at least one run.
 *   Low consistency (< 50% active weeks) downgrades the level by one tier,
 *   because a runner returning from a 6-week break is not the same as one
 *   who has trained steadily at the same volume.
 * - History length: fewer than 4 weeks of data always returns "beginner" —
 *   not enough signal to classify higher.
 *
 * Tiers:
 * - Advanced:     avg weekly km > 50  AND avg sessions/week > 4  AND ≥50% active weeks
 * - Intermediate: avg weekly km > 20  AND avg sessions/week >= 2 AND ≥33% active weeks
 * - Beginner:     everything else
 */
export function classifyAthleteLevel(activities: SafetyActivity[]): AthleteLevel {
  if (activities.length === 0) return "beginner"

  const lookbackMs = ATHLETE_CLASSIFICATION_WEEKS * 7 * 24 * 60 * 60 * 1000
  const cutoff = Date.now() - lookbackMs
  const recent = activities.filter((a) => new Date(a.date).getTime() >= cutoff)

  // Not enough history to classify above beginner
  if (recent.length < 4) return "beginner"

  const totalKm = recent.reduce((s, a) => s + a.distance_km, 0)
  const avgWeeklyKm = totalKm / ATHLETE_CLASSIFICATION_WEEKS
  const avgSessionsPerWeek = recent.length / ATHLETE_CLASSIFICATION_WEEKS

  // Compute active weeks: weeks that had at least one run
  const weekMs = 7 * 24 * 60 * 60 * 1000
  const weeksSeen = new Set<number>()
  for (const a of recent) {
    const t = new Date(a.date).getTime()
    const weekBucket = Math.floor((t - cutoff) / weekMs)
    weeksSeen.add(weekBucket)
  }
  const activeWeeks = weeksSeen.size
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
