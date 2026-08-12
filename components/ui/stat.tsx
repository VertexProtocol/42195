import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Stat — a measurement with its unit and its name.
 *
 * Deliberately not a tile: no container, no icon chip. Stats sit in a row
 * separated by hairlines so a group of three reads as one instrument panel
 * rather than three cards. The value is the only thing at display weight.
 */

interface StatProps extends React.ComponentProps<'div'> {
  label: string
  value: React.ReactNode
  /** Unit or qualifier, set small and quiet beside the value. */
  unit?: string
  tone?: 'default' | 'positive' | 'caution' | 'negative'
  /**
   * Optional context under the label — a target, a bar, a delta.
   *
   * A slot rather than a `target` prop, so a Stat never has to know what kind
   * of context it is carrying. Whatever goes here is secondary by construction:
   * the value above it is still the only thing at display weight.
   */
  children?: React.ReactNode
}

const toneMap = {
  default: 'text-foreground',
  positive: 'text-success',
  caution: 'text-warning',
  negative: 'text-destructive',
}

export function Stat({
  label,
  value,
  unit,
  tone = 'default',
  className,
  children,
  ...props
}: StatProps) {
  return (
    <div className={cn('min-w-0', className)} {...props}>
      <p className="flex items-baseline gap-1">
        <span className={cn('measure text-title font-semibold leading-none', toneMap[tone])}>
          {value}
        </span>
        {unit && (
          <span className="text-micro font-medium text-muted-foreground">{unit}</span>
        )}
      </p>
      <p className="mt-1.5 truncate text-micro text-muted-foreground">{label}</p>
      {children && <div className="mt-2">{children}</div>}
    </div>
  )
}

/**
 * StatGroup — two to four Stats separated by hairlines. The divider is what
 * groups them; there is no card per stat.
 */
export function StatGroup({
  className,
  children,
  dividers = true,
  ...props
}: React.ComponentProps<'div'> & {
  /**
   * Hairlines between the columns.
   *
   * Off where the group shares a card with content that comes and goes: a
   * ruled column is a promise that the shape is fixed, and a card the runner
   * adds and removes things from cannot keep it. Spacing groups them instead.
   */
  dividers?: boolean
}) {
  const items = React.Children.toArray(children).filter(Boolean)
  return (
    <div
      className={cn('grid', !dividers && 'gap-4', className)}
      style={{ gridTemplateColumns: `repeat(${items.length || 1}, minmax(0, 1fr))` }}
      {...props}
    >
      {items.map((child, i) =>
        dividers ? (
          <div key={i} className={i > 0 ? 'border-l border-border pl-4' : 'pr-4'}>
            {child}
          </div>
        ) : (
          <div key={i}>{child}</div>
        ),
      )}
    </div>
  )
}
