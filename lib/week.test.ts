import { describe, it, expect } from "vitest"
import {
  mondayOf,
  toDateStr,
  weekStartStr,
  parseWeekStart,
  weekRange,
  shiftWeekStr,
  weeksBetweenStarts,
} from "./week"

describe("mondayOf", () => {
  it("returns the same day for a Monday, at midnight", () => {
    const monday = mondayOf(new Date(2026, 7, 10, 15, 42))
    expect(toDateStr(monday)).toBe("2026-08-10")
    expect(monday.getHours()).toBe(0)
    expect(monday.getMinutes()).toBe(0)
  })

  it("walks back to Monday from mid-week", () => {
    expect(toDateStr(mondayOf(new Date(2026, 7, 13)))).toBe("2026-08-10")
  })

  it("treats Sunday as the end of the week, not the start", () => {
    // The single most common off-by-one: getDay() is 0 for Sunday, so a naive
    // `1 - day` jumps forward to tomorrow instead of back six days.
    expect(toDateStr(mondayOf(new Date(2026, 7, 16)))).toBe("2026-08-10")
  })

  it("crosses a month boundary", () => {
    expect(toDateStr(mondayOf(new Date(2026, 8, 2)))).toBe("2026-08-31")
  })
})

describe("toDateStr", () => {
  it("uses local parts, not UTC", () => {
    // 23:30 local on the 10th is the 11th in UTC anywhere east of Greenwich.
    // toISOString() would report the wrong day for exactly the runners this
    // app is built for.
    expect(toDateStr(new Date(2026, 7, 10, 23, 30))).toBe("2026-08-10")
  })

  it("pads single-digit months and days", () => {
    expect(toDateStr(new Date(2026, 0, 5))).toBe("2026-01-05")
  })
})

describe("parseWeekStart", () => {
  it("reads a date-only string as local midnight", () => {
    const d = parseWeekStart("2026-08-10")
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(7)
    expect(d.getDate()).toBe(10)
    expect(d.getHours()).toBe(0)
  })

  it("accepts a full timestamp and keeps the calendar day", () => {
    expect(toDateStr(parseWeekStart("2026-08-10T00:00:00.000Z"))).toBe("2026-08-10")
  })

  it("round-trips with toDateStr", () => {
    expect(toDateStr(parseWeekStart("2026-12-28"))).toBe("2026-12-28")
  })
})

describe("weekRange", () => {
  it("spans Monday to the next Monday", () => {
    const { start, end } = weekRange("2026-08-10")
    expect(toDateStr(start)).toBe("2026-08-10")
    expect(toDateStr(end)).toBe("2026-08-17")
  })

  it("includes the first instant of Monday and excludes the next", () => {
    const { start, end } = weekRange("2026-08-10")
    const mondayMidnight = new Date(2026, 7, 10, 0, 0, 0).getTime()
    const nextMonday = new Date(2026, 7, 17, 0, 0, 0).getTime()
    expect(mondayMidnight >= start.getTime()).toBe(true)
    expect(nextMonday < end.getTime()).toBe(false)
  })

  it("keeps whole days across a DST change", () => {
    // Europe/Oslo springs forward on 2026-03-29, making that week 167 hours.
    // Adding 7 × 24h would land an hour into the following Monday.
    const { end } = weekRange("2026-03-23")
    expect(toDateStr(end)).toBe("2026-03-30")
    expect(end.getHours()).toBe(0)
  })
})

describe("shiftWeekStr", () => {
  it("steps back a week", () => {
    expect(shiftWeekStr("2026-08-10", -1)).toBe("2026-08-03")
  })

  it("steps forward a week", () => {
    expect(shiftWeekStr("2026-08-10", 1)).toBe("2026-08-17")
  })

  it("crosses a year boundary", () => {
    expect(shiftWeekStr("2026-12-28", 1)).toBe("2027-01-04")
  })

  it("is its own inverse", () => {
    expect(shiftWeekStr(shiftWeekStr("2026-03-23", -4), 4)).toBe("2026-03-23")
  })
})

describe("weeksBetweenStarts", () => {
  it("counts whole weeks forward", () => {
    expect(weeksBetweenStarts(new Date(2026, 7, 10), new Date(2026, 7, 31))).toBe(3)
  })

  it("is zero within the same week", () => {
    expect(weeksBetweenStarts(new Date(2026, 7, 10), new Date(2026, 7, 15))).toBe(0)
  })

  it("goes negative before the start", () => {
    expect(weeksBetweenStarts(new Date(2026, 7, 10), new Date(2026, 7, 3))).toBe(-1)
  })

  it("survives a DST change in the span", () => {
    // Week 1 of a block starting 2026-03-23 in a spring-forward zone.
    expect(weeksBetweenStarts(new Date(2026, 2, 23), new Date(2026, 2, 30))).toBe(1)
  })
})

describe("weekStartStr", () => {
  it("agrees with mondayOf for the same instant", () => {
    const now = new Date(2026, 7, 13, 6, 15)
    expect(weekStartStr(now)).toBe(toDateStr(mondayOf(now)))
  })
})
