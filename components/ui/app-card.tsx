import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * AppCard — the single source of truth for card styling in this app.
 *
 * Variants
 * ─────────
 * default   rounded-2xl bg-card p-{padding} shadow-sm ring-1 ring-border
 *           Use for: stat cards, summary cards, section content cards.
 *
 * flush     Same as default but overflow-hidden and no padding.
 *           Children own their own padding (e.g. list rows, divider sections).
 *           Use for: activity rows, settings sections, historical lists.
 *
 * featured  Gradient bg with primary ring.
 *           Use for: AI coach card, highlighted CTAs.
 *
 * Padding (ignored for flush/featured — those manage their own)
 * ───────
 * sm  → p-3    compact cards
 * md  → p-4    standard (default)
 * lg  → p-5    spacious / empty-state cards
 *
 * State (applies a coloured ring, replaces the default ring-border)
 * ─────
 * idle     → ring-1 ring-border   (default)
 * active   → ring-2 ring-primary/40
 * complete → ring-2 ring-success/40
 *
 * Interactive
 * ───────────
 * Pass interactive to add a subtle press scale for tappable cards.
 */

export type AppCardVariant = 'default' | 'flush' | 'featured'
export type AppCardPadding = 'sm' | 'md' | 'lg'
export type AppCardState = 'idle' | 'active' | 'complete'

interface AppCardProps extends React.ComponentProps<'div'> {
  variant?: AppCardVariant
  padding?: AppCardPadding
  state?: AppCardState
  interactive?: boolean
}

const paddingMap: Record<AppCardPadding, string> = {
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
}

const stateRingMap: Record<AppCardState, string> = {
  idle: 'ring-1 ring-border',
  active: 'ring-2 ring-primary/40',
  complete: 'ring-2 ring-success/40',
}

export function AppCard({
  variant = 'default',
  padding = 'md',
  state = 'idle',
  interactive = false,
  className,
  ...props
}: AppCardProps) {
  if (variant === 'featured') {
    return (
      <div
        className={cn(
          'rounded-2xl bg-gradient-to-r from-primary/10 to-primary/5 p-5 shadow-sm ring-1 ring-primary/20',
          interactive && 'active:scale-[0.98] transition-transform cursor-pointer',
          className,
        )}
        {...props}
      />
    )
  }

  return (
    <div
      className={cn(
        'rounded-2xl bg-card shadow-sm transition-all',
        stateRingMap[state],
        variant === 'flush' ? 'overflow-hidden' : paddingMap[padding],
        interactive && 'active:scale-[0.98]',
        className,
      )}
      {...props}
    />
  )
}
