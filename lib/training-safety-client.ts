/**
 * Client-safe subset of training-safety utilities.
 *
 * These functions are pure, deterministic, and have zero server-side imports,
 * making them safe to use in "use client" React components.
 *
 * The main training-safety.ts re-exports these so server-side callers
 * don't need to change their imports.
 */

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
 * Both volume AND frequency must qualify for a given level to prevent
 * misclassification (e.g. 5×4km/week is not advanced despite high frequency).
 * - Advanced:     avg weekly km > 50  AND avg sessions/week > 4
 * - Intermediate: avg weekly km > 20  AND avg sessions/week >= 2
 * - Beginner:     everything else
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

  if (avgWeeklyKm > 50 && avgSessionsPerWeek > 4) return "advanced"
  if (avgWeeklyKm > 20 && avgSessionsPerWeek >= 2) return "intermediate"
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
  if (previousPlannedKm && nextPlannedKm < previousPlannedKm * 0.85) return null

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
    severity: spikePct > 30 ? "danger" : "caution",
  }
}
