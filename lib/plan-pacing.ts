/**
 * Writing the pace targets onto a plan's sessions.
 *
 * The zone-to-pace arithmetic lives in lib/pace-guide.ts. What lives here is
 * the part that depends on where a session sits in the block: a hard session
 * in week 4 is prescribed faster than the same session in week 1, a week that
 * drops in volume is run easier throughout, and a fatigued runner is pulled
 * back off the quality paces entirely.
 *
 * Generation and read-time re-pacing used to each carry their own copy of this
 * loop, and they had already drifted — the read-time copy skipped any session
 * that already had a pace, which is right when it is filling in blanks and
 * wrong when it is correcting them. One function, two callers.
 *
 * Pure and deterministic given its inputs, so it is safe on both sides.
 */

import {
  PACE_ASSIGNMENT_VERSION,
  assignSessionPace,
  stripPaceFigures,
  type PaceGuide,
} from "@/lib/pace-guide"
import {
  PACE_PROGRESSION_RATES,
  PACE_PROGRESSION_MAX_WEEKS,
  RECOVERY_WEEK_THRESHOLD,
} from "@/lib/training-constants"
import type { AthleteLevel } from "@/lib/training-safety-client"
import type { TrainingPlan } from "@/lib/types"

export type FatigueSignal = "none" | "hr_elevated" | "pace_declining" | "both"

export interface PacingContext {
  /** From detectFatigue(). Pulls the quality paces back when the runner is cooked. */
  fatigueSignal: FatigueSignal
  /** From classifyAthleteLevel(). Sets how fast the quality paces sharpen across a block. */
  athleteLevel: AthleteLevel
}

/** Every session run this much slower during a recovery week. */
const RECOVERY_WEEK_MODIFIER = 1.1

const FATIGUE_MODIFIERS: Record<FatigueSignal, number> = {
  both: 1.12, // HR and pace both declining
  pace_declining: 1.08,
  hr_elevated: 1.05,
  none: 1.0,
}

/**
 * Which sessions the progression and fatigue modifiers apply to.
 *
 * Fartlek is in here even though its pace now comes from the tempo zone: the
 * question this answers is "is this a quality session", not "which zone is
 * it", and a fatigued runner should be eased off the surges too.
 */
const HARD_SESSION_RE = /tempo|threshold|interval|track|speed|fartlek|repeat|vo2|race.?pace/i

/**
 * Assigns every session in the plan a pace, replacing whatever was there.
 *
 * Also takes the model's pace figures out of the effort and purpose lines.
 * Those are prose, so they are not corrected by re-pacing — they just sit
 * there contradicting the number beside them, which is how a long run came to
 * read "roughly 7:15–7:45/km" with "6:00–6:15 /km" printed alongside it.
 *
 * Returns a new plan; the input is not touched.
 */
export function applySessionPaces(
  plan: TrainingPlan,
  guide: PaceGuide,
  { fatigueSignal, athleteLevel }: PacingContext,
): TrainingPlan {
  const progressionRate = PACE_PROGRESSION_RATES[athleteLevel] ?? PACE_PROGRESSION_RATES.intermediate
  const fatigueModifier = FATIGUE_MODIFIERS[fatigueSignal] ?? 1.0

  return {
    ...plan,
    paceSource: guide.source,
    paceVersion: PACE_ASSIGNMENT_VERSION,
    weeks: plan.weeks.map((week, weekIdx) => {
      const prevWeek = plan.weeks[weekIdx - 1] ?? null
      const isRecoveryWeek =
        prevWeek != null && week.targetKm < prevWeek.targetKm * RECOVERY_WEEK_THRESHOLD

      // Quality paces sharpen across the block, at a rate set by how much
      // training the runner has behind them.
      const weekIndex = Math.min(Math.max(week.weekNumber - 1, 0), PACE_PROGRESSION_MAX_WEEKS - 1)
      const progressionModifier = 1.0 - weekIndex * progressionRate

      return {
        ...week,
        sessions: week.sessions.map((session) => {
          const isHard = HARD_SESSION_RE.test(session.type)
          const modifier = isRecoveryWeek
            ? RECOVERY_WEEK_MODIFIER
            : isHard
              ? fatigueSignal !== "none"
                ? fatigueModifier
                : progressionModifier
              : 1.0

          const pace = assignSessionPace(session.type, guide, modifier)

          // Assigned by key rather than spread-and-overwrite, so a session
          // whose zone no longer carries a pace — hill repeats — loses the one
          // it was given under the old rules instead of keeping it.
          return {
            type: session.type,
            distance: session.distance,
            effort: stripPaceFigures(session.effort),
            purpose: stripPaceFigures(session.purpose),
            ...(pace ? { suggestedPace: pace } : {}),
          }
        }),
      }
    }),
  }
}
