/**
 * The training week, in one place.
 *
 * A week runs Monday 00:00 to the following Monday 00:00, in the runner's own
 * time. That sounds like one line of code, and it was — written four times,
 * with three different answers. `goals-screen.tsx`, `weekly-goal-editor.tsx`
 * and `training-timeline.ts` each had a local-time copy; `lib/format.ts`
 * parsed a `YYYY-MM-DD` week start with `new Date(...)`, which reads it as UTC
 * midnight and shifts the whole window by the runner's offset; and
 * `lib/strava-sync.ts` computes the week in UTC on purpose.
 *
 * That last one is a real disagreement rather than an oversight — the server
 * does not know the runner's timezone — and it is left alone here. See step 4
 * of WEEKLY_GOALS_PLAN.md. Everything running in the runner's own context uses
 * this module, so the client at least agrees with itself.
 *
 * Two representations, deliberately:
 *   - a `Date` at local midnight, for arithmetic
 *   - a `YYYY-MM-DD` string, for `weekly_goals.week_start` and for React keys
 *
 * The string is built from local parts, never from `toISOString()` — that
 * converts to UTC and hands a runner east of Greenwich the previous day.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** Monday of the week `date` falls in, at local midnight. */
export function mondayOf(date: Date): Date {
  const monday = new Date(date)
  monday.setHours(0, 0, 0, 0)
  const day = monday.getDay()
  monday.setDate(monday.getDate() + (day === 0 ? -6 : 1 - day))
  return monday
}

/** `YYYY-MM-DD` for a date, from its local parts. */
export function toDateStr(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
}

/** `YYYY-MM-DD` of the Monday of the week `date` falls in. */
export function weekStartStr(date: Date = new Date()): string {
  return toDateStr(mondayOf(date))
}

/**
 * A stored `week_start` back as a local-midnight Date.
 *
 * Tolerates a full ISO timestamp as well as a date-only string, because
 * `goals.start_date` and `goals.target_date` are date columns that arrive as
 * either depending on the client that wrote them.
 */
export function parseWeekStart(weekStart: string): Date {
  const [y, m, d] = weekStart.slice(0, 10).split("-").map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

/** The `[start, end)` bounds of a stored week, in local time. */
export function weekRange(weekStart: string): { start: Date; end: Date } {
  const start = parseWeekStart(weekStart)
  const end = new Date(start)
  // Add days rather than 7 × 24h: across a DST boundary one of those weeks is
  // 23 or 25 hours long, and a fixed millisecond offset lands an hour into
  // Sunday or an hour into the next Monday.
  end.setDate(end.getDate() + 7)
  return { start, end }
}

/** A week start moved `delta` weeks, as a `YYYY-MM-DD` string. */
export function shiftWeekStr(weekStart: string, delta: number): string {
  const d = parseWeekStart(weekStart)
  d.setDate(d.getDate() + delta * 7)
  return toDateStr(d)
}

/**
 * How many whole weeks separate two week starts — `weeksBetweenStarts(a, b)`
 * is the index of week `b` in a block beginning at `a`. Negative before it.
 *
 * Rounded, not floored: the two arguments are both local midnights, so a DST
 * change inside the span leaves the difference an hour short of a whole
 * number of weeks and a floor would report the week before.
 */
export function weeksBetweenStarts(from: Date, to: Date): number {
  return Math.round((mondayOf(to).getTime() - mondayOf(from).getTime()) / (7 * DAY_MS))
}
