/**
 * The one line of the training plan that belongs on Today.
 *
 * Today is the screen a runner opens before going out, and until now the plan
 * was not on it at all — the whole block lived two taps away behind a goal,
 * and only arrived after the screen it lives on had fetched it. So the runner
 * deciding what to do this morning had to go and look it up.
 *
 * What goes on Today is deliberately one session and a count, not the week.
 * The week is a reference and it already has a screen; the decision is "what
 * am I doing now", and that is one line.
 *
 * A note on which session that is. The plan has no weekdays in it — a week is
 * a set of sessions and a volume, and the runner arranges them around their
 * own life. So there is no "today's session" to look up, and inventing one by
 * dealing the sessions out across the week would be the app making up a
 * commitment the plan never asked for. What can honestly be said is what is
 * still outstanding, and the next one of those is what this surfaces.
 */

import { matchSessionsToActivities } from "@/lib/plan-session-match"
import type { PlanSessionStatus, TrainingPlan, TrainingSession, TrainingWeek } from "@/lib/types"

/** Monday of the week `date` falls in, at local midnight. */
export function startOfWeek(date: Date): Date {
  const monday = new Date(date)
  monday.setHours(0, 0, 0, 0)
  const day = monday.getDay() // 0 = Sunday
  monday.setDate(monday.getDate() + (day === 0 ? -6 : 1 - day))
  return monday
}

/** The key a session's status is stored under, in `session_completions`. */
export function sessionKey(weekNumber: number, sessionIndex: number): string {
  return `W${weekNumber}-${sessionIndex}`
}

/**
 * The calendar week a plan week occupies. Blocks are snapped to Monday so a
 * plan week and a runner's week are the same seven days.
 */
export function planWeekWindow(
  blockStartDate: string,
  weekIndex: number,
): { start: Date; end: Date } {
  const start = startOfWeek(new Date(blockStartDate))
  start.setDate(start.getDate() + weekIndex * 7)
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  return { start, end }
}

export interface PlanWeekRow {
  goal_id: string
  block_start_date: string
  plan: unknown
}

/**
 * A plan's current week, trimmed to what Today shows.
 *
 * Trimmed on the server on purpose: the full plan JSON is kilobytes per goal,
 * and shipping all of it to render one session is what kept it off Today in
 * the first place.
 */
export interface CurrentPlanWeek {
  goalId: string
  weekNumber: number
  theme: string
  targetKm: number
  /** Local midnight Monday, as an ISO instant so it survives the server boundary. */
  weekStart: string
  sessions: TrainingSession[]
}

/**
 * The week each goal's plan is in right now, keyed by goal id.
 *
 * Goals whose block has not started, or has already run out, are left out —
 * there is nothing to run today under a block that ended last month, and the
 * "regenerate" prompt for that already lives on the goal card.
 */
export function deriveCurrentPlanWeeks(
  rows: PlanWeekRow[],
  now: Date = new Date(),
): Record<string, CurrentPlanWeek> {
  const current: Record<string, CurrentPlanWeek> = {}

  for (const row of rows) {
    const weeks = (row.plan as TrainingPlan | null)?.weeks
    if (!Array.isArray(weeks) || weeks.length === 0) continue

    const blockStart = startOfWeek(new Date(row.block_start_date))
    if (Number.isNaN(blockStart.getTime())) continue

    const thisMonday = startOfWeek(now)
    const weekIndex = Math.round(
      (thisMonday.getTime() - blockStart.getTime()) / (7 * 24 * 60 * 60 * 1000),
    )
    if (weekIndex < 0 || weekIndex >= weeks.length) continue

    const week = weeks[weekIndex] as TrainingWeek
    current[row.goal_id] = {
      goalId: row.goal_id,
      weekNumber: week.weekNumber,
      theme: week.theme,
      targetKm: week.targetKm,
      weekStart: planWeekWindow(row.block_start_date, weekIndex).start.toISOString(),
      sessions: week.sessions,
    }
  }

  return current
}

export interface PlanWeekProgress {
  done: number
  skipped: number
  total: number
  /** The first session still outstanding, or null when the week is accounted for. */
  next: TrainingSession | null
  statuses: PlanSessionStatus[]
}

/**
 * "Planned" is not one of the runner's answers — it is the absence of one.
 *
 * The two real answers are "I did this" and "I am not doing this". Wanting a
 * session back on automatic is the third thing the control can express, and it
 * is spelled by having nothing stored. Treating a stored "planned" as an answer
 * pins the session open: a run that genuinely matches it can never tick it off
 * again, and the runner has no way to undo that from the screen, because the
 * control cycles back to the very value causing it.
 *
 * Rows like that already exist, written by the cycle before it knew better, so
 * this is read defensively rather than only fixed at the point of writing. The
 * plan-regeneration migration has always taken this view — it skips "planned"
 * when carrying completions across, calling it "default state".
 */
export function isManualAnswer(status: PlanSessionStatus | undefined): boolean {
  return status === "completed" || status === "skipped"
}

/**
 * How far into its week a plan is, and what is left.
 *
 * @param manualStatuses  The runner's own answers, keyed `W3-1`. A "completed"
 *                        or "skipped" here wins over what the activities imply
 *                        — a session they ticked off is done even if nothing in
 *                        Strava looks like it. A stored "planned" is ignored;
 *                        see isManualAnswer.
 */
export function summarisePlanWeek(
  week: CurrentPlanWeek,
  weekActivities: { distance_km: number; pace_min_per_km?: number | null; duration_seconds?: number | null }[],
  manualStatuses: Record<string, PlanSessionStatus> = {},
): PlanWeekProgress {
  const matched = matchSessionsToActivities(week.sessions, weekActivities)

  const statuses = week.sessions.map<PlanSessionStatus>((_, i) => {
    const manual = manualStatuses[sessionKey(week.weekNumber, i)]
    if (isManualAnswer(manual)) return manual as PlanSessionStatus
    return matched[i] ? "completed" : "planned"
  })

  const nextIndex = statuses.findIndex((s) => s === "planned")

  return {
    done: statuses.filter((s) => s === "completed").length,
    skipped: statuses.filter((s) => s === "skipped").length,
    total: statuses.length,
    next: nextIndex === -1 ? null : week.sessions[nextIndex],
    statuses,
  }
}

/** The activities that fall inside a plan week, from the whole list. */
export function activitiesInPlanWeek<T extends { date: string }>(
  activities: T[],
  weekStart: string,
): T[] {
  const start = new Date(weekStart)
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  return activities.filter((a) => {
    const d = new Date(a.date)
    return d >= start && d < end
  })
}
