import { describe, it, expect } from "vitest"
import { nextRateLimitWindow } from "@/lib/strava"

describe("nextRateLimitWindow", () => {
  it("rounds up to the next quarter hour", () => {
    expect(nextRateLimitWindow(new Date("2026-08-11T10:03:12.500Z")).toISOString()).toBe(
      "2026-08-11T10:15:00.000Z",
    )
    expect(nextRateLimitWindow(new Date("2026-08-11T10:16:00Z")).toISOString()).toBe(
      "2026-08-11T10:30:00.000Z",
    )
    expect(nextRateLimitWindow(new Date("2026-08-11T10:44:59Z")).toISOString()).toBe(
      "2026-08-11T10:45:00.000Z",
    )
  })

  it("always moves forward, never returns the current instant", () => {
    const onTheDot = new Date("2026-08-11T10:15:00.000Z")
    expect(nextRateLimitWindow(onTheDot).getTime()).toBeGreaterThan(onTheDot.getTime())
    expect(nextRateLimitWindow(onTheDot).toISOString()).toBe("2026-08-11T10:30:00.000Z")
  })

  it("rolls over into the next hour", () => {
    expect(nextRateLimitWindow(new Date("2026-08-11T10:52:00Z")).toISOString()).toBe(
      "2026-08-11T11:00:00.000Z",
    )
  })

  it("rolls over into the next day", () => {
    expect(nextRateLimitWindow(new Date("2026-08-11T23:58:00Z")).toISOString()).toBe(
      "2026-08-12T00:00:00.000Z",
    )
  })
})
