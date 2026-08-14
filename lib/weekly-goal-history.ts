/**
 * What a recurring weekly target was, in the week it was being worked to.
 *
 * A recurring goal is one row that applies to many weeks, so its `target` is
 * the number it holds *now*. Changing 40 km to 50 used to change it in every
 * week behind the runner too: a month they finished on 42 km flipped from
 * comfortably over to eight short, against a target that did not exist while
 * they were running it.
 *
 * The obvious fix is to write a row per week and stop deriving anything. That
 * needs something to write those rows every Monday, and this app has no
 * scheduler (`vercel.json` has no cron); doing it lazily on the week's first
 * visit leaves a hole in any week the runner did not open the app. Neither is
 * necessary. The row does not need to be duplicated — it needs to say *when*
 * each number started applying, which is one array and no new writer.
 *
 * `target_history` holds the periods that have closed. The current `target`
 * covers everything after the last of them, so the common case — a goal whose
 * number has never changed — carries an empty array and reads exactly as it
 * did before.
 *
 * Follows `lib/notes-history.ts`, which versions goal preference notes the
 * same way on a neighbouring table.
 */

import type { WeeklyGoal } from "@/lib/types"

/**
 * One superseded value, covering the weeks `from <= week < until`.
 *
 * Both bounds are Mondays as `YYYY-MM-DD`, which compare correctly as strings.
 * Half-open so that the week a change was made in belongs to the new number
 * and to nothing else — a runner who raises their target on Wednesday is
 * telling the app about the week they are in.
 */
export interface WeeklyTargetRevision {
  from: string
  until: string
  target: number
}

/** Read a stored history defensively — it is jsonb, and may be anything. */
export function parseTargetHistory(value: unknown): WeeklyTargetRevision[] {
  if (!Array.isArray(value)) return []

  const out: WeeklyTargetRevision[] = []
  for (const raw of value) {
    const entry = raw as Partial<WeeklyTargetRevision> | null
    if (!entry) continue
    const { from, until, target } = entry
    if (typeof from !== "string" || typeof until !== "string") continue
    if (typeof target !== "number" || !Number.isFinite(target)) continue
    // A period that ends before it starts describes no weeks at all.
    if (until <= from) continue
    out.push({ from, until, target })
  }

  return out.sort((a, b) => a.from.localeCompare(b.from))
}

/**
 * The target this goal held in the week beginning `weekStart`.
 *
 * Falls through to the goal's current `target` for any week no closed period
 * covers, which is every week from the last change onwards — and every week
 * at all for a goal whose number has never moved.
 */
export function targetForWeek(goal: WeeklyGoal, weekStart: string): number {
  if (!goal.is_recurring) return goal.target

  for (const period of parseTargetHistory(goal.target_history)) {
    if (weekStart >= period.from && weekStart < period.until) return period.target
  }

  return goal.target
}

/**
 * The history to store when a recurring target changes in `currentWeekStart`.
 *
 * Closes the outgoing number's period and leaves the incoming one to the
 * `target` column. The period opens where the previous one ended, or at the
 * week the goal was created if this is the first change — that is the whole
 * span the old number was in force for.
 *
 * Returns the history unchanged when there is nothing to record: the target
 * did not move, the goal does not recur, or the runner has already changed it
 * this week and the outgoing value never governed a week at all.
 */
export function recordTargetChange(
  goal: WeeklyGoal,
  newTarget: number,
  currentWeekStart: string,
): WeeklyTargetRevision[] {
  const history = parseTargetHistory(goal.target_history)

  if (!goal.is_recurring) return history
  if (newTarget === goal.target) return history

  const openedAt = history.length > 0 ? history[history.length - 1].until : goal.week_start

  // Two edits in the same week. The first number was never what the runner was
  // working to for a whole week, so it leaves no period behind — the one they
  // settle on is the one that governs the week.
  if (currentWeekStart <= openedAt) return history

  return [...history, { from: openedAt, until: currentWeekStart, target: goal.target }]
}
