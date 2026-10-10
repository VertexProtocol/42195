import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * EmptyState — teaches the surface rather than announcing that it is empty.
 * A centred tile: a round icon badge, a short title, one line, one button.
 */

interface EmptyStateProps extends React.ComponentProps<'div'> {
  icon?: React.ReactNode
  title: string
  body?: string
  action?: React.ReactNode
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'surface flex flex-col items-center gap-2 px-5 py-7 text-center',
        className,
      )}
      {...props}
    >
      {icon && (
        <span className="flex size-14 items-center justify-center rounded-full bg-primary/12 text-primary [&_svg]:size-7">
          {icon}
        </span>
      )}
      <p className="text-lead font-extrabold text-foreground">{title}</p>
      {body && (
        <p className="max-w-[34ch] text-label leading-relaxed text-muted-foreground">
          {body}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
