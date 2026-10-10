import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge does not know the app's own type scale, so out of the box it
 * reads `text-label` as a colour and drops `text-primary-foreground` beside it —
 * which is how primary buttons ended up with dark text on the ember fill.
 * Registering the scale as font sizes keeps size and colour apart.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        { text: ['micro', 'label', 'body', 'lead', 'title', 'screen', 'display'] },
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
