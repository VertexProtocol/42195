import { describe, it, expect } from "vitest"
import { racePhase, daysUntil } from "./training-phase"

describe("racePhase", () => {
  it("moves through the cycle as the race approaches", () => {
    expect(racePhase(120)).toBe("base-building")
    expect(racePhase(85)).toBe("base-building")
    expect(racePhase(84)).toBe("build")
    expect(racePhase(43)).toBe("build")
    expect(racePhase(42)).toBe("peak")
    expect(racePhase(22)).toBe("peak")
    expect(racePhase(21)).toBe("taper")
    expect(racePhase(1)).toBe("taper")
  })

  it("treats race day and after as taper rather than inventing a phase", () => {
    expect(racePhase(0)).toBe("taper")
    expect(racePhase(-30)).toBe("taper")
  })
})

describe("daysUntil", () => {
  it("counts whole days forward, rounding up a partial day", () => {
    const from = Date.parse("2026-01-01T00:00:00Z")
    expect(daysUntil("2026-01-11T00:00:00Z", from)).toBe(10)
    expect(daysUntil("2026-01-11T06:00:00Z", from)).toBe(11)
  })

  it("goes negative once the race has passed", () => {
    const from = Date.parse("2026-01-15T00:00:00Z")
    expect(daysUntil("2026-01-10T00:00:00Z", from)).toBe(-5)
  })
})
