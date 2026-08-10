import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * EmptyState — teaches the surface rather than announcing that it is empty.
 *
 * No icon tile above a heading: the icon sits inline with the title at the
 * same optical weight, and the copy says what to do next.
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
        'flex flex-col items-start gap-2 rounded-lg border border-dashed border-border px-4 py-5',
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-2">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        <p className="text-body font-semibold text-foreground">{title}</p>
      </div>
      {body && (
        <p className="max-w-[46ch] text-label leading-relaxed text-muted-foreground">
          {body}
        </p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
