'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Meter — progress against a target.
 *
 * The track is a lane on the surface it sits on; the fill is the distance
 * covered. It always reports its value to assistive technology, because the
 * bar itself is the only place some of these numbers appear.
 */

interface MeterProps extends React.ComponentProps<'div'> {
  /** 0–100. Values above 100 are clamped for the fill but kept in the label. */
  value: number
  tone?: 'action' | 'done' | 'caution' | 'quiet'
  size?: 'sm' | 'md'
  /** Accessible name — what this meter measures. */
  label: string
  /** Human-readable value, e.g. "32.4 / 50 km". Read out instead of the raw %. */
  valueText?: string
  /**
   * Optional target band drawn on the track, as 0–100 positions.
   *
   * For scales where the good answer is a range rather than "more", the band
   * is what makes the fill readable: without it, a training load sitting in
   * the sweet spot looks like a job two-thirds done. Purely decorative —
   * `valueText` carries the same information for assistive technology.
   */
  zone?: { from: number; to: number }
}

const toneMap = {
  action: 'bg-primary',
  done: 'bg-success',
  caution: 'bg-warning',
  quiet: 'bg-muted-foreground/50',
}

export function Meter({
  value,
  tone = 'action',
  size = 'md',
  label,
  valueText,
  zone,
  className,
  ...props
}: MeterProps) {
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  const zoneFrom = zone ? Math.max(0, Math.min(100, zone.from)) : 0
  const zoneWidth = zone ? Math.max(0, Math.min(100, zone.to) - zoneFrom) : 0
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={valueText}
      className={cn(
        'relative w-full overflow-hidden rounded-full bg-surface-sunken',
        size === 'sm' ? 'h-1.5' : 'h-2',
        className,
      )}
      {...props}
    >
      {zone && (
        <div
          aria-hidden
          className="absolute inset-y-0 bg-foreground/10"
          style={{ left: `${zoneFrom}%`, width: `${zoneWidth}%` }}
        />
      )}
      {/* Scaled rather than resized: animating width forces layout on every
          frame, and the track already clips the fill to a rounded shape. */}
      <div
        className={cn('relative h-full w-full origin-left', toneMap[tone])}
        style={{
          transform: `scaleX(${pct / 100})`,
          transition: 'transform var(--dur-view) var(--ease-out)',
        }}
      />
      {/* Edges drawn ON TOP of the fill. The shaded band alone disappears
          underneath it exactly when it matters most: a value past the band
          covers the whole thing, leaving no way to see what it was past. */}
      {zone && (
        <>
          <div
            aria-hidden
            className="absolute inset-y-0 w-px bg-foreground/30"
            style={{ left: `${zoneFrom}%` }}
          />
          <div
            aria-hidden
            className="absolute inset-y-0 w-px bg-foreground/30"
            style={{ left: `${zoneFrom + zoneWidth}%` }}
          />
        </>
      )}
    </div>
  )
}
