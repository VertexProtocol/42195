import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'
import { TrackLoader } from '@/components/ui/track-mark'

/**
 * Button — one shape, one press response, every state.
 *
 * default   the single ember action. One per view, ideally.
 * secondary the quiet companion action.
 * ghost     an action that lives inside content.
 * outline   an action on a surface that already carries elevation.
 * danger    destructive, and it says so before it is pressed.
 * link      inline text action.
 *
 * Touch targets never drop below 44px in the `md` and `lg` sizes; `sm` is for
 * controls inside a row that already has a 44px hit area of its own.
 */

const buttonVariants = cva(
  [
    'press inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap',
    'rounded-md font-extrabold tracking-wide',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    'disabled:pointer-events-none disabled:opacity-45',
    'aria-invalid:ring-2 aria-invalid:ring-destructive/50',
  ].join(' '),
  {
    variants: {
      variant: {
        default:
          'chunky uppercase bg-primary text-primary-foreground [--chunk:var(--primary-edge)] hover:brightness-105',
        secondary:
          'chunky uppercase border-2 border-[var(--chunk-edge)] bg-card text-foreground hover:bg-surface-sunken',
        ghost: 'text-foreground hover:bg-surface-sunken active:bg-accent',
        outline:
          'chunky uppercase border-2 border-[var(--chunk-edge)] bg-card text-foreground hover:bg-surface-sunken',
        danger:
          'chunky uppercase bg-destructive text-destructive-foreground [--chunk:var(--destructive-edge)] hover:brightness-105',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-9 px-3 text-micro',
        md: 'h-12 px-5 text-label',
        lg: 'h-14 px-6 text-body',
        icon: 'size-11',
        'icon-sm': 'size-9',
      },
      block: {
        true: 'w-full',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  },
)

type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /** Shows a spinner and disables the control. Keeps the label in place. */
    loading?: boolean
  }

function Button({
  className,
  variant,
  size,
  block,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="button"
      data-loading={loading || undefined}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size, block, className }))}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading && <TrackLoader size={14} />}
          {children}
        </>
      )}
    </Comp>
  )
}

export { Button, buttonVariants }
