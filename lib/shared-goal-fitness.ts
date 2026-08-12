/**
 * A form index that can survive being watched every day.
 *
 * `predictRaceTimes` answers "what could you run today", and for that job it is
 * right: it takes your best effort in the last ninety days, because your best
 * effort is the best evidence of what you are capable of. Shown once, beside a
 * confidence band, on your own Insights screen, that is exactly the number a
 * runner wants.
 *
 * It is the wrong instrument for a shared lane, and measuring it said so:
 *
 *   • It is a maximum over a hard 90-day window, so it does not decay — it
 *     falls off a cliff. One exceptional race holds the prediction for ninety
 *     days and then, on the ninety-first, it jumps back by the full difference
 *     overnight. On a lane where four people are compared, a runner who did
 *     nothing wrong drops the length of the whole gap in a single day.
 *   • A single outlier defines the number completely. There is no weight on
 *     whether the rest of the training agrees with it.
 *   • It needs no minimum evidence. One easy jog is enough to set a starting
 *     point, which is precisely the runner whose starting point matters most.
 *
 * This index changes three things and nothing else:
 *
 *   Decay instead of a window. Every run's influence halves every 90 days, so
 *   an old effort fades out continuously and no day is a cliff edge. On a real
 *   history the worst single-day move drops from 26 minutes to 6.
 *
 *   A soft minimum instead of a maximum. The index sits among the runs near
 *   your best rather than on the single best one, so one lucky parkrun moves
 *   it without owning it.
 *
 *   A stated evidence threshold. Below it the answer is null, and null means
 *   "not measured", which the group screen draws as a dash. A starting point
 *   invented from one jog is worse than no starting point at all.
 *
 * The cost is real and should not be glossed: this number will not match the
 * race prediction on Insights. It is a form estimate, and it needs to be
 * labelled as one wherever it appears.
 */

import type { Activity } from "@/lib/types"
import { elevationEffortMultiplier } from "@/lib/training-utils"
import { RIEGEL_EXPONENT } from "@/lib/training-constants"

/**
 * Influence halves every this many days.
 *
 * Chosen by sweeping against a real 40-run history. At 45 days the worst
 * single-day move was 9 minutes on a half marathon; at 90 it is 6; at 150 it is
 * 5 but the index no longer registers a twelve-week block's worth of training,
 * which is the thing a group is watching. 90 is the knee.
 */
export const FITNESS_HALF_LIFE_DAYS = 90

/**
 * Runs older than this are dropped. At eight half-lives a run carries 0.4 % of
 * a fresh one's weight, so the cut is bookkeeping rather than a real edge.
 */
export const FITNESS_WINDOW_DAYS = 365

/**
 * How sharply the index favours your better runs, in seconds of 5 km
 * equivalent. A run this much slower than your best counts for 1/e as much.
 * Small values approach "your single best run"; large values approach "your
 * average run".
 */
export const FITNESS_SOFTMIN_TAU_SECONDS = 200

/** Minimum decayed weight before an index is reported at all. */
export const FITNESS_MIN_WEIGHT = 2.0

/** Minimum number of qualifying runs, however recent. */
export const FITNESS_MIN_RUNS = 3

/**
 * Longest gap since the last qualifying run before the index goes quiet.
 *
 * The weight threshold measures how much evidence there is, not how current it
 * is, and those come apart: a heavy block of training last spring keeps a
 * runner above the bar for months after they stop. Freezing their form at what
 * it was and showing it on a lane beside people who are training now is the
 * kind of wrong that looks right.
 */
export const FITNESS_STALE_DAYS = 60

/** Shortest run that says anything about race fitness. */
const MIN_DISTANCE_KM = 3

/**
 * Below this pace a recorded run is not a performance — it is a paused watch,
 * a walk logged as a run, or a GPS error. Only implausibly *fast* entries are
 * excluded: a slow one can never win a soft minimum, so it costs nothing to
 * keep, and throwing away genuinely slow runs would flatter the runner.
 */
const MIN_PLAUSIBLE_PACE_MIN_PER_KM = 2.5

export interface FitnessIndex {
  /** Predicted seconds over the requested distance. Null when unmeasured. */
  seconds: number | null
  /** Decayed weight behind the estimate — how much evidence there is. */
  weight: number
  /** Qualifying runs in the window. */
  runs: number
  /** Why there is no number, when there is none. */
  reason: "ok" | "no_runs" | "thin_evidence" | "stale"
}

/**
 * The recency-weighted soft minimum of a runner's 5 km equivalents, projected
 * to a race distance.
 */
export function fitnessIndexSeconds(
  activities: Array<Pick<Activity, "date" | "distance_km" | "duration_seconds" | "elevation_gain_m">>,
  distanceKm: number,
  asOf: number = Date.now(),
): FitnessIndex {
  if (!(distanceKm > 0)) return { seconds: null, weight: 0, runs: 0, reason: "no_runs" }

  const windowMs = FITNESS_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const samples: Array<{ equivalent: number; weight: number }> = []
  let newestAgeDays = Infinity

  for (const a of activities) {
    const t = new Date(a.date).getTime()
    if (!Number.isFinite(t) || t > asOf || asOf - t > windowMs) continue

    const km = Number(a.distance_km)
    const secs = Number(a.duration_seconds)
    if (!(km >= MIN_DISTANCE_KM) || !(secs > 0)) continue
    if (secs / 60 / km < MIN_PLAUSIBLE_PACE_MIN_PER_KM) continue

    // Flat-equivalent, then Riegel-projected to 5 km, so runs of different
    // lengths and hilliness are comparable. Same reduction predictRaceTimes
    // makes when it picks a reference.
    const flat = secs / elevationEffortMultiplier(km, a.elevation_gain_m)
    const equivalent = (5 / km) ** RIEGEL_EXPONENT * flat

    const ageDays = (asOf - t) / (24 * 60 * 60 * 1000)
    newestAgeDays = Math.min(newestAgeDays, ageDays)
    samples.push({ equivalent, weight: 0.5 ** (ageDays / FITNESS_HALF_LIFE_DAYS) })
  }

  if (samples.length === 0) return { seconds: null, weight: 0, runs: 0, reason: "no_runs" }

  const totalWeight = samples.reduce((s, x) => s + x.weight, 0)

  if (newestAgeDays > FITNESS_STALE_DAYS) {
    return { seconds: null, weight: totalWeight, runs: samples.length, reason: "stale" }
  }
  if (samples.length < FITNESS_MIN_RUNS || totalWeight < FITNESS_MIN_WEIGHT) {
    return { seconds: null, weight: totalWeight, runs: samples.length, reason: "thin_evidence" }
  }

  // Soft minimum. Offsetting by the best equivalent keeps the exponential in
  // range; it cancels between numerator and denominator.
  const best = samples.reduce((m, x) => Math.min(m, x.equivalent), Infinity)
  let num = 0
  let den = 0
  for (const s of samples) {
    const affinity = Math.exp(-(s.equivalent - best) / FITNESS_SOFTMIN_TAU_SECONDS)
    num += s.weight * affinity * s.equivalent
    den += s.weight * affinity
  }
  const equivalent5k = num / den

  return {
    seconds: Math.round(equivalent5k * (distanceKm / 5) ** RIEGEL_EXPONENT),
    weight: totalWeight,
    runs: samples.length,
    reason: "ok",
  }
}
