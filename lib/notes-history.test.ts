import { describe, it, expect } from "vitest"
import {
  type NoteHistoryEntry,
  hasActiveInjury,
  containsNewActiveInjury,
  getPhaseLabel,
} from "./notes-history"

function entry(partial: Partial<NoteHistoryEntry>): NoteHistoryEntry {
  return {
    content: partial.content ?? "",
    type: partial.type ?? "coach",
    added_at: partial.added_at ?? "2026-01-01T00:00:00Z",
    resolved_at: partial.resolved_at ?? null,
    block_start_date: partial.block_start_date ?? null,
    block_week: partial.block_week ?? null,
    block_total_weeks: partial.block_total_weeks ?? null,
    training_phase: partial.training_phase ?? null,
    weekly_km_target: partial.weekly_km_target ?? null,
    sessions_per_week: partial.sessions_per_week ?? null,
  }
}

describe("hasActiveInjury", () => {
  it("returns false for null / undefined / empty history", () => {
    expect(hasActiveInjury(null)).toBe(false)
    expect(hasActiveInjury(undefined)).toBe(false)
    expect(hasActiveInjury([])).toBe(false)
  })

  it("returns false when only coach notes exist", () => {
    const history = [
      entry({ type: "coach", content: "Feeling good" }),
      entry({ type: "coach", content: "Hills were fun" }),
    ]
    expect(hasActiveInjury(history)).toBe(false)
  })

  it("returns true for an unresolved injury", () => {
    const history = [entry({ type: "injury", content: "Sore hip" })]
    expect(hasActiveInjury(history)).toBe(true)
  })

  it("returns false when all injuries are resolved", () => {
    const history = [
      entry({ type: "injury", content: "Old hip issue", resolved_at: "2026-02-10T00:00:00Z" }),
      entry({ type: "injury", content: "Old knee tweak", resolved_at: "2026-02-20T00:00:00Z" }),
    ]
    expect(hasActiveInjury(history)).toBe(false)
  })

  it("returns true if at least one injury among many is unresolved", () => {
    const history = [
      entry({ type: "coach", content: "note" }),
      entry({ type: "injury", content: "Healed calf", resolved_at: "2026-03-01T00:00:00Z" }),
      entry({ type: "injury", content: "Active shin splints" }),
      entry({ type: "coach", content: "another note" }),
    ]
    expect(hasActiveInjury(history)).toBe(true)
  })
})

describe("containsNewActiveInjury", () => {
  it("returns false for null / undefined / empty", () => {
    expect(containsNewActiveInjury(null)).toBe(false)
    expect(containsNewActiveInjury(undefined)).toBe(false)
    expect(containsNewActiveInjury([])).toBe(false)
  })

  it("returns false for coach notes only", () => {
    const entries = [entry({ type: "coach", content: "Feeling great" })]
    expect(containsNewActiveInjury(entries)).toBe(false)
  })

  it("returns true when a single active injury entry is present", () => {
    const entries = [entry({ type: "injury", content: "Knee pain" })]
    expect(containsNewActiveInjury(entries)).toBe(true)
  })

  it("returns false when the only injury entry is already resolved (e.g. backfill)", () => {
    const entries = [entry({ type: "injury", content: "Old", resolved_at: "2026-03-01" })]
    expect(containsNewActiveInjury(entries)).toBe(false)
  })

  it("returns true when mixed entries include at least one active injury", () => {
    const entries = [
      entry({ type: "coach", content: "note" }),
      entry({ type: "injury", content: "acute" }),
    ]
    expect(containsNewActiveInjury(entries)).toBe(true)
  })
})

describe("getPhaseLabel", () => {
  it("assigns 'base' to early weeks", () => {
    // 12-week plan: taper = min(3, max(1, 1)) = 1, build = max(2, 3) = 3, base = 8
    expect(getPhaseLabel(0, 12)).toBe("base")
    expect(getPhaseLabel(7, 12)).toBe("base")
  })

  it("assigns 'build' to mid-block weeks", () => {
    expect(getPhaseLabel(8, 12)).toBe("build")
    expect(getPhaseLabel(10, 12)).toBe("build")
  })

  it("assigns 'taper' to final week(s)", () => {
    expect(getPhaseLabel(11, 12)).toBe("taper")
  })
})
