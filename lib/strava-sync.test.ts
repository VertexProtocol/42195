import { describe, it, expect } from "vitest"
import { syncStateFor, type SyncResult } from "./strava-sync"

/**
 * The difference between "partial" and "rate_limited" is what decides whether
 * the runner is told to carry on or to come back once Strava's window reopens,
 * so it is worth pinning rather than inferring from the one call site.
 */
function result(over: Partial<SyncResult> = {}): SyncResult {
  return {
    synced: 0,
    skipped: 0,
    incremental: true,
    done: false,
    resumeCursor: null,
    resumeAt: null,
    ...over,
  }
}

describe("syncStateFor", () => {
  it("calls a finished run a success", () => {
    expect(syncStateFor(result({ done: true }))).toBe("success")
  })

  it("calls a run that ran out of pages or time partial", () => {
    expect(syncStateFor(result({ done: false, resumeCursor: 1_700_000_000 }))).toBe("partial")
  })

  it("calls a run that spent Strava's limit rate_limited", () => {
    const state = syncStateFor(
      result({ done: false, resumeAt: "2026-08-13T10:15:00.000Z" }),
    )
    expect(state).toBe("rate_limited")
  })

  it("prefers success over a resumeAt left on a finished run", () => {
    // A run can hit the limit on its last page and still finish. It has nothing
    // left to resume, so it must not be parked until the window reopens.
    const state = syncStateFor(
      result({ done: true, resumeAt: "2026-08-13T10:15:00.000Z" }),
    )
    expect(state).toBe("success")
  })
})
