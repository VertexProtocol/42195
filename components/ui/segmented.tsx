import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Segmented — quiet, flat controls with a contrasting selected surface.
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
  const index = Math.max(
    0,
    options.findIndex(([key]) => key === value),
  )
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        'relative flex rounded-md bg-surface-sunken p-1',
        className,
      )}
    >
      {/* One tile that slides to the chosen half, rather than each half
          switching its own background on and off. */}
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 rounded-[0.625rem] bg-card"
        style={{
          width: `calc((100% - 0.5rem) / ${options.length})`,
          transform: `translateX(${index * 100}%)`,
          transition: 'transform var(--dur-state) var(--ease-out)',
        }}
      />
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={cn(
            'press relative h-10 flex-1 rounded-[0.625rem] text-label font-semibold',
            value === key ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
