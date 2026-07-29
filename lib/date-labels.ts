import type { Locale } from "@/lib/i18n"

/**
 * Human date labels for the training log.
 *
 * A log reads as a diary, not a database: "Yesterday" and "Tuesday" place a
 * run in your week instantly, where "Jul 28" makes you do the arithmetic.
 * Anything older than a week falls back to a date, because by then the
 * weekday has stopped being a useful anchor.
 *
 * Timezone note
 * ─────────────
 * Rows arrive as either a date-only string ("2026-07-28") or a full ISO
 * timestamp. `new Date("2026-07-28")` parses as UTC midnight, which renders
 * as the 27th anywhere west of Greenwich. Every function here normalises to
 * local noon first — the same guard `isDatePast` in lib/format.ts uses —
 * so a run never drifts a day depending on where you open the app.
 */

const INTL_LOCALE: Record<Locale, string> = {
  en: "en-US",
  no: "nb-NO",
}

/** Parse to local noon so a date-only string cannot slip across a day boundary. */
export function toLocalDate(dateStr: string): Date {
  const datePart = dateStr.split("T")[0]
  return new Date(`${datePart}T12:00:00`)
}

function startOfDay(d: Date): Date {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}

/** Whole calendar days from `dateStr` to today. Positive = in the past. */
export function daysAgo(dateStr: string, now: Date = new Date()): number {
  const then = startOfDay(toLocalDate(dateStr))
  const today = startOfDay(now)
  return Math.round((today.getTime() - then.getTime()) / 86_400_000)
}

/**
 * "Today" · "Yesterday" · "Tuesday" (within the last week) · "28 Jul".
 * Future dates fall through to the weekday/date forms too, so a planned
 * session reads the same way a logged one does.
 */
export function relativeDayLabel(
  dateStr: string,
  locale: Locale,
  now: Date = new Date(),
): string {
  const diff = daysAgo(dateStr, now)
  const date = toLocalDate(dateStr)
  const intl = INTL_LOCALE[locale]

  if (diff === 0) return locale === "no" ? "I dag" : "Today"
  if (diff === 1) return locale === "no" ? "I går" : "Yesterday"
  if (diff === -1) return locale === "no" ? "I morgen" : "Tomorrow"

  if (diff > 1 && diff < 7) {
    const weekday = date.toLocaleDateString(intl, { weekday: "long" })
    // nb-NO returns lowercase weekdays, which is correct Norwegian but looks
    // unintentional at the start of a row. Capitalise the first letter only.
    return weekday.charAt(0).toUpperCase() + weekday.slice(1)
  }

  return date.toLocaleDateString(intl, { day: "numeric", month: "short" })
}

/** "July 2026" / "juli 2026" — the heading for a month group in a long list. */
export function monthLabel(dateStr: string, locale: Locale): string {
  const label = toLocalDate(dateStr).toLocaleDateString(INTL_LOCALE[locale], {
    month: "long",
    year: "numeric",
  })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** Stable key for grouping rows by month, e.g. "2026-07". */
export function monthKey(dateStr: string): string {
  const d = toLocalDate(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

/** Single-letter weekday initials, Monday first, for sparkline axes. */
export function weekdayInitials(locale: Locale): string[] {
  return locale === "no"
    ? ["M", "T", "O", "T", "F", "L", "S"]
    : ["M", "T", "W", "T", "F", "S", "S"]
}

/** Time-of-day greeting. Split at 05/12/18 — the boundaries Norwegian and English agree on. */
export function greetingKey(now: Date = new Date()): "morning" | "afternoon" | "evening" {
  const h = now.getHours()
  if (h < 5) return "evening"
  if (h < 12) return "morning"
  if (h < 18) return "afternoon"
  return "evening"
}

/** "Monday 29 July" — the dateline under the greeting on Home. */
export function fullDateLabel(date: Date, locale: Locale): string {
  const label = date.toLocaleDateString(INTL_LOCALE[locale], {
    weekday: "long",
    day: "numeric",
    month: "long",
  })
  return label.charAt(0).toUpperCase() + label.slice(1)
}
