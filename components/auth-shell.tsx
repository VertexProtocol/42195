"use client"

import * as React from "react"
import { TrackMark } from "@/components/ui/track-mark"
import { cn } from "@/lib/utils"

/**
 * AuthShell — one frame for every signed-out screen.
 *
 * The five auth pages previously each hand-rolled their own heading sizes,
 * input borders and button styles, so signing up looked like a different
 * product from signing in. They now share this frame and the app's primitives.
 */

export function AuthShell({
  title,
  lede,
  children,
  footer,
  id,
}: {
  title: string
  lede?: string
  children: React.ReactNode
  footer?: React.ReactNode
  id?: string
}) {
  return (
    <div id={id} className="flex min-h-dvh flex-col justify-center bg-background px-5 py-10">
      <main className="mx-auto w-full max-w-sm">
        {/* The mark and the wordmark as one line: signed out is the only place
            the app has to say which app it is. */}
        <div className="flex items-center gap-2">
          <TrackMark size={17} className="text-muted-foreground" />
          <p className="measure text-label font-bold tracking-[-0.03em] text-muted-foreground">
            42195
          </p>
        </div>
        <h1 className="mt-5 text-screen font-semibold text-foreground">{title}</h1>
        {lede && (
          <p className="mt-2 max-w-[46ch] text-body leading-relaxed text-muted-foreground">
            {lede}
          </p>
        )}
        <div className="mt-7">{children}</div>
        {footer && <div className="mt-7 text-label text-muted-foreground">{footer}</div>}
      </main>
    </div>
  )
}

/** An inline, non-blocking error tied to the form it belongs to. */
export function AuthError({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-md bg-destructive/12 px-3 py-2.5 text-label leading-relaxed text-destructive"
    >
      {children}
    </p>
  )
}

export function Field({
  id,
  label,
  hint,
  className,
  children,
}: {
  id: string
  label: string
  hint?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-label font-medium text-foreground">
        {label}
      </label>
      {children}
      {hint && <p className="text-micro text-muted-foreground">{hint}</p>}
    </div>
  )
}
