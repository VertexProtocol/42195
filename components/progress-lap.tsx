"use client"

import { useEffect, useRef, useState } from "react"

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
  /** What this lap measures — used as its accessible name. */
  label: string
  children?: React.ReactNode
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
  label,
  children,
}: ProgressLapProps) {
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
  const lane = {
    x: strokeWidth / 2,
    y: strokeWidth / 2,
    width: width - strokeWidth,
    height: size - strokeWidth,
    rx: (size - strokeWidth) / 2,
    fill: 'none',
    strokeWidth,
  }

  // A rect's path starts at the left end of the top straight and runs
  // clockwise. The start line is the far end of that straight — where the home
  // straight meets the first bend — and the fill runs backwards from it, which
  // puts the kerb on the runner's left.
  const bend = Math.PI * lane.rx
  const straight = lane.width - 2 * lane.rx
  const startLine = (straight / (2 * straight + 2 * bend)) * 100

  return (
    <div
      className="relative shrink-0"
      style={{ width, height: size }}
      role="img"
      aria-label={`${label}: ${Math.round(target)}%`}
    >
      <svg width={width} height={size} aria-hidden focusable="false">
        <rect {...lane} stroke="var(--surface-sunken)" />
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
      </svg>
      {children && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          {children}
        </div>
      )}
    </div>
  )
}
