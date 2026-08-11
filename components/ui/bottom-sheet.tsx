"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * BottomSheet — the app's one editing surface.
 *
 * The three editors previously each hand-rolled `fixed inset-0 bg-black/50`,
 * which meant no focus trap, no Escape, no scroll lock and nothing announced
 * to a screen reader. They now share this one, built on the dialog primitive
 * that already ships in the project.
 *
 * It slides from the bottom because that is where a thumb is, and it stops
 * short of full height so the sheet reads as sitting on top of the screen it
 * came from rather than replacing it.
 */

interface BottomSheetProps {
  open: boolean
  onClose: () => void
  title: string
  /** Optional supporting line under the title. */
  description?: string
  /** Rendered opposite the close button, e.g. a delete action. */
  headerAction?: React.ReactNode
  children: React.ReactNode
  closeLabel?: string
}

export function BottomSheet({
  open,
  onClose,
  title,
  description,
  headerAction,
  children,
  closeLabel = "Close",
}: BottomSheetProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-[oklch(0.15_0.01_50_/_0.5)]",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] w-full max-w-md flex-col",
            "rounded-t-[1.25rem] bg-card text-card-foreground shadow-e2",
            "data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom",
            "data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom",
            "duration-200",
          )}
        >
          {/* A grab handle, because this sheet is dragged as often as it is
              dismissed with the button. */}
          <div className="flex justify-center pb-1 pt-2.5" aria-hidden>
            <span className="h-1 w-9 rounded-full bg-border" />
          </div>

          <div className="flex items-start gap-3 px-5 pb-3 pt-1">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-lead font-semibold text-card-foreground">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-0.5 text-micro text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
              )}
            </div>
            {headerAction}
            <DialogPrimitive.Close
              aria-label={closeLabel}
              className="press -mr-1 flex size-9 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-surface-sunken hover:text-foreground"
            >
              <X size={17} />
            </DialogPrimitive.Close>
          </div>

          <div
            className="min-h-0 flex-1 overflow-y-auto px-5 pt-1"
            style={{ paddingBottom: "max(1.75rem, env(safe-area-inset-bottom))" }}
          >
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
