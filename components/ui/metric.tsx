import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Metric — the app's one way of printing a number.
 *
 * Three rules, applied everywhere so figures line up across cards:
 *   1. The value is tabular. Digits share a width, so a number that ticks
 *      or animates never nudges its neighbours.
 *   2. The unit is a separate, smaller, muted span rather than part of the
 *      string. "47.2 km" set at one size reads as prose; a large 47.2 with
 *      a small km reads as an instrument.
 *   3. The label is micro-caps below the value — it names the number, it
 *      does not compete with it.
 *
 * Sizes map to a fixed scale rather than free-form classes so a stat tile
 * on Home and a stat tile on Activities cannot drift apart.
 */

export type MetricSize = 'sm' | 'md' | 'lg' | 'xl'

const valueSize: Record<MetricSize, string> = {
  sm: 'text-base',
  md: 'text-xl',
  lg: 'text-2xl',
  xl: 'text-4xl',
}

const unitSize: Record<MetricSize, string> = {
  sm: 'text-[10px]',
  md: 'text-xs',
  lg: 'text-sm',
  xl: 'text-base',
}

interface MetricProps extends Omit<React.ComponentProps<'div'>, 'children'> {
  value: React.ReactNode
  unit?: string
  label?: string
  size?: MetricSize
  /** Renders the value in the brand colour. For the one figure that matters most. */
  emphasis?: boolean
  align?: 'start' | 'center'
}

export function Metric({
  value,
  unit,
  label,
  size = 'md',
  emphasis = false,
  align = 'start',
  className,
  ...props
}: MetricProps) {
  return (
    <div
      className={cn('flex flex-col gap-0.5', align === 'center' && 'items-center text-center', className)}
      {...props}
    >
      <div className="flex items-baseline gap-1">
        <span
          data-metric
          className={cn(
            'font-semibold leading-none tracking-display',
            valueSize[size],
            emphasis ? 'text-primary' : 'text-card-foreground',
          )}
        >
          {value}
        </span>
        {unit && (
          <span className={cn('font-medium leading-none text-subtle-foreground', unitSize[size])}>
            {unit}
          </span>
        )}
      </div>
      {label && (
        <span className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">
          {label}
        </span>
      )}
    </div>
  )
}

/**
 * MetricRow — several metrics side by side, separated by hairlines rather
 * than by boxes. Three stat cards in a row is three borders, three shadows
 * and three background fills to say one thing; a single card divided by
 * two lines says it with a quarter of the ink.
 */
export function MetricRow({ className, children, ...props }: React.ComponentProps<'div'>) {
  const items = React.Children.toArray(children).filter(Boolean)
  return (
    <div className={cn('flex items-stretch', className)} {...props}>
      {items.map((child, i) => (
        <React.Fragment key={i}>
          {i > 0 && <div aria-hidden className="my-0.5 w-px shrink-0 bg-border" />}
          <div className="flex min-w-0 flex-1 justify-center px-2">{child}</div>
        </React.Fragment>
      ))}
    </div>
  )
}
