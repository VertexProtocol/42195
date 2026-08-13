"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * PromptDialog — a small centred window that asks one thing.
 *
 * The app's other modal surface, `BottomSheet`, is for editing: it comes up
 * from where the thumb is, it is nearly full height, and it holds a form. This
 * is the other job — a prompt that interrupts, says one thing, and leaves. A
 * bottom sheet at that job is a large surface holding a paragraph, and it
 * reads as somewhere you have arrived rather than something being asked.
 *
 * The scrim blurs what is behind it. `DESIGN.md` refuses backdrop blur as
 * decoration, and this is not that: the page behind a prompt is not content
 * any more, and putting it out of focus is what says so. It sits on top of the
 * usual dark scrim rather than instead of it, so contrast never depends on the
 * blur — a browser that ignores `backdrop-filter` still gets a readable
 * dialog.
 */

interface PromptDialogProps {
  open: boolean
  onClose: () => void
  title: string
  /** Optional supporting line under the title. */
  description?: string
  children: React.ReactNode
  /** Rendered along the bottom edge: the step's controls. */
  footer?: React.ReactNode
  closeLabel?: string
}

export function PromptDialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  closeLabel = "Close",
}: PromptDialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-[oklch(0.15_0.01_50_/_0.45)] backdrop-blur-[3px]",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            // Centred, and narrow enough that it reads as a note on top of the
            // app rather than a screen replacing it.
            "fixed left-1/2 top-1/2 z-50 flex w-[calc(100%-2.5rem)] max-w-[19.5rem]",
            "max-h-[80dvh] -translate-x-1/2 -translate-y-1/2 flex-col",
            "rounded-[1.25rem] bg-card text-card-foreground shadow-e2",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            "duration-200",
          )}
        >
          <div className="flex items-start gap-2 px-5 pb-2 pt-5">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-lead font-semibold text-card-foreground">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1 text-micro leading-relaxed text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              aria-label={closeLabel}
              className="press -mr-2 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-surface-sunken hover:text-foreground"
            >
              <X size={16} />
            </DialogPrimitive.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-1">{children}</div>

          {footer && (
            <div
              className="px-5 pt-4"
              style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
            >
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
