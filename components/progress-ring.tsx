"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * ProgressRing — a circular progress meter.
 *
 * The ring renders its own centred content. Previously the overlay was
 * `absolute` inside a container that was never `relative`, so it escaped to
 * whatever positioned ancestor happened to be nearby; every call site worked
 * around that by wrapping the ring in its own `relative` box and repeating
 * the centring markup. Pass `children` instead:
 *
 *   <ProgressRing percentage={62} size={64}>
 *     <span className="text-xs font-bold tnum">62%</span>
 *   </ProgressRing>
 *
 * The sweep animates from empty on mount, which turns a static number into a
 * small piece of feedback. Under `prefers-reduced-motion` the global rule in
 * globals.css collapses it to a single frame.
 */

type RingTone = "primary" | "success" | "warning" | "destructive"

const toneClass: Record<RingTone, string> = {
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
}

interface ProgressRingProps {
  percentage: number
  size?: number
  strokeWidth?: number
  tone?: RingTone
  /** Centred content. Takes precedence over `label` / `sublabel`. */
  children?: React.ReactNode
  label?: string
  sublabel?: string
  /** Screen-reader description, e.g. "38 of 60 km". Defaults to "N%". */
  valueText?: string
  className?: string
}

export function ProgressRing({
  percentage,
  size = 120,
  strokeWidth = 8,
  tone = "primary",
  children,
  label,
  sublabel,
  valueText,
  className,
}: ProgressRingProps) {
  // Guard against NaN from a divide-by-zero upstream, which would otherwise
  // produce an invalid stroke-dashoffset and blank the ring entirely.
  const pct = Number.isFinite(percentage) ? Math.min(100, Math.max(0, percentage)) : 0

  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  // Start empty, then sweep to the real value one frame later so the browser
  // has an initial value to transition from.
  const [shown, setShown] = React.useState(0)
  React.useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(pct))
    return () => cancelAnimationFrame(raf)
  }, [pct])

  const offset = circumference - (shown / 100) * circumference

  return (
    <div
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={valueText ?? `${Math.round(pct)}%`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-foreground/10"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={cn(
            "transition-[stroke-dashoffset] duration-[var(--dur-slow)] ease-[var(--ease-out-quint)]",
            toneClass[tone],
          )}
        />
      </svg>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        {children ?? (
          <>
            {label && <span className="tnum text-lg font-semibold text-foreground">{label}</span>}
            {sublabel && <span className="text-xs text-muted-foreground">{sublabel}</span>}
          </>
        )}
      </div>
    </div>
  )
}
