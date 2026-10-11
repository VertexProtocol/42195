import { describe, expect, it } from "vitest"
import { eventResult } from "./event-result"
import { isHistoricalGoal } from "./goal-lifecycle"
import type { Activity, Goal } from "./types"
const goal = { goal_category: "event_training", target_date: "2026-09-20", target_distance_km: 42.195, target_time_seconds: 14400 } as Goal
const run = { id: "a", strava_id: 1, type: "Run", date: "2026-09-20T08:00:00Z", local_date: "2026-09-20", distance_km: 42.3, duration_seconds: 13800, elapsed_seconds: 14500 } as Activity

describe("event results", () => {
  it("recognizes an ordinary marathon upload but separates a missed time target", () => {
    expect(eventResult(goal, [run])).toMatchObject({ activity: run, automatic: true, timeReached: false })
    expect(isHistoricalGoal(goal, [run])).toBe(true)
  })
  it("uses full elapsed time without pace scaling", () => {
    expect(eventResult(goal, [{ ...run, elapsed_seconds: 14401 }]).timeReached).toBe(false)
    expect(eventResult(goal, [{ ...run, elapsed_seconds: 14400 }]).timeReached).toBe(true)
    expect(eventResult(goal, [{ ...run, elapsed_seconds: null }]).timeReached).toBeNull()
    expect(eventResult(goal, [{ ...run, elapsed_seconds: 100 }]).timeReached).toBeNull()
  })
  it("accepts GPS deviation without counting a substantially shorter run", () => {
    expect(eventResult(goal, [{ ...run, distance_km: 42 }]).activity).not.toBeNull()
    expect(eventResult(goal, [{ ...run, distance_km: 40 }]).candidates).toEqual([])
  })
  it("never matches cycling, virtual runs, manual logs or future uploads", () => {
    for (const change of [{ type: "Ride" }, { type: "Virtual Run" }, { strava_id: null }, { date: "2099-01-01" }])
      expect(eventResult(goal, [{ ...run, ...change }]).candidates).toEqual([])
  })
  it("requires confirmation for an adjacent date or legacy UTC-only upload", () => {
    for (const change of [{ local_date: "2026-09-21" }, { local_date: null }]) {
      const a = { ...run, ...change }
      expect(eventResult(goal, [a])).toMatchObject({ activity: null, candidates: [a] })
      expect(eventResult({ ...goal, event_activity_id: "a" }, [a]).activity).toEqual(a)
    }
  })
  it("uses local date even when the UTC date differs", () => {
    expect(eventResult(goal, [{ ...run, date: "2026-09-19T23:00:00Z" }]).activity).not.toBeNull()
  })
  it("doesn't match training weeks earlier", () => {
    expect(eventResult(goal, [{ ...run, local_date: "2026-09-01" }]).candidates).toEqual([])
  })
  it("asks for confirmation on an ordinary short run", () => {
    const short = { ...goal, target_distance_km: 5 }
    const a = { ...run, distance_km: 5 }
    expect(eventResult(short, [a]).activity).toBeNull()
    expect(eventResult(short, [{ ...a, type: "Race" }]).activity).not.toBeNull()
  })
  it("does not guess between two clear matches", () => {
    expect(eventResult(goal, [run, { ...run, id: "b" }]).activity).toBeNull()
  })
  it("respects dismissal, confirmation, and deleted or changed activities", () => {
    expect(eventResult({ ...goal, event_match_dismissed: true }, [run]).activity).toBeNull()
    expect(eventResult({ ...goal, event_activity_id: "a" }, []).activity).toBeNull()
    expect(eventResult({ ...goal, target_date: "2026-10-01", event_activity_id: "a" }, [run]).activity).toBeNull()
  })
  it("leaves performance goal evaluation separate", () => {
    expect(eventResult({ ...goal, goal_category: "performance" }, [run]).activity).toBeNull()
  })
})
