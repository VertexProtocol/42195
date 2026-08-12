import { describe, it, expect } from "vitest"
import {
  laneGeometry,
  startLinePct,
  pointAtDistance,
  pointAtPercentage,
  assignLanes,
} from "./lane-geometry"

const BOX_W = 288
const BOX_H = 180
const STROKE = 7

const g = laneGeometry(BOX_W, BOX_H, STROKE)

describe("laneGeometry", () => {
  it("insets by half the stroke so the lane sits inside its box", () => {
    expect(g.x).toBe(STROKE / 2)
    expect(g.y).toBe(STROKE / 2)
    expect(g.width).toBe(BOX_W - STROKE)
    expect(g.height).toBe(BOX_H - STROKE)
    expect(g.r).toBe((BOX_H - STROKE) / 2)
  })

  it("adds up to two straights and two semicircles", () => {
    expect(g.perimeter).toBeCloseTo(2 * g.straight + 2 * Math.PI * g.r, 6)
  })

  it("keeps the straights the same length however far in the lane sits", () => {
    // Insetting shrinks width and height equally, so the bends tighten but the
    // straights do not move. Concentric lanes stay concentric.
    expect(laneGeometry(BOX_W, BOX_H, STROKE, 30).straight).toBeCloseTo(g.straight, 6)
  })

  it("never returns a negative lane for an inset larger than the box", () => {
    const tiny = laneGeometry(40, 40, 4, 100)
    expect(tiny.width).toBe(0)
    expect(tiny.height).toBe(0)
    expect(tiny.perimeter).toBe(0)
  })
})

describe("pointAtDistance", () => {
  it("starts at the left end of the top straight", () => {
    const p = pointAtDistance(g, 0)
    expect(p.x).toBeCloseTo(g.x + g.r, 6)
    expect(p.y).toBeCloseTo(g.y, 6)
  })

  it("reaches the far end of the top straight, then bends down", () => {
    const end = pointAtDistance(g, g.straight)
    expect(end.x).toBeCloseTo(g.x + g.width - g.r, 6)
    expect(end.y).toBeCloseTo(g.y, 6)

    // A quarter of the way round the bend is the rightmost point of the lane.
    const quarter = pointAtDistance(g, g.straight + (Math.PI * g.r) / 2)
    expect(quarter.x).toBeCloseTo(g.x + g.width, 6)
    expect(quarter.y).toBeCloseTo(g.y + g.r, 6)
  })

  it("runs the bottom straight the other way", () => {
    const p = pointAtDistance(g, g.straight + Math.PI * g.r)
    expect(p.x).toBeCloseTo(g.x + g.width - g.r, 6)
    expect(p.y).toBeCloseTo(g.y + g.height, 6)
  })

  it("closes the loop", () => {
    const start = pointAtDistance(g, 0)
    const round = pointAtDistance(g, g.perimeter)
    expect(round.x).toBeCloseTo(start.x, 6)
    expect(round.y).toBeCloseTo(start.y, 6)
  })

  it("wraps rather than running off the end", () => {
    const a = pointAtDistance(g, g.perimeter * 1.25)
    const b = pointAtDistance(g, g.perimeter * 0.25)
    expect(a.x).toBeCloseTo(b.x, 6)
    expect(a.y).toBeCloseTo(b.y, 6)

    // Negative distances count backwards from the start, which is the same
    // place as counting forwards the rest of the way round.
    const back = pointAtDistance(g, -g.straight)
    const forward = pointAtDistance(g, g.perimeter - g.straight)
    expect(back.x).toBeCloseTo(forward.x, 6)
    expect(back.y).toBeCloseTo(forward.y, 6)
  })

  it("stays inside the box everywhere round the lane", () => {
    for (let d = 0; d < g.perimeter; d += g.perimeter / 360) {
      const p = pointAtDistance(g, d)
      expect(p.x).toBeGreaterThanOrEqual(g.x - 1e-6)
      expect(p.x).toBeLessThanOrEqual(g.x + g.width + 1e-6)
      expect(p.y).toBeGreaterThanOrEqual(g.y - 1e-6)
      expect(p.y).toBeLessThanOrEqual(g.y + g.height + 1e-6)
    }
  })
})

describe("pointAtPercentage", () => {
  it("puts nothing-run-yet on the start line", () => {
    const zero = pointAtPercentage(g, 0)
    const line = pointAtDistance(g, (startLinePct(g) / 100) * g.perimeter)
    expect(zero.x).toBeCloseTo(line.x, 6)
    expect(zero.y).toBeCloseTo(line.y, 6)
  })

  it("brings a finished lap back to the same line", () => {
    const done = pointAtPercentage(g, 100)
    const zero = pointAtPercentage(g, 0)
    expect(done.x).toBeCloseTo(zero.x, 6)
    expect(done.y).toBeCloseTo(zero.y, 6)
  })

  it("runs the lane anticlockwise, the way a track is run", () => {
    // Just off the start line the runner has moved back along the top
    // straight, to the left — not forward into the bend.
    const start = pointAtPercentage(g, 0)
    const early = pointAtPercentage(g, 2)
    expect(early.x).toBeLessThan(start.x)
    expect(early.y).toBeCloseTo(g.y, 6)
  })

  it("clamps rather than lapping the field", () => {
    expect(pointAtPercentage(g, 130)).toEqual(pointAtPercentage(g, 100))
    expect(pointAtPercentage(g, -20)).toEqual(pointAtPercentage(g, 0))
  })
})

describe("assignLanes", () => {
  const geomFor = (lane: number) => laneGeometry(BOX_W, BOX_H, STROKE, 11 + lane * 30)

  it("leaves a well-spread field on the outer lane", () => {
    expect(assignLanes([86, 60, 35, 10], geomFor, 30)).toEqual([0, 0, 0, 0])
  })

  it("moves runners inward when their markers would overlap", () => {
    // The measure this app ships bunches a group into a few points of each
    // other, which is exactly where a single lane stops being readable.
    const lanes = assignLanes([99, 98, 97, 96], geomFor, 30)
    expect(new Set(lanes).size).toBeGreaterThan(1)
    // Nobody is left sitting on top of someone else in the same lane.
    lanes.forEach((lane, i) => {
      lanes.forEach((other, j) => {
        if (i >= j || lane !== other) return
        expect(Math.abs([99, 98, 97, 96][i] - [99, 98, 97, 96][j])).toBeGreaterThan(0)
      })
    })
  })

  it("keeps the first runner given on the outer lane", () => {
    // The screen passes the reader first so their filled arc and their marker
    // never describe different rings.
    expect(assignLanes([90, 90, 90], geomFor, 30)[0]).toBe(0)
  })

  it("does not loop forever on a field that cannot be separated", () => {
    const lanes = assignLanes(Array(30).fill(50), geomFor, 30)
    expect(lanes).toHaveLength(30)
    expect(Math.max(...lanes)).toBeLessThanOrEqual(8)
  })
})
