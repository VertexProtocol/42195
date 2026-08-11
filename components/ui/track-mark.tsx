import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * The app's mark, still and running.
 *
 * One drawing, two intents. `TrackMark` is the icon without its ground — a
 * stadium lane with the ember lead arc at the top bend — and stands in for the
 * app on the signed-out screens, beside the wordmark. `TrackLoader` is the same
 * lane with the arc running it, which is the only honest thing a spinner can
 * say: work is in progress and nobody knows how far along it is.
 *
 * The loader draws both parts in `currentColor` so it takes the tone of
 * whatever it sits in — the chalk of a primary button, the ember of the sync
 * indicator — with the unlit lane held back. The mark keeps the icon's own
 * pairing instead: the lane in `currentColor`, the arc in the ember.
 */

// A 42×24 stadium inside a 48×30 box: the 4-unit stroke is centred on the
// path, so the box has exactly one unit of air on every side.
const BOX = { w: 48, h: 30 }
const LANE = {
  x: 3,
  y: 3,
  width: 42,
  height: 24,
  rx: 12,
  fill: 'none',
  strokeWidth: 4,
} as const

// A quarter of the lane, lit. `pathLength` normalises the perimeter to 100, so
// the dash and the `lap` keyframe are in the same units at any rendered size.
const LEAD = {
  ...LANE,
  strokeLinecap: 'round',
  pathLength: 100,
  strokeDasharray: '25 75',
  strokeDashoffset: -5,
} as const

interface MarkProps extends React.ComponentProps<'svg'> {
  /** Height in px. The mark is 1.6× as wide as it is tall. */
  size?: number
}

interface TrackMarkProps extends MarkProps {
  /** Sends the lead arc round the lane, for a screen that is only a wait. */
  running?: boolean
}

function frame(size: number, style: React.CSSProperties | undefined) {
  return {
    viewBox: `0 0 ${BOX.w} ${BOX.h}`,
    // Inline, not a utility class: the mark is wider than it is tall, and every
    // icon slot in the app squares its svg children off at `size-4`.
    style: { height: size, width: (size * BOX.w) / BOX.h, ...style },
  }
}

export function TrackMark({
  size = 20,
  running = false,
  className,
  style,
  ...props
}: TrackMarkProps) {
  return (
    <svg
      {...frame(size, style)}
      aria-hidden
      className={cn('shrink-0', className)}
      {...props}
    >
      <rect {...LANE} stroke="currentColor" />
      <rect {...LEAD} className={cn('stroke-primary', running && 'animate-lap')} />
    </svg>
  )
}

interface TrackLoaderProps extends MarkProps {
  /**
   * Accessible name. Given one, the loader announces itself as a live status;
   * left out, it is decoration and the surrounding control does the talking.
   */
  label?: string
}

export function TrackLoader({ size = 16, label, className, style, ...props }: TrackLoaderProps) {
  return (
    <svg
      {...frame(size, style)}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('shrink-0', className)}
      {...props}
    >
      <rect {...LANE} stroke="currentColor" opacity={0.25} />
      <rect {...LEAD} stroke="currentColor" className="animate-lap" />
    </svg>
  )
}
