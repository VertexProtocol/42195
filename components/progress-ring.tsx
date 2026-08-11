"use client"

import { useEffect, useRef, useState } from "react"

/**
 * ProgressRing — the app's one authored motion moment.
 *
 * On first paint the arc draws from zero to its value, the way a lap fills in.
 * It happens once per mount, on the small number of rings that carry the
 * screen's headline state, and it is skipped entirely under reduced motion —
 * where the ring simply arrives at its value.
 *
 * The centre is a slot rather than a fixed label, so callers compose what sits
 * inside it without a second absolutely-positioned layer of their own.
 */

interface ProgressRingProps {
  percentage: number
  size?: number
  strokeWidth?: number
  /** Semantic colour of the arc. */
  tone?: "action" | "done" | "caution" | "quiet"
  /** What this ring measures — used as its accessible name. */
  label: string
  children?: React.ReactNode
}

const toneVar: Record<NonNullable<ProgressRingProps["tone"]>, string> = {
  action: "var(--primary)",
  done: "var(--success)",
  caution: "var(--warning)",
  quiet: "var(--muted-foreground)",
}

export function ProgressRing({
  percentage,
  size = 64,
  strokeWidth = 5,
  tone = "action",
  label,
  children,
}: ProgressRingProps) {
  const target = Math.max(0, Math.min(100, percentage))
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

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

  const offset = circumference - (drawn / 100) * circumference

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label}: ${Math.round(target)}%`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden focusable="false">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--surface-sunken)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={toneVar[tone]}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: "stroke-dashoffset 700ms var(--ease-out)",
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
