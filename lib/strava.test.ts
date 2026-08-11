import { describe, it, expect, vi, afterEach } from "vitest"
import {
  nextRateLimitWindow,
  stravaApiFetch,
  StravaAppInactiveError,
  StravaRateLimitError,
} from "@/lib/strava"

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

describe("stravaApiFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Stubs global fetch with a single canned response. */
  const stubFetch = (body: string, init: ResponseInit) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, init))
    vi.stubGlobal("fetch", fetchMock)
    return fetchMock
  }

  it("throws StravaAppInactiveError when Strava reports the app as inactive", async () => {
    stubFetch(
      JSON.stringify({
        message: "Forbidden",
        errors: [{ resource: "Application", field: "Status", code: "Inactive" }],
      }),
      { status: 403 },
    )

    await expect(stravaApiFetch("https://example.test/activities", "tok")).rejects.toBeInstanceOf(
      StravaAppInactiveError,
    )
  })

  it("does not mistake an athlete-level 403 for an inactive app, and keeps the body readable", async () => {
    const body = JSON.stringify({
      message: "Forbidden",
      errors: [{ resource: "Activity", field: "access_token", code: "invalid" }],
    })
    stubFetch(body, { status: 403 })

    const res = await stravaApiFetch("https://example.test/activities", "tok")

    expect(res.status).toBe(403)
    // stravaApiFetch reads the body to inspect it — callers must still get it.
    expect(await res.text()).toBe(body)
  })

  it("treats an unparseable 403 body as a plain 403 rather than an inactive app", async () => {
    stubFetch("<html>gateway blocked</html>", { status: 403 })

    const res = await stravaApiFetch("https://example.test/activities", "tok")

    expect(res.status).toBe(403)
    expect(await res.text()).toBe("<html>gateway blocked</html>")
  })

  it("still raises the rate-limit error on 429", async () => {
    stubFetch("Rate Limit Exceeded", { status: 429 })

    await expect(stravaApiFetch("https://example.test/activities", "tok")).rejects.toBeInstanceOf(
      StravaRateLimitError,
    )
  })

  it("passes successful responses straight through", async () => {
    stubFetch(JSON.stringify([{ id: 1 }]), { status: 200 })

    const res = await stravaApiFetch("https://example.test/activities", "tok")

    expect(res.ok).toBe(true)
    expect(await res.json()).toEqual([{ id: 1 }])
  })

  it("sends the access token as a bearer header", async () => {
    const fetchMock = stubFetch("[]", { status: 200 })

    await stravaApiFetch("https://example.test/activities", "tok123")

    expect(fetchMock).toHaveBeenCalledWith("https://example.test/activities", {
      headers: { Authorization: "Bearer tok123" },
    })
  })
})
