/**
 * Where a runner stands in a shared goal, on a scale everyone in the group can
 * be read on at once.
 *
 * A group training for one race has the date in common and nothing else: the
 * target times differ, and so does the form each runner brought with them. Two
 * measures survive that, and this module implements both.
 *
 * ADHERENCE — km run against km planned, over the block's completed weeks.
 * This is what groups run on. It needs no fitness estimate and no locked
 * starting point, it is readable from the first completed week, and a
 * beginner on 30 km a week and a veteran on 90 stand on it as equals. It
 * measures showing up, and it can be gamed by planning less — every block, if
 * a runner wants to.
 *
 * PROGRESS — the share of your own gap you have closed since joining:
 *
 *     position = (baseline − current) / (baseline − target)
 *
 * Better in principle: it rewards moving rather than complying, and its one
 * exploit — joining while unfit — is locked shut the moment you join. It is
 * implemented, tested, and not offered. Measured against a real 40-run
 * history it needs denser logging than this app's runners do: the form
 * estimate under it is usable on 78 % of days and still moves six minutes in
 * one, which is most of a realistic goal gap. See `shared-goal-fitness.ts`.
 *
 * A group's measure is fixed at creation and never edited, so one lane is
 * always one scale. `memberPosition` is the single place that turns a member's
 * data into a position, and it takes the measure as an argument.
 *
 * This module is pure. Reading and writing the rows lives in
 * `lib/shared-goal-sync.ts`, so the arithmetic can be tested without a
 * database.
 */

import type { Activity, SharedGoalMetric, TrainingPlan } from "@/lib/types"
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
  /** Adherence only: no plan, or the block's first week is not yet behind them. */
  | "no_plan"

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

/**
 * Where a runner stands when the group measures adherence.
 *
 * Km run against km planned, over the completed weeks of the block. Unlike the
 * progress measure this needs no locked starting point and no fitness estimate
 * at all — which is most of why it survives contact with real training logs.
 *
 * Above 100 is left as it is. Doing more than the plan asked is a real thing
 * that happened, and rounding it down to a full lane would hide the runner who
 * is quietly overreaching.
 */
export function adherencePosition(a: BlockAdherence): SharedGoalPosition {
  if (a.weeks === 0 || a.targetKm <= 0) {
    return { pct: null, lanePct: 0, state: "no_plan" }
  }
  const pct = Math.round((a.doneKm / a.targetKm) * 1000) / 10
  return { pct, lanePct: Math.max(0, Math.min(100, pct)), state: "measured" }
}

/**
 * The member's position under whichever measure their group runs on.
 *
 * The measure is a property of the shared goal, never of the member, so
 * everyone on one lane is on one scale. Dispatching here rather than at the
 * call site keeps that true by construction: there is one place that turns a
 * member's data into a position, and it takes the group's measure as an
 * argument it cannot ignore.
 */
export function memberPosition(
  metric: SharedGoalMetric,
  input: {
    baselineSeconds?: number | null
    currentSeconds?: number | null
    targetSeconds?: number | null
    adherence: BlockAdherence
  },
): SharedGoalPosition {
  switch (metric) {
    case "adherence":
      return adherencePosition(input.adherence)
    case "progress":
    case "proximity":
      // 'proximity' has no implementation and is not offered; falling through
      // to progress would quietly measure something else, so it reports itself
      // as unmeasured until it is built.
      return metric === "progress"
        ? sharedGoalPosition(input.baselineSeconds, input.currentSeconds, input.targetSeconds)
        : { pct: null, lanePct: 0, state: "no_baseline" }
  }
}
