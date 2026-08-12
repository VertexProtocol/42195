"use client"

import { useEffect, useRef, useState } from "react"
import {
  laneGeometry,
  startLinePct,
  pointAtPercentage,
  assignLanes,
} from "@/lib/lane-geometry"

/**
 * ProgressLap — the app's one authored motion moment.
 *
 * The same lane the mark and the loader draw, filled to a value. On first paint
 * the arc runs from the start line to wherever the runner actually is, and it
 * runs the way the lane is run: backwards along the path, which is
 * anticlockwise. It happens once per mount, on the small number of meters that
 * carry a screen's headline state, and is skipped under reduced motion — where
 * the lap simply arrives at its value.
 *
 * The centre is a slot rather than a fixed label, so callers compose what sits
 * inside it without a second absolutely-positioned layer of their own.
 */

/** The mark's proportions, so every lane in the app is the same shape. */
const RATIO = 48 / 30

interface ProgressLapProps {
  percentage: number
  /** Height in px. The lane is 1.6× as wide as it is tall. */
  size?: number
  strokeWidth?: number
  /** Semantic colour of the arc. */
  tone?: "action" | "done" | "caution" | "quiet"
  /**
   * What the unrun part of the lane is drawn in.
   *
   * `sunken` is a well in a card and is the default. It is a shade off the
   * card by design, which makes it invisible on the page background — those
   * two are 0.035 apart in lightness. A lap that sits on the page rather than
   * in a card takes `border`, or an empty lane simply is not there.
   */
  track?: "sunken" | "border"
  /** What this lap measures — used as its accessible name. */
  label: string
  children?: React.ReactNode
  /**
   * Other runners on the same lane.
   *
   * The filled arc stays the reader's own lap — the accent only ever means
   * "this is where you are" — and everyone else is a marker. Markers whose
   * positions would overlap are moved to an inner lane rather than stacked,
   * because the measure this app ships bunches a group into a tight arc.
   */
  markers?: LaneMarker[]
}

export interface LaneMarker {
  id: string
  /** One or two characters. A full name will not fit and is not the point. */
  initial: string
  percentage: number
  /** Colour of the ring, from the chart token set. */
  color: string
  /** The reader's own marker, drawn filled. */
  isSelf?: boolean
  /** Read out by assistive technology in place of the initial. */
  name: string
}

const toneVar: Record<NonNullable<ProgressLapProps["tone"]>, string> = {
  action: "var(--primary)",
  done: "var(--success)",
  caution: "var(--warning)",
  quiet: "var(--muted-foreground)",
}

export function ProgressLap({
  percentage,
  size = 48,
  strokeWidth = 5,
  tone = "action",
  track = "sunken",
  label,
  children,
  markers,
}: ProgressLapProps) {
  const trackVar = track === "border" ? "var(--border)" : "var(--surface-sunken)"
  const target = Math.max(0, Math.min(100, percentage))

  const [drawn, setDrawn] = useState(0)
  const hasDrawn = useRef(false)

  useEffect(() => {
    if (hasDrawn.current) {
      setDrawn(target)
      return
    }
    hasDrawn.current = true
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduced) {
      setDrawn(target)
      return
    }
    const id = requestAnimationFrame(() => setDrawn(target))
    return () => cancelAnimationFrame(id)
  }, [target])

  // The lane, stroke centred on the path so it sits inside the box.
  const width = size * RATIO

  // A marker is centred on its lane, so half of it hangs outside. Room is only
  // made when there are markers to make it for — otherwise every existing lap
  // in the app would quietly shrink.
  const markerR = Math.max(9, Math.round(size * 0.075))
  const pad = markers && markers.length > 0 ? markerR - strokeWidth / 2 + 1 : 0
  const laneGap = markerR * 2 + 4

  const geomFor = (laneIndex: number) =>
    laneGeometry(width, size, strokeWidth, pad + laneIndex * laneGap)

  const base = geomFor(0)
  const lane = {
    x: base.x,
    y: base.y,
    width: base.width,
    height: base.height,
    rx: base.r,
    fill: 'none',
    strokeWidth,
  }

  // A rect's path starts at the left end of the top straight and runs
  // clockwise. The start line is the far end of that straight — where the home
  // straight meets the first bend — and the fill runs backwards from it, which
  // puts the kerb on the runner's left.
  const startLine = startLinePct(base)

  // The reader keeps the outer lane whatever their position, so their filled
  // arc and their marker never end up describing different rings.
  const ordered = (markers ?? [])
    .slice()
    .sort((a, b) =>
      a.isSelf === b.isSelf ? b.percentage - a.percentage : a.isSelf ? -1 : 1,
    )
  const laneIndices = assignLanes(
    ordered.map((m) => m.percentage),
    geomFor,
    markerR * 2 + 4,
  )
  const usedLanes = laneIndices.length > 0 ? Math.max(...laneIndices) : 0

  const roster = ordered.length > 0
    ? ordered.map((m) => `${m.name} ${Math.round(m.percentage)}%`).join(", ")
    : null

  return (
    <div
      className="relative shrink-0"
      style={{ width, height: size }}
      role="img"
      aria-label={roster ? `${label}: ${roster}` : `${label}: ${Math.round(target)}%`}
    >
      <svg width={width} height={size} aria-hidden focusable="false">
        <rect {...lane} stroke={trackVar} />
        {Array.from({ length: usedLanes }, (_, i) => {
          const g = geomFor(i + 1)
          return (
            <rect
              key={`lane-${i + 1}`}
              x={g.x}
              y={g.y}
              width={g.width}
              height={g.height}
              rx={g.r}
              fill="none"
              strokeWidth={strokeWidth}
              stroke={trackVar}
            />
          )
        })}
        <rect
          {...lane}
          stroke={toneVar[tone]}
          // A round cap on a zero-length dash still paints: nothing run yet
          // would show as a dot sitting on the start line.
          strokeLinecap={drawn > 0 ? "round" : "butt"}
          // `pathLength` normalises the lane to 100 so the dash is a
          // percentage. Holding the offset one dash-length ahead of the start
          // line pins the tail there and lets the head travel anticlockwise.
          pathLength={100}
          strokeDasharray={`${drawn} ${100 - drawn}`}
          strokeDashoffset={drawn - startLine}
          style={{
            transition:
              "stroke-dasharray 700ms var(--ease-out), stroke-dashoffset 700ms var(--ease-out)",
          }}
        />
        {ordered.map((m, i) => {
          const g = geomFor(laneIndices[i])
          const p = pointAtPercentage(g, m.percentage)
          return (
            <g
              key={m.id}
              transform={`translate(${p.x},${p.y})`}
              // Markers arrive rather than travel: a transform tween would cut
              // them straight across the infield, which is the one path a
              // runner cannot take.
              style={{
                opacity: drawn > 0 || target === 0 ? 1 : 0,
                transition: `opacity 400ms var(--ease-out) ${i * 70}ms`,
              }}
            >
              <circle
                r={markerR}
                fill={m.isSelf ? m.color : "var(--card)"}
                stroke={m.color}
                strokeWidth={2.5}
              />
              <text
                textAnchor="middle"
                dy="0.34em"
                fontSize={Math.round(markerR * 0.85)}
                fill={m.isSelf ? "var(--card)" : m.color}
                className="font-mono"
              >
                {m.initial}
              </text>
            </g>
          )
        })}
      </svg>
      {children && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          {children}
        </div>
      )}
    </div>
  )
}
