import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * AppCard — the single source of truth for card styling in this app.
 *
 * Variants
 * ─────────
 * default   Padded surface. Stat cards, summary cards, section content.
 * flush     Same surface, no padding, clips children. Children own their
 *           padding (list rows, settings sections, divided lists).
 * featured  Brand-tinted surface with a brand border. AI coach card,
 *           highlighted CTAs. One per screen, at most.
 *
 * Elevation
 * ─────────
 * flat      Border only. Use when the card sits inside another card, or
 *           when a grid of cards would otherwise turn into a shadow field.
 * raised    Border + contact shadow. The default.
 * lifted    Border + ambient shadow. Only for the one element on a screen
 *           that should read as floating above the rest.
 *
 * Padding (ignored by `flush`, which has none by definition)
 * ───────
 * sm → p-3   compact          md → p-4   standard (default)
 * lg → p-5   spacious / empty states
 *
 * State — a coloured border replacing the neutral one
 * ─────
 * idle · active · complete
 *
 * Interactive
 * ───────────
 * `interactive` adds the shared `.press` depress. Pass it whenever the
 * card itself is tappable, so a card, a list row and a tab all respond
 * identically to touch.
 */

export type AppCardVariant = 'default' | 'flush' | 'featured'
export type AppCardPadding = 'sm' | 'md' | 'lg'
export type AppCardState = 'idle' | 'active' | 'complete'
export type AppCardElevation = 'flat' | 'raised' | 'lifted'

interface AppCardProps extends React.ComponentProps<'div'> {
  variant?: AppCardVariant
  padding?: AppCardPadding
  state?: AppCardState
  elevation?: AppCardElevation
  interactive?: boolean
}

const paddingMap: Record<AppCardPadding, string> = {
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
}

const elevationMap: Record<AppCardElevation, string> = {
  flat: '',
  raised: 'shadow-e1',
  lifted: 'shadow-e2',
}

const stateBorderMap: Record<AppCardState, string> = {
  idle: 'border-border',
  active: 'border-primary/45',
  complete: 'border-success/45',
}

export function AppCard({
  variant = 'default',
  padding = 'md',
  state = 'idle',
  elevation = 'raised',
  interactive = false,
  className,
  ...props
}: AppCardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border',
        variant === 'featured'
          ? 'border-primary/25 bg-primary-subtle'
          : cn('bg-card', stateBorderMap[state]),
        elevationMap[elevation],
        variant === 'flush' ? 'overflow-hidden' : paddingMap[variant === 'featured' ? 'lg' : padding],
        interactive && 'press cursor-pointer',
        className,
      )}
      {...props}
    />
  )
}
