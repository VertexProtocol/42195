import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Section — the page's spacing rhythm, in one place.
 *
 * A heading binds to the content it introduces, so the space above a section
 * is always larger than the space between its heading and its body. Screens
 * stack Sections in a `space-y-*` column and never hand-roll the interval.
 */

export function Section({ className, ...props }: React.ComponentProps<'section'>) {
  return <section className={cn('flex flex-col gap-2.5', className)} {...props} />
}

interface SectionHeaderProps extends React.ComponentProps<'div'> {
  title: string
  /** Short supporting line. Kept to one line on a phone. */
  hint?: string
  /** Right-hand affordance: a link-style action, a count, a switcher. */
  action?: React.ReactNode
}

export function SectionHeader({
  title,
  hint,
  action,
  className,
  ...props
}: SectionHeaderProps) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3', className)} {...props}>
      <div className="min-w-0">
        <h2 className="text-label font-semibold text-foreground">{title}</h2>
        {hint && <p className="mt-0.5 text-micro text-muted-foreground">{hint}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/** A quiet text button used as a SectionHeader action. */
export function SectionAction({
  className,
  ...props
}: React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={cn(
        'press -mr-1 rounded-sm px-1 py-0.5 text-label font-semibold text-primary hover:text-primary/80',
        className,
      )}
      {...props}
    />
  )
}
