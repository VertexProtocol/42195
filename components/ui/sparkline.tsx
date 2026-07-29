"use client"

import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Sparkline — a bar per day, scaled to the largest day in the window.
 *
 * Built from flex children rather than SVG: at these sizes an SVG's rounded
 * caps distort under non-uniform scaling, and CSS gives crisp 1px-aligned
 * bars for free.
 *
 * Two deliberate choices:
 *   - A day with no training still draws a 2px stub. An absent bar and a
 *     zero bar look identical otherwise, and "I rested Tuesday" is
 *     information.
 *   - The final bar is the brand colour and the rest are muted, so the
 *     chart answers "how does today compare?" without a legend or an axis.
 *
 * Treated as an image for assistive tech: the shape is decorative, and the
 * numbers it summarises are already stated in the metrics beside it.
 */

interface SparklineProps extends Omit<React.ComponentProps<'div'>, 'children'> {
  values: number[]
  /** Height of the plot area in pixels. */
  height?: number
  /** Emphasise the most recent bar. */
  highlightLast?: boolean
  /** Screen-reader summary, e.g. "Distance over the last 7 days". */
  label?: string
}

export function Sparkline({
  values,
  height = 28,
  highlightLast = true,
  label,
  className,
  ...props
}: SparklineProps) {
  const max = Math.max(...values, 0)

  return (
    <div
      role="img"
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('flex items-stretch gap-[3px]', className)}
      style={{ height }}
      {...props}
    >
      {values.map((v, i) => {
        const isLast = highlightLast && i === values.length - 1
        // Scale into 8–100% so a small-but-nonzero day still reads as a bar
        // rather than as a rounding artefact next to a big one.
        const pct = max > 0 && v > 0 ? Math.max(8, (v / max) * 100) : 0
        return (
          // Each value owns an equal-width column and the bar is centred in
          // it, capped narrow. Letting the bar fill the column instead turns
          // seven days across a phone into 45px-wide lozenges — a bar chart,
          // not a sparkline, and one that dwarfs the figures above it.
          <div key={i} className="flex flex-1 items-end justify-center">
            <div
              className={cn(
                'min-h-[2px] w-full max-w-[9px] rounded-[3px] transition-[height] duration-[var(--dur-slow)] ease-[var(--ease-out-quint)]',
                v === 0 ? 'bg-foreground/10' : isLast ? 'bg-primary' : 'bg-foreground/25',
              )}
              style={{ height: `${pct}%` }}
            />
          </div>
        )
      })}
    </div>
  )
}
