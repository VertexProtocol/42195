import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * TrackLoader — the app's own mark, running.
 *
 * The icon is a stadium lane with one ember lead arc frozen at the top bend.
 * Here the arc runs the lap, which is the only honest thing a spinner can say:
 * work is in progress and nobody knows how far along it is.
 *
 * Everything is drawn in `currentColor`, so it takes the tone of whatever it
 * sits in — the ember of a link, the chalk of a primary button — and the lane
 * behind it is the same colour held back. Callers that want the accent set
 * `text-primary` on it.
 */

interface TrackLoaderProps extends React.ComponentProps<'svg'> {
  /** Height in px. The mark is 1.6× as wide as it is tall. */
  size?: number
  /**
   * Accessible name. Given one, the loader announces itself as a live status;
   * left out, it is decoration and the surrounding control does the talking.
   */
  label?: string
}

// A 42×24 stadium inside a 48×30 box: the 4-unit stroke is centred on the
// path, so the box has exactly one unit of air on every side.
const BOX = { w: 48, h: 30 }
const LANE = { x: 3, y: 3, w: 42, h: 24, r: 12, stroke: 4 }

export function TrackLoader({ size = 16, label, className, style, ...props }: TrackLoaderProps) {
  const lane = {
    x: LANE.x,
    y: LANE.y,
    width: LANE.w,
    height: LANE.h,
    rx: LANE.r,
    fill: 'none',
    strokeWidth: LANE.stroke,
  }

  return (
    <svg
      viewBox={`0 0 ${BOX.w} ${BOX.h}`}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('shrink-0', className)}
      // Inline, not a utility class: the mark is wider than it is tall, and
      // every icon slot in the app squares its svg children off at `size-4`.
      style={{ height: size, width: (size * BOX.w) / BOX.h, ...style }}
      {...props}
    >
      <rect {...lane} stroke="currentColor" opacity={0.25} />
      {/* A quarter of the lane, lit. `pathLength` normalises the perimeter to
          100 so the dash and the keyframe are in the same units whatever the
          rendered size. */}
      <rect
        {...lane}
        stroke="currentColor"
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray="25 75"
        strokeDashoffset={-5}
        className="animate-lap"
      />
    </svg>
  )
}
