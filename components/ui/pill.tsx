import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Pill — a short status or category marker.
 *
 * One shape for every status in the app, so "synced", "recurring", "block
 * done" and "test run" are recognisably the same kind of thing. Tones map to
 * the semantic vocabulary, never to an ad-hoc colour picked per feature.
 */

export type PillTone =
  | 'neutral'
  | 'action'
  | 'positive'
  | 'caution'
  | 'negative'
  | 'data'

const toneMap: Record<PillTone, string> = {
  neutral: 'bg-surface-sunken text-secondary-foreground',
  action: 'bg-primary/12 text-primary',
  positive: 'bg-success/14 text-success',
  caution: 'bg-warning/16 text-warning',
  negative: 'bg-destructive/12 text-destructive',
  data: 'bg-[color-mix(in_oklch,var(--chart-4)_14%,transparent)] text-[var(--chart-4)]',
}

interface PillProps extends React.ComponentProps<'span'> {
  tone?: PillTone
  icon?: React.ReactNode
}

export function Pill({
  tone = 'neutral',
  icon,
  className,
  children,
  ...props
}: PillProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-micro font-semibold',
        toneMap[tone],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </span>
  )
}
