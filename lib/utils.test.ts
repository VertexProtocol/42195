import { describe, it, expect } from "vitest"
import { cn } from "@/lib/utils"

describe("cn — the app's own type scale", () => {
  it("keeps a text colour next to a custom size", () => {
    // Without the scale registered, `text-label` was read as a colour and the
    // primary button lost its light text.
    expect(cn("text-primary-foreground", "text-label")).toBe("text-primary-foreground text-label")
  })

  it("still lets a later size replace an earlier one", () => {
    expect(cn("text-label", "text-body")).toBe("text-body")
  })
})
