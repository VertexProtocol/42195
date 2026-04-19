/**
 * Comeback volume calculator.
 *
 * After a training pause (7+ days without a logged run), recommends a
 * conservative week-one volume for the first week back. The recommendation
 * combines three signals:
 *
 *   1. Pause length — a lookup table of empirically-supported reduction
 *      percentages applied to the runner's pre-pause weekly average.
 *   2. Active injury — if the most recent injury note is unresolved, apply
 *      a further 20% cut on top of the table percent.
 *   3. ACWR cap — never let the recommended week-one load drive the
 *      acute:chronic workload ratio above 1.3 (the elevated-risk threshold).
 *      Only applied when the chronic load is still meaningful (pause ≤ 28 d);
 *      for longer pauses the chronic load has decayed to near zero and the
 *      table percentages alone provide the ramp.
 *
 * The function is pure: no activity aggregation, no date math on raw
 * activities. Callers pass in pre-computed numbers; helpers in this module
 * (daysSinceLastActivity, averageWeeklyKmBeforePause) compute the common
 * inputs from a plain activity list.
 */

import {
  ACWR_HIGH_THRESHOLD,
  ACWR_CHRONIC_DAYS,
  COMEBACK_PAUSE_THRESHOLD_DAYS,
  COMEBACK_INJURY_REDUCTION,
  COMEBACK_PREPAUSE_WINDOW_WEEKS,
  COMEBACK_FLOOR_KM,
} from "@/lib/training-constants"

export type ComebackCategory =
  | "none"      // no meaningful pause, plan as usual
  | "short"     // 7–10 days
  | "moderate"  // 11–14 days
  | "long"      // 15–21 days
  | "extended"  // 22–28 days
  | "rebuild"   // > 28 days — treat as base rebuild

export type ComebackLimitingFactor =
  | "table"    // the pause-length table was the binding factor
  | "acwr"     // ACWR cap lowered the recommendation below the table
  | "injury"   // active-injury reduction brought week-one down further
  | "floor"    // the floor kicked in (very rare, only with tiny history)
  | null       // no ramp needed

export interface ComebackRecommendation {
  needsRamp: boolean
  pauseDays: number
  category: ComebackCategory
  /** Recommended total km for the first week back, rounded to nearest km */
  weekOneKm: number
  /** Raw table percentage applied to pre-pause weekly average */
  tablePercent: number
  limitingFactor: ComebackLimitingFactor
}

interface TableEntry {
  minDays: number
  maxDays: number
  pct: number
  category: ComebackCategory
}

const COMEBACK_TABLE: TableEntry[] = [
  { minDays: 0, maxDays: 6, pct: 1.0, category: "none" },
  { minDays: 7, maxDays: 10, pct: 0.80, category: "short" },
  { minDays: 11, maxDays: 14, pct: 0.65, category: "moderate" },
  { minDays: 15, maxDays: 21, pct: 0.50, category: "long" },
  { minDays: 22, maxDays: 28, pct: 0.40, category: "extended" },
  { minDays: 29, maxDays: Infinity, pct: 0.35, category: "rebuild" },
]

/**
 * Pure calculation — given pause length and baseline load, return the
 * recommended week-one volume plus the reasoning.
 *
 * @param pauseDays           Full days since last logged run
 * @param prePauseWeeklyKm    Average weekly km across the window before the pause started
 * @param chronicLoadWeeklyKm 28-day chronic load expressed as km/week (total 28d km ÷ 4)
 * @param hasActiveInjury     True if notes_history has an unresolved injury entry
 */
export function calculateComebackVolume(
  pauseDays: number,
  prePauseWeeklyKm: number,
  chronicLoadWeeklyKm: number,
  hasActiveInjury: boolean,
): ComebackRecommendation {
  const safePauseDays = Math.max(0, Math.floor(pauseDays))
  const entry =
    COMEBACK_TABLE.find((e) => safePauseDays >= e.minDays && safePauseDays <= e.maxDays) ??
    COMEBACK_TABLE[COMEBACK_TABLE.length - 1]

  if (safePauseDays < COMEBACK_PAUSE_THRESHOLD_DAYS) {
    return {
      needsRamp: false,
      pauseDays: safePauseDays,
      category: "none",
      weekOneKm: Math.round(prePauseWeeklyKm),
      tablePercent: 1.0,
      limitingFactor: null,
    }
  }

  let pct = entry.pct
  let limitingFactor: ComebackLimitingFactor = "table"

  if (hasActiveInjury) {
    pct *= COMEBACK_INJURY_REDUCTION
    limitingFactor = "injury"
  }

  let km = pct * prePauseWeeklyKm

  // ACWR guard — only while chronic load is still meaningful. Beyond 28 days
  // chronic load has decayed toward zero and the guard would always bind,
  // which is wrong: we already cut hard via the rebuild table percent.
  if (chronicLoadWeeklyKm > 0 && safePauseDays <= ACWR_CHRONIC_DAYS) {
    const acwrCap = ACWR_HIGH_THRESHOLD * chronicLoadWeeklyKm
    if (acwrCap < km) {
      km = acwrCap
      limitingFactor = "acwr"
    }
  }

  if (km < COMEBACK_FLOOR_KM) {
    km = COMEBACK_FLOOR_KM
    limitingFactor = "floor"
  }

  return {
    needsRamp: true,
    pauseDays: safePauseDays,
    category: entry.category,
    weekOneKm: Math.round(km),
    tablePercent: entry.pct,
    limitingFactor,
  }
}

/**
 * Whole days between the runner's most recent run and the reference date.
 * Returns Infinity when there are no activities at all (first-time user).
 */
export function daysSinceLastActivity(
  activities: Array<{ date: string }>,
  referenceDate: Date = new Date(),
): number {
  if (activities.length === 0) return Infinity
  let latestMs = -Infinity
  for (const a of activities) {
    const t = new Date(a.date).getTime()
    if (t > latestMs) latestMs = t
  }
  const diffMs = referenceDate.getTime() - latestMs
  if (diffMs <= 0) return 0
  return Math.floor(diffMs / (24 * 60 * 60 * 1000))
}

/**
 * Average weekly km across the `windowWeeks` weeks ending the day before the
 * pause began (i.e. the runner's typical weekly volume before they stopped).
 *
 * If the runner has less than `windowWeeks` weeks of history, the window is
 * clipped — returned value is still an average per week (total ÷ weeks), not
 * a sum, so short histories aren't under-reported.
 */
export function averageWeeklyKmBeforePause(
  activities: Array<{ date: string; distance_km: number }>,
  pauseDays: number,
  windowWeeks: number = COMEBACK_PREPAUSE_WINDOW_WEEKS,
  referenceDate: Date = new Date(),
): number {
  if (windowWeeks <= 0) return 0
  const dayMs = 24 * 60 * 60 * 1000
  const pauseStartMs = referenceDate.getTime() - Math.max(0, pauseDays) * dayMs
  const windowStartMs = pauseStartMs - windowWeeks * 7 * dayMs

  const totalKm = activities
    .filter((a) => {
      const t = new Date(a.date).getTime()
      return t >= windowStartMs && t < pauseStartMs
    })
    .reduce((s, a) => s + Number(a.distance_km), 0)

  return totalKm / windowWeeks
}

/**
 * Total km from activities in the last 28 days (chronic window), expressed
 * as km-per-week (total ÷ 4). Used as the denominator in the ACWR cap.
 */
export function chronicLoadWeeklyKm(
  activities: Array<{ date: string; distance_km: number }>,
  referenceDate: Date = new Date(),
): number {
  const dayMs = 24 * 60 * 60 * 1000
  const cutoffMs = referenceDate.getTime() - ACWR_CHRONIC_DAYS * dayMs
  const total = activities
    .filter((a) => new Date(a.date).getTime() >= cutoffMs)
    .reduce((s, a) => s + Number(a.distance_km), 0)
  return total / (ACWR_CHRONIC_DAYS / 7)
}

/**
 * High-level convenience: runs all three helpers and returns the
 * recommendation. Use this from plan generation / checkpoint code.
 */
export function assessComeback(
  activities: Array<{ date: string; distance_km: number }>,
  hasActiveInjury: boolean,
  referenceDate: Date = new Date(),
): ComebackRecommendation {
  const pauseDays = daysSinceLastActivity(activities, referenceDate)
  const prePauseWeekly = Number.isFinite(pauseDays)
    ? averageWeeklyKmBeforePause(
        activities,
        pauseDays,
        COMEBACK_PREPAUSE_WINDOW_WEEKS,
        referenceDate,
      )
    : 0
  const chronicWeekly = chronicLoadWeeklyKm(activities, referenceDate)
  const finitePauseDays = Number.isFinite(pauseDays) ? pauseDays : 365
  return calculateComebackVolume(
    finitePauseDays,
    prePauseWeekly,
    chronicWeekly,
    hasActiveInjury,
  )
}
