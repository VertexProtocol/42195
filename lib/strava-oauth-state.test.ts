import { describe, it, expect } from "vitest"
import {
  decodeStravaState,
  encodeStravaState,
  withSyncOnArrival,
} from "./strava-oauth-state"

describe("the Strava state cookie", () => {
  it("comes back as it went out", () => {
    const state = { nonce: "abc-123", flow: "login" as const, next: "/?invite=xyz" }
    expect(decodeStravaState(encodeStravaState(state))).toEqual(state)
  })

  it("is nothing at all when there is no cookie", () => {
    expect(decodeStravaState(undefined)).toBeNull()
    expect(decodeStravaState("")).toBeNull()
  })

  it("refuses anything it did not write", () => {
    expect(decodeStravaState("not-base64-at-all!!")).toBeNull()
    // A cookie from before this shape existed: a bare nonce.
    expect(decodeStravaState("d0f1c2b3-0000-4000-8000-000000000000")).toBeNull()
    // Well-formed base64 of the wrong thing.
    expect(decodeStravaState(Buffer.from('{"n":"x"}').toString("base64url"))).toBeNull()
    expect(
      decodeStravaState(Buffer.from('{"n":"x","f":"admin"}').toString("base64url")),
    ).toBeNull()
  })

  it("re-validates the destination on the way out", () => {
    // The cookie is ours and httpOnly, but this value began life in a URL.
    const hostile = Buffer.from(
      JSON.stringify({ n: "abc", f: "login", x: "https://evil.example" }),
    ).toString("base64url")
    expect(decodeStravaState(hostile)?.next).toBe("/")
  })
})

describe("withSyncOnArrival", () => {
  it("asks Today to start the first sync", () => {
    expect(withSyncOnArrival("/")).toBe("/?strava_connected=1")
  })

  it("keeps whatever else the destination was carrying", () => {
    expect(withSyncOnArrival("/?invite=abc")).toBe("/?invite=abc&strava_connected=1")
  })

  it("does not send anyone off-origin, however it was asked", () => {
    expect(withSyncOnArrival("https://evil.example")).toBe("/?strava_connected=1")
  })
})
