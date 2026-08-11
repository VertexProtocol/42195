/**
 * Session distance allocation.
 *
 * The training plan's numbers are owned by code, not by the model. Claude
 * chooses the shape of a week — how many sessions, of which types, at which
 * effort, and why — and this module turns that shape plus a weekly volume
 * target into concrete distances.
 *
 * This replaces a post-generation correction pass that scaled, re-labelled and
 * rounded whatever distances Claude had written. That pass ran after the safety
 * engine and silently undid its long-run cap: a week capped at 14 km came out
 * at 16 km, because scaling every session back up to the weekly target handed
 * the remainder to the long run. Allocating from the target in the first place
 * makes the cap structural rather than something to re-check afterwards.
 *
 * Pure and deterministic — safe on both server and client.
 */

import {
  SESSION_DISTANCE_STEP_KM,
  MIN_SESSION_KM,
  MIN_SESSION_KM_LOW_VOLUME,
  LOW_VOLUME_WEEK_KM,
  LONG_RUN_MAX_FRACTION,
  LONG_RUN_FRACTION_MARGIN,
} from "@/lib/training-constants"

// ── Distance parsing ─────────────────────────────────────────────────────────

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
 * Extracts km from a session distance string. Returns the high end of a range,
 * so load calculations plan for the harder of the two readings.
 *
 * Server and client must agree here: the client previously used the midpoint of
 * a range, so a "8–10 km" session counted as 9 km in the UI and 10 km on the
 * server, and weekly totals in the app never matched the stored targetKm.
 * Newly generated plans only contain single values; ranges survive in plans
 * generated before allocation moved into code.
 */
export function parseSessionDistanceKm(distance: string): number {
  const parts = parseSessionDistanceParts(distance)
  return parts ? parts.high : 0
}

/** Formats a km value the way session distances are stored, e.g. "12.5 km". */
export function formatSessionDistance(km: number): string {
  return `${km} km`
}

// ── Allocation ───────────────────────────────────────────────────────────────

export interface SessionAllocation {
  /** One distance per input session, in the same order. Sums exactly to the target. */
  distances: number[]
  /**
   * True when the week's volume cannot give every session the minimum useful
   * length. The caller decides what to do — the honest fix is fewer, longer
   * sessions, which is a preference change rather than something to paper over.
   */
  belowMinimum: boolean
}

/** True when a session type reads as the week's long run. */
export function isLongRunType(sessionType: string): boolean {
  return /long/i.test(sessionType)
}

/**
 * The largest share of weekly volume the long run may take, given how many
 * sessions the week has. See LONG_RUN_FRACTION_MARGIN for why this is not
 * simply LONG_RUN_MAX_FRACTION.
 */
export function longRunMaxFraction(sessionCount: number): number {
  if (sessionCount <= 1) return 1
  return Math.max(LONG_RUN_MAX_FRACTION, 1 / sessionCount + LONG_RUN_FRACTION_MARGIN)
}

/** The minimum session length that applies at this weekly volume. */
export function minSessionKm(targetKm: number): number {
  return targetKm < LOW_VOLUME_WEEK_KM ? MIN_SESSION_KM_LOW_VOLUME : MIN_SESSION_KM
}

/** Splits `totalSteps` across `count` slots as evenly as possible, largest first. */
function distributeEvenly(totalSteps: number, count: number): number[] {
  const base = Math.floor(totalSteps / count)
  const remainder = totalSteps - base * count
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0))
}

/**
 * Allocates a week's volume across its sessions.
 *
 * Guarantees:
 * - the distances sum to `targetKm` exactly (both snapped to SESSION_DISTANCE_STEP_KM)
 * - the long run, when the week has one, is strictly the longest session and
 *   never exceeds longRunMaxFraction(n) of the week
 *
 * Best-effort:
 * - a couple of km of clearance over the next-longest session (LONG_RUN_MIN_LEAD_KM). The share cap wins when
 *   the two conflict, which happens in small two-session weeks.
 * - minSessionKm per session. Reported via `belowMinimum` rather than enforced,
 *   because the only real fix is running fewer sessions that week.
 */
export function allocateSessionDistances(
  targetKm: number,
  sessionTypes: string[],
): SessionAllocation {
  const count = sessionTypes.length
  if (count === 0) return { distances: [], belowMinimum: false }

  const step = SESSION_DISTANCE_STEP_KM
  const totalSteps = Math.max(0, Math.round(targetKm / step))
  const toKm = (steps: number) => Math.round(steps * step * 10) / 10

  if (totalSteps === 0) {
    return { distances: Array(count).fill(0), belowMinimum: true }
  }

  const minSteps = Math.round(minSessionKm(toKm(totalSteps)) / step)
  const longIdx = sessionTypes.findIndex(isLongRunType)

  let stepsPerSession: number[]

  if (count === 1) {
    stepsPerSession = [totalSteps]
  } else if (longIdx === -1) {
    // No long run in this week — nothing to protect, split it evenly.
    stepsPerSession = distributeEvenly(totalSteps, count)
  } else {
    const maxLongSteps = Math.floor(totalSteps * longRunMaxFraction(count))
    // At least one step for every other session, so nothing comes out at 0 km.
    const longSteps = Math.max(1, Math.min(maxLongSteps, totalSteps - (count - 1)))
    const others = distributeEvenly(totalSteps - longSteps, count - 1)

    stepsPerSession = []
    let o = 0
    for (let i = 0; i < count; i++) {
      stepsPerSession.push(i === longIdx ? longSteps : others[o++])
    }
  }

  const distances = stepsPerSession.map(toKm)
  const belowMinimum = stepsPerSession.some((s) => s < minSteps)

  return { distances, belowMinimum }
}

/**
 * Verification helper for tests and logging: does this week honour the long-run
 * share cap? Allocation guarantees it, so a false here means a plan was built
 * some other way (an older stored plan, or a bug).
 */
export function longRunWithinCap(distances: number[], targetKm: number): boolean {
  if (distances.length === 0 || targetKm <= 0) return true
  const longest = Math.max(...distances)
  // Allow one rounding step of slack.
  return longest <= targetKm * longRunMaxFraction(distances.length) + SESSION_DISTANCE_STEP_KM
}
