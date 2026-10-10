/**
 * Streaks and badges — the small rewards for showing up.
 *
 * Everything here is derived from rows the app already has: the activity log
 * and the weekly goals. Nothing is stored, so a streak can never drift out of
 * step with the runs it counts, and deleting a run takes its badge with it.
 *
 * A week counts toward the streak when every weekly goal that applied to it was
 * met, against the target it held that week. A runner with no weekly goals at
 * all still gets a streak: for them a week counts when it has at least one run.
 *
 * The week in progress never breaks a streak — it is not over yet. It only adds
 * to it, once it has been won.
 */

import type { Activity, WeeklyGoal } from "@/lib/types"
import { isRunActivity } from "@/lib/format"
import { weekStartStr, shiftWeekStr } from "@/lib/week"
import { targetForWeek } from "@/lib/weekly-goal-history"

/** The activities of each week, keyed by that week's Monday. */
function bucketByWeek(activities: Activity[]): Map<string, Activity[]> {
  const weeks = new Map<string, Activity[]>()
  for (const a of activities) {
    const key = weekStartStr(new Date(a.date))
    const list = weeks.get(key)
    if (list) list.push(a)
    else weeks.set(key, [a])
  }
  return weeks
}

function progressIn(week: Activity[], goal: WeeklyGoal): number {
  switch (goal.metric) {
    case "distance_km":
      return week.reduce((s, a) => s + a.distance_km, 0)
    case "duration_minutes":
      return week.reduce((s, a) => s + a.duration_seconds / 60, 0)
    case "elevation_m":
      return week.reduce((s, a) => s + (a.elevation_gain_m ?? 0), 0)
    case "sessions":
      return week.filter((a) => {
        if (goal.session_min_duration_minutes && a.duration_seconds / 60 < goal.session_min_duration_minutes)
          return false
        if (goal.session_min_distance_km && a.distance_km < goal.session_min_distance_km) return false
        return true
      }).length
    default:
      return 0
  }
}

/** The weekly goals that applied to the week beginning `weekStart`. */
export function goalsForWeek(goals: WeeklyGoal[], weekStart: string): WeeklyGoal[] {
  return goals.filter((g) => {
    const from = g.week_start.slice(0, 10)
    return g.is_recurring ? from <= weekStart : from === weekStart
  })
}

/**
 * Whether a week was won. Null when the week had no goals to win, which
 * neither extends nor breaks a goal-based streak on its own — see below.
 */
function weekWon(
  week: Activity[],
  goals: WeeklyGoal[],
  weekStart: string,
  useGoals: boolean,
): boolean | null {
  if (!useGoals) return week.some((a) => isRunActivity(a.type))
  const applicable = goalsForWeek(goals, weekStart)
  if (applicable.length === 0) return null
  return applicable.every((g) => progressIn(week, g) >= targetForWeek(g, weekStart))
}

export interface StreakSummary {
  /** Weeks in a row up to now, the current week included once it is won. */
  current: number
  /** The longest run of won weeks in the whole history. */
  best: number
  /** Whether this week has already been won. */
  thisWeekWon: boolean
}

export function computeStreak(
  activities: Activity[],
  weeklyGoals: WeeklyGoal[],
  now: Date = new Date(),
): StreakSummary {
  const useGoals = weeklyGoals.length > 0
  const weeks = bucketByWeek(activities)
  const thisWeek = weekStartStr(now)

  const thisWeekWon = weekWon(weeks.get(thisWeek) ?? [], weeklyGoals, thisWeek, useGoals) === true

  // Walk back from last week. A week with no goals applying (before the
  // runner set any up) ends the walk rather than counting as a loss.
  let current = thisWeekWon ? 1 : 0
  let cursor = shiftWeekStr(thisWeek, -1)
  for (let i = 0; i < 520; i++) {
    const won = weekWon(weeks.get(cursor) ?? [], weeklyGoals, cursor, useGoals)
    if (won !== true) break
    current++
    cursor = shiftWeekStr(cursor, -1)
  }

  // Best: every week from the earliest one with anything in it, forward.
  let best = current
  const starts = [...weeks.keys(), ...weeklyGoals.map((g) => g.week_start.slice(0, 10))].sort()
  if (starts.length > 0) {
    let run = 0
    let week = weekStartStr(new Date(`${starts[0]}T12:00:00`))
    for (let i = 0; i < 1040 && week <= thisWeek; i++) {
      const won = weekWon(weeks.get(week) ?? [], weeklyGoals, week, useGoals)
      if (won === true) {
        run++
        if (run > best) best = run
      } else if (week !== thisWeek) {
        run = 0
      }
      week = shiftWeekStr(week, 1)
    }
  }

  return { current, best, thisWeekWon }
}

export type BadgeId =
  | "first_run"
  | "km_5"
  | "km_10"
  | "half"
  | "marathon"
  | "total_100"
  | "total_500"
  | "total_1000"
  | "streak_4"
  | "streak_12"

export interface Badge {
  id: BadgeId
  earned: boolean
}

export const BADGE_ORDER: BadgeId[] = [
  "first_run",
  "km_5",
  "km_10",
  "half",
  "marathon",
  "total_100",
  "total_500",
  "total_1000",
  "streak_4",
  "streak_12",
]

/** Every badge, earned or not, in the order they are usually reached. */
export function computeBadges(activities: Activity[], streak: StreakSummary): Badge[] {
  const runs = activities.filter((a) => isRunActivity(a.type))
  const longest = runs.reduce((m, a) => Math.max(m, a.distance_km), 0)
  const total = runs.reduce((s, a) => s + a.distance_km, 0)

  const earned: Record<BadgeId, boolean> = {
    first_run: runs.length > 0,
    // A little slack, because a GPS 5K rarely reads exactly 5.00.
    km_5: longest >= 4.95,
    km_10: longest >= 9.9,
    half: longest >= 21.0,
    marathon: longest >= 42.0,
    total_100: total >= 100,
    total_500: total >= 500,
    total_1000: total >= 1000,
    streak_4: streak.best >= 4,
    streak_12: streak.best >= 12,
  }

  return BADGE_ORDER.map((id) => ({ id, earned: earned[id] }))
}
