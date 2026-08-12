import { describe, it, expect } from "vitest"
import { isChunkLoadError, shouldReloadForChunkError } from "./chunk-error"

/**
 * A page left open across a deployment is not a broken page.
 *
 * These hold the one distinction the error boundary rests on: a missing chunk
 * is recoverable by reloading, and everything else is not — so a real bug must
 * never be swallowed by a reload, and a stale one must never become a dead end.
 */

describe("isChunkLoadError", () => {
  it("recognises how each browser words it", () => {
    // Chrome and the Next.js runtime.
    expect(isChunkLoadError(new Error("Loading chunk 429 failed."))).toBe(true)
    expect(isChunkLoadError(new Error("Loading CSS chunk 12 failed."))).toBe(true)
    // Chrome, native dynamic import.
    expect(
      isChunkLoadError(new Error("Failed to fetch dynamically imported module: /_next/x.js")),
    ).toBe(true)
    // Firefox.
    expect(
      isChunkLoadError(new Error("error loading dynamically imported module")),
    ).toBe(true)
    // Safari — the one this app's runners are on.
    expect(isChunkLoadError(new Error("Importing a module script failed."))).toBe(true)
  })

  it("recognises the named error class whatever the message says", () => {
    const err = new Error("something else entirely")
    err.name = "ChunkLoadError"
    expect(isChunkLoadError(err)).toBe(true)
  })

  it("does not mistake a real failure for a stale page", () => {
    // The important half: reloading past a genuine bug would hide it and loop
    // the runner through the same crash.
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false)
    expect(isChunkLoadError(new Error("Failed to fetch"))).toBe(false)
    expect(isChunkLoadError(new TypeError("x is not a function"))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
    expect(isChunkLoadError({})).toBe(false)
  })
})

describe("shouldReloadForChunkError", () => {
  const now = 1_800_000_000_000

  it("reloads when nothing has been tried", () => {
    expect(shouldReloadForChunkError(null, now)).toBe(true)
  })

  it("refuses a second attempt straight away, so it cannot loop", () => {
    expect(shouldReloadForChunkError(String(now - 5_000), now)).toBe(false)
    expect(shouldReloadForChunkError(String(now), now)).toBe(false)
  })

  it("allows another attempt later, for a second deployment", () => {
    expect(shouldReloadForChunkError(String(now - 61_000), now)).toBe(true)
  })

  it("treats an unreadable timestamp as no attempt rather than giving up", () => {
    expect(shouldReloadForChunkError("not-a-number", now)).toBe(true)
  })
})
