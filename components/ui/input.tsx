import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Input — a sunken well on the surface, not a floating box.
 *
 * 16px text on mobile so iOS never zooms the viewport on focus, and a caret
 * tinted from the accent (set globally) so the text field belongs to the same
 * world as the buttons.
 */

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-11 w-full min-w-0 rounded-md bg-surface-sunken px-3 text-base text-foreground',
        'placeholder:text-muted-foreground',
        'outline-none transition-[box-shadow] duration-150',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:ring-2 aria-invalid:ring-destructive/50',
        'file:mr-2 file:inline-flex file:h-8 file:border-0 file:bg-transparent file:text-label file:font-medium file:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
