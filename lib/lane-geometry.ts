/**
 * Where a point sits on the lane.
 *
 * The lane is a stadium: two straights joined by semicircular bends, the same
 * shape `ProgressLap` fills and the track loader runs. Placing several runners
 * on one lane means turning a percentage into a coordinate, and doing it in
 * closed form rather than by measuring the rendered path keeps the markers
 * correct on the server's first paint instead of jumping into place after an
 * effect runs.
 *
 * Distances run clockwise from the left end of the top straight, matching the
 * direction an SVG rect's own path takes, so the numbers here and the dash
 * offsets in `ProgressLap` describe the same journey.
 */

export interface LaneGeometry {
  /** Left edge of the lane's path, stroke already accounted for. */
  x: number
  y: number
  width: number
  height: number
  /** Bend radius — half the height, so the ends are semicircles. */
  r: number
  /** Length of one straight. */
  straight: number
  /** Total distance once round. */
  perimeter: number
}

export function laneGeometry(
  boxWidth: number,
  boxHeight: number,
  strokeWidth: number,
  inset = 0,
): LaneGeometry {
  const x = strokeWidth / 2 + inset
  const y = strokeWidth / 2 + inset
  const width = Math.max(0, boxWidth - strokeWidth - inset * 2)
  const height = Math.max(0, boxHeight - strokeWidth - inset * 2)
  const r = height / 2
  const straight = Math.max(0, width - 2 * r)
  return { x, y, width, height, r, straight, perimeter: 2 * straight + 2 * Math.PI * r }
}

/**
 * The start line, as a percentage of the way round.
 *
 * It sits where the home straight meets the first bend — one straight's length
 * from where the path begins.
 */
export function startLinePct(g: LaneGeometry): number {
  if (g.perimeter <= 0) return 0
  return (g.straight / g.perimeter) * 100
}

/** The point `distance` along the lane from the path's own start. */
export function pointAtDistance(g: LaneGeometry, distance: number): { x: number; y: number } {
  if (g.perimeter <= 0) return { x: g.x, y: g.y }

  const d = ((distance % g.perimeter) + g.perimeter) % g.perimeter
  const bend = Math.PI * g.r
  const right = g.x + g.width - g.r
  const left = g.x + g.r
  const midY = g.y + g.r

  // Top straight, left to right.
  if (d <= g.straight) return { x: left + d, y: g.y }

  // Right bend, running down the outside.
  if (d <= g.straight + bend) {
    const theta = -Math.PI / 2 + (d - g.straight) / g.r
    return { x: right + g.r * Math.cos(theta), y: midY + g.r * Math.sin(theta) }
  }

  // Bottom straight, right to left.
  if (d <= 2 * g.straight + bend) {
    return { x: right - (d - g.straight - bend), y: g.y + g.height }
  }

  // Left bend, closing the loop.
  const theta = Math.PI / 2 + (d - 2 * g.straight - bend) / g.r
  return { x: left + g.r * Math.cos(theta), y: midY + g.r * Math.sin(theta) }
}

/**
 * Where a runner who has covered `pct` of the lap is standing.
 *
 * A lap is run backwards along the path — anticlockwise — because that is the
 * way a track is run, and it puts the kerb on the runner's left. So progress
 * counts down from the start line rather than up from the path's origin.
 */
export function pointAtPercentage(g: LaneGeometry, pct: number): { x: number; y: number } {
  const clamped = Math.max(0, Math.min(100, pct))
  const fromStart = ((startLinePct(g) - clamped) % 100 + 100) % 100
  return pointAtDistance(g, (fromStart / 100) * g.perimeter)
}

/**
 * Assigns runners to concentric lanes so that markers which would overlap are
 * moved inwards instead of covering each other.
 *
 * A stadium has more than one lane, so crowding is something the drawing can
 * absorb. It matters for the measure this app ships: adherence bunches
 * everyone between roughly 80 and 105, which is a tight arc.
 */
export function assignLanes(
  percentages: number[],
  geometryFor: (lane: number) => LaneGeometry,
  minSeparationPx: number,
): number[] {
  const placed: Array<{ pct: number; lane: number }> = []

  return percentages.map((raw) => {
    const pct = Math.max(0, Math.min(100, raw))
    let lane = 0
    // Walk outward-in until the marker has room. Bounded by how many rings the
    // box can hold, so a pathological input cannot loop forever.
    for (let guard = 0; guard < 8; guard++) {
      const g = geometryFor(lane)
      if (g.straight <= 0 || g.r <= 0) break
      const clash = placed.some(
        (p) => p.lane === lane && (Math.abs(p.pct - pct) / 100) * g.perimeter < minSeparationPx,
      )
      if (!clash) break
      lane++
    }
    placed.push({ pct, lane })
    return lane
  })
}
