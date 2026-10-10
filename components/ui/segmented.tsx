import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Segmented — two or three halves of one screen, as a chunky pill switch.
 * The selected half is a raised chalk tile; the rest sit in the well.
 */
interface SegmentedProps<T extends string> {
  options: readonly (readonly [T, string])[]
  value: T
  onChange: (value: T) => void
  label: string
  className?: string
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        'flex gap-1 rounded-md border-2 border-[var(--chunk-edge)] bg-surface-sunken p-1',
        className,
      )}
    >
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={cn(
            'press h-10 flex-1 rounded-[0.625rem] text-label font-extrabold uppercase tracking-wide',
            value === key
              ? 'bg-card text-primary shadow-[0_2px_0_0_var(--chunk-edge)]'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
