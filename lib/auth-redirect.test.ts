import { describe, it, expect } from "vitest"
import { DEFAULT_AFTER_AUTH, safeNext, withNext } from "./auth-redirect"

describe("safeNext", () => {
  it("keeps a relative path with its query — the invite link case", () => {
    expect(safeNext("/?invite=abc123")).toBe("/?invite=abc123")
    expect(safeNext("/?tab=goals&goal=42")).toBe("/?tab=goals&goal=42")
  })

  it("falls back to the app root when there is nothing to carry", () => {
    expect(safeNext(null)).toBe(DEFAULT_AFTER_AUTH)
    expect(safeNext(undefined)).toBe(DEFAULT_AFTER_AUTH)
    expect(safeNext("")).toBe(DEFAULT_AFTER_AUTH)
  })

  it("refuses to leave the app", () => {
    expect(safeNext("https://evil.example/steal")).toBe(DEFAULT_AFTER_AUTH)
    expect(safeNext("//evil.example")).toBe(DEFAULT_AFTER_AUTH)
    // The URL parser folds backslashes into slashes, so this is the
    // protocol-relative case in another spelling.
    expect(safeNext("/\\evil.example")).toBe(DEFAULT_AFTER_AUTH)
    expect(safeNext("javascript:alert(1)")).toBe(DEFAULT_AFTER_AUTH)
    expect(safeNext("evil.example")).toBe(DEFAULT_AFTER_AUTH)
  })

  it("does not send a signed-in runner back into the auth flow", () => {
    expect(safeNext("/auth/login")).toBe(DEFAULT_AFTER_AUTH)
    expect(safeNext("/auth/sign-up-success?email=a@b.c")).toBe(DEFAULT_AFTER_AUTH)
    expect(safeNext("/auth")).toBe(DEFAULT_AFTER_AUTH)
  })

  it("keeps paths that merely start with the same letters as /auth", () => {
    expect(safeNext("/authors")).toBe("/authors")
  })

  it("drops the fragment, which never reaches the server anyway", () => {
    expect(safeNext("/?tab=goals#week")).toBe("/?tab=goals")
  })
})

describe("withNext", () => {
  it("adds nothing when the destination is the default", () => {
    expect(withNext("/auth/sign-up", null)).toBe("/auth/sign-up")
    expect(withNext("/auth/sign-up", "/")).toBe("/auth/sign-up")
  })

  it("encodes the destination so its own query survives", () => {
    expect(withNext("/auth/login", "/?invite=abc")).toBe("/auth/login?next=%2F%3Finvite%3Dabc")
  })

  it("carries a rejected destination no further than validation", () => {
    expect(withNext("/auth/login", "https://evil.example")).toBe("/auth/login")
  })
})
