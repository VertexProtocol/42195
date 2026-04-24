import type { TrainingPlan, TrainingSession, Workout } from "./types"

// ─── Pace estimates ─────────────────────────────────────────────────────────
//
// Used to convert time-based workout blocks (warmup, cooldown, fartlek) into
// approximate distance. These defaults are intentionally conservative — when
// a caller has the runner's actual recent easy pace, pass it in via options
// for a tighter estimate.

const DEFAULT_EASY_PACE_MIN_PER_KM = 6.5   // 6:30/km for warmup/cooldown
const DEFAULT_HARD_PACE_MIN_PER_KM = 4.5   // 4:30/km during reps/fartlek surges

/** Tolerance: a session's declared distance may deviate from the block sum
 *  by this fraction before we flag it as inconsistent. 15% is generous
 *  enough for pace-estimate error to not cause false positives. */
export const DISTANCE_DEVIATION_TOLERANCE = 0.15

// ─── Public API ─────────────────────────────────────────────────────────────

export interface DistanceValidationOptions {
  /** Runner's recent easy pace in min/km — improves time-block conversion */
  easyPaceMinPerKm?: number | null
}

export interface SessionDistanceIssue {
  weekNumber: number
  sessionIndex: number
  sessionType: string
  declaredKm: number
  expectedKm: number
  deviationPct: number
}

export interface ReconcileResult {
  /** Sessions where the declared distance was off by more than tolerance. */
  issues: SessionDistanceIssue[]
  /** The plan with `distance` text fields rewritten to match block totals. */
  reconciledPlan: TrainingPlan
}

/**
 * Compute the expected total distance (km) for a workout by summing its
 * blocks. Time-based blocks (warmup/cooldown/fartlek) are converted to
 * distance using pace estimates.
 *
 * For fartlek blocks the average pace blends easy-float and surge paces
 * 50/50 — a rough approximation good enough for sanity-checking.
 */
export function computeExpectedDistanceKm(
  workout: Workout,
  options: DistanceValidationOptions = {},
): number {
  const easyPace = options.easyPaceMinPerKm && options.easyPaceMinPerKm > 0
    ? options.easyPaceMinPerKm
    : DEFAULT_EASY_PACE_MIN_PER_KM

  let totalKm = 0
  for (const block of workout.blocks) {
    switch (block.kind) {
      case "warmup":
      case "cooldown":
        totalKm += block.minutes / easyPace
        break
      case "steady":
        totalKm += block.distance_km
        break
      case "reps": {
        // Work distance
        totalKm += (block.count * block.distance_m) / 1000
        // Recovery — reps_count - 1 recoveries between reps, or N recoveries
        // depending on interpretation. Claude's usage seems to be N, treat as N.
        if (block.recovery_m) totalKm += (block.count * block.recovery_m) / 1000
        if (block.recovery_minutes) {
          totalKm += (block.count * block.recovery_minutes) / easyPace
        }
        break
      }
      case "fartlek": {
        // Blend easy + hard pace 50/50 — a reasonable average for a
        // fartlek where surges are roughly balanced with floats
        const blendedPace = (easyPace + DEFAULT_HARD_PACE_MIN_PER_KM) / 2
        totalKm += block.total_minutes / blendedPace
        break
      }
    }
  }
  return totalKm
}

/** Parse the km number out of a free-text distance string like "7.5 km" or
 *  "8–10 km". Same heuristic as the display-side parser. */
export function parseDeclaredDistanceKm(distance: string): number | null {
  const rangeMatch = distance.match(/([\d.]+)\s*[–\-]\s*([\d.]+)\s*km/i)
  if (rangeMatch) {
    const lo = parseFloat(rangeMatch[1])
    const hi = parseFloat(rangeMatch[2])
    if (Number.isFinite(lo) && Number.isFinite(hi)) return (lo + hi) / 2
  }
  const singleMatch = distance.match(/([\d.]+)\s*km/i)
  if (singleMatch) {
    const km = parseFloat(singleMatch[1])
    if (Number.isFinite(km)) return km
  }
  return null
}

/**
 * Validates all sessions with a workout field and rewrites the `distance`
 * text to match block totals when they disagree by more than tolerance.
 *
 * Why replace `distance` rather than the blocks:
 *   • Blocks are structured data (counts, minutes, pace_targets) — they
 *     describe exactly what the runner should DO.
 *   • `distance` is Claude's running-total summary — if it doesn't add up
 *     to the blocks, the blocks are the source of truth and `distance`
 *     should be amended to match. Otherwise we'd be rewriting the actual
 *     workout structure on Claude's behalf, which is overreach.
 *
 * Reconciliation strategy:
 *   • Expected km computed from blocks.
 *   • If |declared − expected| / expected > tolerance → rewrite `distance`
 *     to "{expected.toFixed(1)} km total".
 *   • Issue logged in the result so callers can surface / persist it.
 */
export function reconcileWorkoutDistances(
  plan: TrainingPlan,
  options: DistanceValidationOptions = {},
): ReconcileResult {
  const issues: SessionDistanceIssue[] = []
  const reconciledPlan: TrainingPlan = {
    ...plan,
    weeks: plan.weeks.map((week) => ({
      ...week,
      sessions: week.sessions.map((session, sessionIndex) => {
        const fixed = reconcileSession(session, options)
        if (fixed.issue) {
          issues.push({
            ...fixed.issue,
            weekNumber: week.weekNumber,
            sessionIndex,
          })
        }
        return fixed.session
      }),
    })),
  }
  return { issues, reconciledPlan }
}

/** Single-session reconciliation helper (also exported for unit-testing). */
export function reconcileSession(
  session: TrainingSession,
  options: DistanceValidationOptions = {},
): { session: TrainingSession; issue: Omit<SessionDistanceIssue, "weekNumber" | "sessionIndex"> | null } {
  if (!session.workout || session.workout.blocks.length === 0) {
    return { session, issue: null }
  }
  const declared = parseDeclaredDistanceKm(session.distance)
  const expected = computeExpectedDistanceKm(session.workout, options)
  if (declared === null || expected <= 0) {
    return { session, issue: null }
  }
  const deviationPct = Math.abs((declared - expected) / expected)
  if (deviationPct <= DISTANCE_DEVIATION_TOLERANCE) {
    return { session, issue: null }
  }

  // Mismatch — rewrite declared distance to match the blocks.
  const rewritten = `${expected.toFixed(1)} km total`
  return {
    session: { ...session, distance: rewritten },
    issue: {
      sessionType: session.type,
      declaredKm: declared,
      expectedKm: Number(expected.toFixed(2)),
      deviationPct: Number((deviationPct * 100).toFixed(1)),
    },
  }
}
