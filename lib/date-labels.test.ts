import { describe, it, expect } from "vitest"
import {
  toLocalDate,
  daysAgo,
  relativeDayLabel,
  monthKey,
  monthLabel,
  greetingKey,
} from "@/lib/date-labels"

// Fixed reference point: Wednesday 29 July 2026, 09:00 local.
const NOW = new Date("2026-07-29T09:00:00")

describe("toLocalDate", () => {
  it("parses a date-only string at local noon, not UTC midnight", () => {
    // The bug this guards: new Date("2026-07-28") is UTC midnight, which is
    // the 27th in any negative-offset timezone.
    const d = toLocalDate("2026-07-28")
    expect(d.getDate()).toBe(28)
    expect(d.getHours()).toBe(12)
  })

  it("ignores the time portion of a full ISO timestamp", () => {
    const d = toLocalDate("2026-07-28T23:45:00Z")
    expect(d.getDate()).toBe(28)
  })
})

describe("daysAgo", () => {
  it("counts calendar days, not elapsed hours", () => {
    // 23:00 yesterday to 09:00 today is 10 hours but one calendar day.
    expect(daysAgo("2026-07-28T23:00:00", NOW)).toBe(1)
  })

  it("returns 0 for today", () => {
    expect(daysAgo("2026-07-29", NOW)).toBe(0)
  })

  it("returns a negative count for future dates", () => {
    expect(daysAgo("2026-07-31", NOW)).toBe(-2)
  })
})

describe("relativeDayLabel", () => {
  it("names today, yesterday and tomorrow in both locales", () => {
    expect(relativeDayLabel("2026-07-29", "en", NOW)).toBe("Today")
    expect(relativeDayLabel("2026-07-29", "no", NOW)).toBe("I dag")
    expect(relativeDayLabel("2026-07-28", "en", NOW)).toBe("Yesterday")
    expect(relativeDayLabel("2026-07-28", "no", NOW)).toBe("I går")
    expect(relativeDayLabel("2026-07-30", "en", NOW)).toBe("Tomorrow")
    expect(relativeDayLabel("2026-07-30", "no", NOW)).toBe("I morgen")
  })

  it("uses a capitalised weekday within the past week", () => {
    // 26 July 2026 is a Sunday, three days before the reference Wednesday.
    expect(relativeDayLabel("2026-07-26", "en", NOW)).toBe("Sunday")
    // nb-NO yields "søndag" lowercase; it must be capitalised for a row start.
    expect(relativeDayLabel("2026-07-26", "no", NOW)).toBe("Søndag")
  })

  it("falls back to a date beyond a week", () => {
    // Exactly 7 days is already too old for a weekday to disambiguate.
    expect(relativeDayLabel("2026-07-22", "en", NOW)).not.toBe("Wednesday")
    expect(relativeDayLabel("2026-07-22", "en", NOW)).toMatch(/22/)
  })
})

describe("monthKey / monthLabel", () => {
  it("keys by calendar month", () => {
    expect(monthKey("2026-07-01")).toBe("2026-07")
    expect(monthKey("2026-12-31")).toBe("2026-12")
  })

  it("capitalises the Norwegian month name", () => {
    expect(monthLabel("2026-07-15", "no")).toMatch(/^Juli/)
    expect(monthLabel("2026-07-15", "en")).toMatch(/^July/)
  })
})

describe("greetingKey", () => {
  it("splits the day at 05, 12 and 18", () => {
    expect(greetingKey(new Date("2026-07-29T03:00:00"))).toBe("evening")
    expect(greetingKey(new Date("2026-07-29T05:00:00"))).toBe("morning")
    expect(greetingKey(new Date("2026-07-29T11:59:00"))).toBe("morning")
    expect(greetingKey(new Date("2026-07-29T12:00:00"))).toBe("afternoon")
    expect(greetingKey(new Date("2026-07-29T17:59:00"))).toBe("afternoon")
    expect(greetingKey(new Date("2026-07-29T18:00:00"))).toBe("evening")
  })
})
