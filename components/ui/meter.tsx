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
  className,
  ...props
}: MeterProps) {
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={valueText}
      className={cn(
        'w-full overflow-hidden rounded-full bg-surface-sunken',
        size === 'sm' ? 'h-1.5' : 'h-2',
        className,
      )}
      {...props}
    >
      {/* Scaled rather than resized: animating width forces layout on every
          frame, and the track already clips the fill to a rounded shape. */}
      <div
        className={cn('h-full w-full origin-left', toneMap[tone])}
        style={{
          transform: `scaleX(${pct / 100})`,
          transition: 'transform var(--dur-view) var(--ease-out)',
        }}
      />
    </div>
  )
}
