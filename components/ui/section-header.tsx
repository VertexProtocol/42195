import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * SectionHeader — the label above a group of content.
 *
 * Every screen had its own hand-rolled version of this: same micro-caps
 * treatment, slightly different sizes, margins and action-link styling.
 * One component keeps the vertical rhythm identical down a scrolling page,
 * which is most of what makes a long screen feel composed rather than
 * assembled.
 *
 * The action is a real <button> with a 44px touch target hidden behind a
 * negative margin, so it stays tappable without visually growing.
 */

interface SectionHeaderProps extends Omit<React.ComponentProps<'div'>, 'title'> {
  title: React.ReactNode
  /** Small leading glyph, e.g. a star on the pinned-goals section. */
  icon?: React.ReactNode
  /** Right-aligned text, e.g. a count. Ignored when `action` is set. */
  meta?: React.ReactNode
  action?: { label: string; onClick: () => void }
}

export function SectionHeader({
  title,
  icon,
  meta,
  action,
  className,
  ...props
}: SectionHeaderProps) {
  return (
    <div className={cn('mb-3 flex min-h-6 items-center justify-between gap-3', className)} {...props}>
      <div className="flex min-w-0 items-center gap-1.5">
        {icon}
        <h2 className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {title}
        </h2>
      </div>

      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="press -my-2 -mr-2 shrink-0 rounded-lg px-2 py-2 text-xs font-semibold text-primary"
        >
          {action.label}
        </button>
      ) : meta ? (
        <span className="shrink-0 text-xs text-subtle-foreground">{meta}</span>
      ) : null}
    </div>
  )
}
