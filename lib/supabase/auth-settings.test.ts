import { describe, it, expect } from "vitest"
import { parseSignupsAllowed } from "./auth-settings"

/**
 * This decides whether a stranger with a Strava account can make themselves
 * one here, so every shape that is not an explicit `disable_signup: false`
 * has to come back closed. The open answer is the narrow case, not the
 * default.
 */
describe("parseSignupsAllowed", () => {
  it("is open only when the project says signup is not disabled", () => {
    expect(parseSignupsAllowed({ disable_signup: false })).toBe(true)
  })

  it("is closed when the project says signup is disabled", () => {
    expect(parseSignupsAllowed({ disable_signup: true })).toBe(false)
  })

  it("is closed when the field is missing", () => {
    // A settings document that changed shape must not read as permission.
    expect(parseSignupsAllowed({ external: { email: true } })).toBe(false)
  })

  it("is closed when the field is not a boolean", () => {
    // "false" is not false. A truthiness check here would open the door on
    // the string "true" as readily as on the string "false".
    expect(parseSignupsAllowed({ disable_signup: "false" })).toBe(false)
    expect(parseSignupsAllowed({ disable_signup: 0 })).toBe(false)
    expect(parseSignupsAllowed({ disable_signup: null })).toBe(false)
  })

  it("is closed for anything that is not an object", () => {
    expect(parseSignupsAllowed(null)).toBe(false)
    expect(parseSignupsAllowed(undefined)).toBe(false)
    expect(parseSignupsAllowed("disable_signup: false")).toBe(false)
    expect(parseSignupsAllowed(["disable_signup"])).toBe(false)
  })
})
