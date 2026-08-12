import { describe, it, expect } from "vitest"
import { detectLocale } from "./i18n"

describe("detectLocale", () => {
  it("opens in Norwegian for a Norwegian browser", () => {
    expect(detectLocale(["nb-NO", "en-GB"])).toBe("no")
    expect(detectLocale(["no"])).toBe("no")
    expect(detectLocale(["nn-NO"])).toBe("no")
  })

  it("opens in English for everyone else", () => {
    expect(detectLocale(["en-GB"])).toBe("en")
    expect(detectLocale(["de-DE"])).toBe("en")
    expect(detectLocale([])).toBe("en")
  })

  it("survives a navigator that states nothing", () => {
    // Embedded webviews really do turn up with no language, and this runs on
    // the first render of every signed-out screen.
    expect(detectLocale([undefined])).toBe("en")
    expect(detectLocale([undefined, "nb-NO"])).toBe("no")
  })

  it("follows the order the browser states, not the list it happens to hold", () => {
    // An English-first browser that also accepts Norwegian stays English.
    expect(detectLocale(["en-GB", "nb-NO"])).toBe("en")
    // A language the app does not have is skipped rather than settled for.
    expect(detectLocale(["de-DE", "nb-NO"])).toBe("no")
  })
})
