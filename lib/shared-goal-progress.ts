/**
 * Shared goal progress — where a runner stands against their own starting
 * point, on a scale everyone in a group can be read on at once.
 *
 * A group training for one race has one race date and nothing else in common:
 * the target times differ, and so does the form each runner brought with them.
 * Measuring absolute fitness would rank the group before the block began.
 * Measuring adherence would rank the most modest plan first. So the position
 * measures neither — it measures the share of your *own* gap you have closed:
 *
 *     baseline   the predicted time over the race distance on the day you
 *                joined, locked then and never recomputed
 *     current    the predicted time over the race distance today
 *     target     the time you are aiming for
 *
 *     position = (baseline − current) / (baseline − target)
 *
 * A beginner who has taken fifty minutes off a five-hour marathon is further
 * round the lane than a three-hour runner who has taken off two, and that is
 * the intended reading, not a rounding artefact.
 *
 * The baseline is locked because it is the one number a member could otherwise
 * game: rejoin after a bad week and every subsequent easy gain counts twice.
 *
 * This module is pure. Reading and writing the rows lives in
 * `lib/shared-goal-sync.ts`, so the arithmetic can be tested without a
 * database.
 */

import type { Activity, TrainingPlan } from "@/lib/types"
import { fitnessIndexSeconds, type FitnessIndex } from "@/lib/shared-goal-fitness"
import { getCurrentBlockWeekIndex, getWeekActualKm } from "@/lib/training-checkpoint"

/**
 * The estimate both ends of the fraction are built from.
 *
 * Not `predictRaceTimes`. That function takes the best effort in a hard 90-day
 * window, which is right for a race prediction and wrong for a number two
 * people compare every day: measured against a real history it moved 26
 * minutes in a single day when a good run aged out of the window. The form
 * index decays instead of expiring, and the same measurement puts its worst
 * single-day move at 6. See `lib/shared-goal-fitness.ts`.
 */
export function goalFitness(
  activities: Array<Pick<Activity, "date" | "distance_km" | "duration_seconds" | "elevation_gain_m">>,
  goalDistanceKm: number,
  asOf: number = Date.now(),
): FitnessIndex {
  return fitnessIndexSeconds(activities, goalDistanceKm, asOf)
}

export type SharedGoalPositionState =
  /** Measured against a locked baseline. `pct` is meaningful. */
  | "measured"
  /** Joined too recently, or too little history, to have a starting point. */
  | "no_baseline"
  /** There is a baseline, but nothing recent enough to predict from today. */
  | "no_current"
  /** The baseline was already at or past the target when the runner joined. */
  | "already_met"

export interface SharedGoalPosition {
  /**
   * The honest figure. Negative when the runner has gone backwards, and above
   * 100 when they have passed their own target. Null when unmeasurable.
   */
  pct: number | null
  /**
   * What the lane draws: 0–100. A negative position holds the marker on the
   * start line rather than sending it round the wrong way, and an unmeasurable
   * one draws nothing.
   */
  lanePct: number
  state: SharedGoalPositionState
}

/**
 * Where a runner stands, given the three times.
 *
 * The unmeasurable cases return a state rather than a zero. A zero is a claim
 * about the runner — that they have made no progress — and it is not one this
 * function is ever in a position to make.
 */
export function sharedGoalPosition(
  baselineSeconds: number | null | undefined,
  currentSeconds: number | null | undefined,
  targetSeconds: number | null | undefined,
): SharedGoalPosition {
  if (baselineSeconds == null || baselineSeconds <= 0 || targetSeconds == null || targetSeconds <= 0) {
    return { pct: null, lanePct: 0, state: "no_baseline" }
  }

  // Nothing to close. Joining already faster than the target is a group
  // problem to raise at sign-up, not twelve weeks of a meaningless 100 %.
  if (baselineSeconds <= targetSeconds) {
    return { pct: null, lanePct: 100, state: "already_met" }
  }

  if (currentSeconds == null || currentSeconds <= 0) {
    return { pct: null, lanePct: 0, state: "no_current" }
  }

  const gap = baselineSeconds - targetSeconds
  const closed = baselineSeconds - currentSeconds
  const pct = Math.round((closed / gap) * 1000) / 10

  return {
    pct,
    lanePct: Math.max(0, Math.min(100, pct)),
    state: "measured",
  }
}

/** Km run against km planned, over the completed weeks of a training block. */
export interface BlockAdherence {
  doneKm: number
  targetKm: number
  /** Completed weeks counted. Zero means there is nothing to report yet. */
  weeks: number
}

/**
 * The second line of a member row: has this person actually been training.
 *
 * Only completed weeks count, which is how `analyzeBlockAdherence` already
 * defines adherence. Two definitions of the same word in one codebase is the
 * exact failure `lib/training-phase.ts` was written to undo, so this one
 * follows rather than invents. The cost is that the number is silent until the
 * block's first week is behind the runner.
 */
export function blockAdherence(
  plan: TrainingPlan | null | undefined,
  activities: Array<{ date: string; distance_km: number }>,
  blockStartDate: string | null | undefined,
): BlockAdherence {
  const empty: BlockAdherence = { doneKm: 0, targetKm: 0, weeks: 0 }
  if (!plan || !blockStartDate || plan.weeks.length === 0) return empty

  const completed = Math.min(getCurrentBlockWeekIndex(blockStartDate), plan.weeks.length)
  if (completed <= 0) return empty

  let doneKm = 0
  let targetKm = 0
  for (let i = 0; i < completed; i++) {
    doneKm += getWeekActualKm(activities, blockStartDate, i)
    targetKm += plan.weeks[i].targetKm
  }

  return {
    doneKm: Math.round(doneKm * 10) / 10,
    targetKm: Math.round(targetKm * 10) / 10,
    weeks: completed,
  }
}
