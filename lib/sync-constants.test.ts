import { describe, it, expect } from "vitest"
import { SYNC_COOLDOWN_MS, syncCooldownRemainingMs } from "./sync-constants"

const NOW = new Date("2026-08-13T17:42:00Z").getTime()
const secondsAgo = (n: number) => new Date(NOW - n * 1000).toISOString()

describe("syncCooldownRemainingMs", () => {
  it("is zero when there has never been a sync", () => {
    expect(syncCooldownRemainingMs(null, NOW)).toBe(0)
    expect(syncCooldownRemainingMs(undefined, NOW)).toBe(0)
  })

  it("is the whole cooldown immediately after a sync", () => {
    expect(syncCooldownRemainingMs(secondsAgo(0), NOW)).toBe(SYNC_COOLDOWN_MS)
  })

  it("counts down while the cooldown runs", () => {
    expect(syncCooldownRemainingMs(secondsAgo(10), NOW)).toBe(20_000)
  })

  it("is zero exactly on the boundary", () => {
    expect(syncCooldownRemainingMs(secondsAgo(30), NOW)).toBe(0)
  })

  it("is zero long afterwards rather than going negative", () => {
    expect(syncCooldownRemainingMs(secondsAgo(86_400), NOW)).toBe(0)
  })

  it("does not lock the button past the cooldown when the clock is skewed", () => {
    // A last_sync_at in the future — server ahead of device — would otherwise
    // produce a remaining time larger than the cooldown itself, disabling the
    // control for as long as the skew lasts.
    const future = new Date(NOW + 60 * 60 * 1000).toISOString()
    expect(syncCooldownRemainingMs(future, NOW)).toBe(SYNC_COOLDOWN_MS)
  })
})
