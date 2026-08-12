import { describe, it, expect } from "vitest"
import {
  athleteDisplayName,
  isPlaceholderEmail,
  placeholderEmailFor,
} from "./strava-account"

describe("the placeholder address", () => {
  it("can never reach anybody", () => {
    // .invalid is reserved by RFC 2606 — it does not resolve, so a typo here
    // cannot mail a stranger.
    expect(placeholderEmailFor(12345)).toBe("athlete-12345@strava.invalid")
  })

  it("is recognisable again later", () => {
    expect(isPlaceholderEmail(placeholderEmailFor(9))).toBe(true)
    expect(isPlaceholderEmail("runner@example.com")).toBe(false)
    expect(isPlaceholderEmail(null)).toBe(false)
    expect(isPlaceholderEmail(undefined)).toBe(false)
  })

  it("is not fooled by an address that merely mentions it", () => {
    expect(isPlaceholderEmail("strava.invalid@example.com")).toBe(false)
  })
})

describe("athleteDisplayName", () => {
  it("uses what Strava calls them", () => {
    expect(athleteDisplayName({ id: 1, firstname: "Ada", lastname: "Berg" })).toBe("Ada Berg")
  })

  it("copes with half a name", () => {
    expect(athleteDisplayName({ id: 1, firstname: "Ada", lastname: null })).toBe("Ada")
    expect(athleteDisplayName({ id: 1, firstname: null, lastname: "Berg" })).toBe("Berg")
  })

  it("says something honest when Strava says nothing", () => {
    // Better than an empty profile row: the runner can rename themselves, but
    // they cannot fix a blank they never saw.
    expect(athleteDisplayName({ id: 42 })).toBe("Athlete 42")
    expect(athleteDisplayName({ id: 42, firstname: "  ", lastname: null })).toBe("Athlete 42")
  })
})
