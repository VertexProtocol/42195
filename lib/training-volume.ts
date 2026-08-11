/**
 * Weekly volume targets.
 *
 * One place that decides how many kilometres each week of a block gets. It runs
 * BEFORE the plan is generated, so the volumes handed to Claude are the volumes
 * the runner actually gets — which means the summary and coach notes it writes
 * describe the real plan.
 *
 * Previously volume was decided in four passes that did not know about each
 * other: a baseline calculation that applied its own ACWR reduction, the safety
 * engine applying a second one on top, a comeback cap, and a final correction
 * loop. Each was individually defensible; multiplied together they could put a
 * returning runner at 60% of an already conservative baseline. The reductions
 * are now combined once, with the strongest one winning rather than compounding.
 */

import {
  checkCumulativeProgression,
  type AcwrSafety,
  type ProlongedFatigueResult,
} from "@/lib/training-safety"
import { MAX_WEEKLY_INCREASE, type AthleteLevel } from "@/lib/training-safety-client"
import { RECOVERY_WEEK_THRESHOLD } from "@/lib/training-constants"
import type { ComebackRecommendation } from "@/lib/training-comeback"

/** Fraction of the previous week's volume that the closing recovery week gets. */
const RECOVERY_WEEK_FRACTION = 0.8

/**
 * How much of a volume reduction lands on each of the first three weeks.
 * Week 1 takes it in full, then it eases off rather than ending abruptly.
 */
const REDUCTION_GRADUATION = [1.0, 0.5, 0.25]

/** Default weekly volume for a runner with no usable history. */
const DEFAULT_BASELINE_KM = 15

/** Ceiling on the baseline, as a multiple of the runner's current average. */
const MAX_WEEK_MULTIPLE_OF_BASELINE = 1.5

export interface WeeklyTargetInputs {
  /** The runner's current rolling weekly average (km) */
  avgWeeklyKm: number
  /** Number of weeks in the block */
  blockWeeks: number
  sessionsPerWeek: number
  /** Longest single run in recent history (km) */
  longestRecentRun: number
  /** Requested progressive overload per build week (%) */
  increasePct: number
  athleteLevel: AthleteLevel
  acwr: AcwrSafety
  prolongedFatigue: ProlongedFatigueResult
  comeback: ComebackRecommendation
  /** Actual weekly km for the weeks immediately before the block, oldest first */
  priorWeeklyVolumes: number[]
}

export interface WeeklyTargetResult {
  /** One target per week, exactly `blockWeeks` long */
  targets: number[]
  /** Why the targets differ from the plain progression. For logging, not for the runner. */
  notes: string[]
}

/**
 * Smallest weekly volume that can still support the session-length rules:
 * a real long run plus the other sessions at minimum useful length.
 */
export function calcMinWeeklyKm(sessionsPerWeek: number, longestRecentRun: number): number {
  // Long run minimum: 8 km if the runner has ever run >= 6 km, otherwise gently above their longest
  const longRunMin = longestRecentRun >= 6 ? 8 : Math.max(longestRecentRun + 1, 5)
  return longRunMin + Math.max(0, sessionsPerWeek - 1) * 5
}

/**
 * The plain progression, before any safety reduction: start at the runner's
 * baseline, build by `pct` a week, close with a recovery week.
 *
 * Returns exactly `blockWeeks` entries. It used to return two for a one-week
 * block — the build loop was skipped but the recovery week was appended anyway,
 * so a race 10 days out produced a two-week plan the prompt then contradicted.
 */
export function calcWeekTargets(
  avgWeeklyKm: number,
  pct: number,
  blockWeeks: number,
  sessionsPerWeek: number,
  longestRecentRun: number,
): number[] {
  if (blockWeeks <= 0) return []

  const baseline = avgWeeklyKm > 0 ? avgWeeklyKm : DEFAULT_BASELINE_KM
  // Enforce a minimum weekly volume so the session length rules can be satisfied.
  // Without this, a 10 km week with 2 sessions can't support a >= 8 km long run
  // plus a >= 5 km base run.
  const base = Math.max(baseline, calcMinWeeklyKm(sessionsPerWeek, longestRecentRun))
  const maxWeeklyKm = Math.max(baseline, base) * MAX_WEEK_MULTIPLE_OF_BASELINE
  const multiplier = 1 + pct / 100

  let current = base
  const targets = [Math.round(current)]
  if (blockWeeks === 1) return targets

  for (let i = 1; i < blockWeeks - 1; i++) {
    current = Math.min(current * multiplier, maxWeeklyKm)
    targets.push(Math.round(current))
  }
  // Closing recovery week — floor so it rounds down, never up (12.58 -> 12).
  targets.push(Math.floor(current * RECOVERY_WEEK_FRACTION))
  return targets
}

/**
 * Builds the final weekly targets for a block: progression, then every safety
 * reduction, applied once and in an order where each step sees the result of
 * the last.
 */
export function computeWeeklyTargets(input: WeeklyTargetInputs): WeeklyTargetResult {
  const {
    avgWeeklyKm, blockWeeks, sessionsPerWeek, longestRecentRun, increasePct,
    athleteLevel, acwr, prolongedFatigue, comeback, priorWeeklyVolumes,
  } = input

  const notes: string[] = []
  const targets = calcWeekTargets(
    avgWeeklyKm, increasePct, blockWeeks, sessionsPerWeek, longestRecentRun,
  )
  if (targets.length === 0) return { targets, notes }

  // 1. Load and fatigue reductions — the strongest one applies, they do not stack.
  const reductionMultiplier = Math.min(acwr.weekOneMultiplier, prolongedFatigue.deloadMultiplier)
  if (reductionMultiplier < 1) {
    const reduction = 1 - reductionMultiplier
    for (let i = 0; i < Math.min(REDUCTION_GRADUATION.length, targets.length); i++) {
      targets[i] = Math.round(targets[i] * (1 - reduction * REDUCTION_GRADUATION[i]))
    }
    if (acwr.message) notes.push(acwr.message)
    if (prolongedFatigue.message) notes.push(prolongedFatigue.message)
  }

  // 2. Comeback cap. Before the progression clamps, so weeks 2+ progress from
  //    the capped week 1 rather than being clamped against a target that is
  //    about to be lowered underneath them.
  if (comeback.needsRamp && targets[0] > comeback.weekOneKm) {
    notes.push(
      `Comeback cap: week 1 ${targets[0]} km -> ${comeback.weekOneKm} km ` +
      `(${comeback.category}, ${comeback.pauseDays}-day pause)`,
    )
    targets[0] = comeback.weekOneKm
  }

  // 3. Progression caps: week-over-week, and cumulative over a three-week window
  //    measured against real pre-block volume so the opening weeks can't quietly
  //    out-run what the runner has actually been doing.
  //
  //    Applied as a fixed point rather than a single pass. Lowering week 2 changes
  //    what week 3 is allowed to be, so evaluating every week against the original
  //    targets lets later weeks keep a jump that is no longer legal — which is how
  //    a 10%-requested block came out with a 20% step in it.
  const beforeClamp = [...targets]
  const maxIncrease = MAX_WEEKLY_INCREASE[athleteLevel]

  for (let pass = 0; pass < 5; pass++) {
    let changed = false

    for (let i = 1; i < targets.length; i++) {
      const prev = targets[i - 1]
      // A deliberate step down is a recovery week, not a violation.
      if (targets[i] < prev * RECOVERY_WEEK_THRESHOLD) continue
      const maxAllowed = Math.round(prev * (1 + maxIncrease))
      if (targets[i] > maxAllowed) {
        targets[i] = maxAllowed
        changed = true
      }
    }

    for (const v of checkCumulativeProgression(targets, athleteLevel, priorWeeklyVolumes)) {
      const idx = v.weekNumber - 1
      if (idx >= 0 && idx < targets.length && targets[idx] > v.adjustedKm) {
        targets[idx] = v.adjustedKm
        changed = true
      }
    }

    if (!changed) break
  }

  for (let i = 0; i < targets.length; i++) {
    if (targets[i] !== beforeClamp[i]) {
      notes.push(
        `Week ${i + 1}: ${beforeClamp[i]} -> ${targets[i]} km (progression caps, ${athleteLevel})`,
      )
    }
  }

  // 5. Keep the closing week a recovery week after all the clamping above.
  const last = targets.length - 1
  if (last >= 1) {
    const cap = Math.floor(targets[last - 1] * RECOVERY_WEEK_FRACTION)
    if (targets[last] > cap) {
      notes.push(`Week ${last + 1}: ${targets[last]} -> ${cap} km (closing recovery week)`)
      targets[last] = cap
    }
  }

  return { targets: targets.map((t) => Math.max(0, t)), notes }
}
