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
  ...props
}: React.ComponentProps<'div'>) {
  const items = React.Children.toArray(children).filter(Boolean)
  return (
    <div
      className={cn('grid', className)}
      style={{ gridTemplateColumns: `repeat(${items.length || 1}, minmax(0, 1fr))` }}
      {...props}
    >
      {items.map((child, i) => (
        <div
          key={i}
          className={i > 0 ? 'border-l border-border pl-4' : 'pr-4'}
        >
          {child}
        </div>
      ))}
    </div>
  )
}
