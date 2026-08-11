import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * AppCard — the only card surface in the app.
 *
 * One elevation system: `.surface` carries a shadow in light mode and a lit
 * edge in dark mode. Never a hairline border *and* a shadow, and never a card
 * inside another card — a nested group is expressed with a divider, a heading,
 * or space, not with a second container.
 *
 * variant
 *   plain    padded surface. The default.
 *   rows     no padding, clips children. For divided row lists; each row owns
 *            its own padding.
 *   quiet    a sunken, unelevated well. Use *inside* a card where a nested
 *            card would otherwise be reached for.
 *
 * tone       adds a state edge without changing the elevation system.
 */

export type AppCardVariant = 'plain' | 'rows' | 'quiet'
export type AppCardPadding = 'sm' | 'md' | 'lg'
export type AppCardTone = 'neutral' | 'action' | 'done' | 'caution'

interface AppCardProps extends React.ComponentProps<'div'> {
  variant?: AppCardVariant
  padding?: AppCardPadding
  tone?: AppCardTone
  interactive?: boolean
}

const paddingMap: Record<AppCardPadding, string> = {
  sm: 'p-3.5',
  md: 'p-4',
  lg: 'p-5',
}

const toneMap: Record<AppCardTone, string> = {
  neutral: '',
  action: 'ring-1 ring-primary/40',
  done: 'ring-1 ring-success/40',
  caution: 'ring-1 ring-warning/40',
}

export function AppCard({
  variant = 'plain',
  padding = 'md',
  tone = 'neutral',
  interactive = false,
  className,
  ...props
}: AppCardProps) {
  if (variant === 'quiet') {
    return (
      <div
        className={cn(
          'rounded-md bg-surface-sunken',
          paddingMap[padding],
          tone !== 'neutral' && toneMap[tone],
          interactive && 'press',
          className,
        )}
        {...props}
      />
    )
  }

  return (
    <div
      className={cn(
        'surface',
        variant === 'rows' ? 'overflow-hidden' : paddingMap[padding],
        tone !== 'neutral' && toneMap[tone],
        interactive && 'press',
        className,
      )}
      {...props}
    />
  )
}

/** A single row inside an `AppCard variant="rows"` list. */
export function CardRow({
  className,
  divider = true,
  ...props
}: React.ComponentProps<'div'> & { divider?: boolean }) {
  return (
    <div
      className={cn(
        'px-4 py-3.5',
        divider && 'border-b border-border last:border-b-0',
        className,
      )}
      {...props}
    />
  )
}
