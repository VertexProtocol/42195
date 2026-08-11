// @vitest-environment jsdom

import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Meter } from "./meter"

/**
 * The zone band is decorative, so none of it is reachable by role or text —
 * these assertions read the DOM directly. That is the point: the band's whole
 * job is to be visible, and the bug it is guarding against was a paint-order
 * mistake that no accessible query could have caught.
 */

function track(): HTMLElement {
  return screen.getByRole("progressbar")
}

/** Every absolutely-positioned decoration inside the track, in paint order. */
function decorations(): HTMLElement[] {
  return Array.from(track().querySelectorAll<HTMLElement>("div.absolute"))
}

describe("Meter", () => {
  it("reports its value to assistive technology", () => {
    render(<Meter value={62} label="Training load" valueText="0.94× baseline" />)
    expect(track().getAttribute("aria-valuenow")).toBe("62")
    expect(track().getAttribute("aria-valuetext")).toBe("0.94× baseline")
  })

  it("clamps the fill without clamping the reported text", () => {
    render(<Meter value={180} label="Training load" valueText="2.70× baseline" />)
    expect(track().getAttribute("aria-valuenow")).toBe("100")
    expect(track().getAttribute("aria-valuetext")).toBe("2.70× baseline")
  })

  it("draws no decorations when no zone is given", () => {
    render(<Meter value={50} label="Training load" />)
    expect(decorations()).toHaveLength(0)
  })

  it("draws the band across the range it was given", () => {
    render(<Meter value={50} label="Training load" zone={{ from: 53, to: 87 }} />)
    const band = decorations()[0]
    expect(band.style.left).toBe("53%")
    expect(band.style.width).toBe("34%")
  })

  it("paints both band edges after the fill, so a full bar cannot hide them", () => {
    // The regression this exists for: the shaded band was painted before the
    // fill, so a value past the band covered the whole thing and left nothing
    // to read the bar against.
    render(<Meter value={93} label="Training load" zone={{ from: 53, to: 87 }} />)

    const children = Array.from(track().children) as HTMLElement[]
    const fillIndex = children.findIndex((el) => el.style.transform.startsWith("scaleX"))
    expect(fillIndex).toBeGreaterThanOrEqual(0)

    const edges = children.filter((el) => el.classList.contains("w-px"))
    expect(edges).toHaveLength(2)
    expect(edges.map((el) => el.style.left)).toEqual(["53%", "87%"])
    // Both edges come after the fill in DOM order, i.e. on top of it.
    for (const edge of edges) {
      expect(children.indexOf(edge)).toBeGreaterThan(fillIndex)
    }
  })

  it("keeps the band inside the track when handed out-of-range bounds", () => {
    render(<Meter value={50} label="Training load" zone={{ from: -20, to: 140 }} />)
    const band = decorations()[0]
    expect(band.style.left).toBe("0%")
    expect(band.style.width).toBe("100%")
  })
})
