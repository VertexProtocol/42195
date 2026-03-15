"use client"

import { useState, useRef, useEffect } from "react"
import { HelpCircle } from "lucide-react"

interface InfoTooltipProps {
  content: string
  side?: "top" | "bottom" | "left" | "right"
}

/**
 * A small inline ? icon that shows a tooltip on hover (desktop) or tap (mobile).
 * Uses a custom implementation instead of Radix Tooltip to work reliably on touch devices.
 */
export function InfoTooltip({ content, side = "top" }: InfoTooltipProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside tap / click
  useEffect(() => {
    if (!open) return
    function handleOutside(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleOutside)
    document.addEventListener("touchstart", handleOutside)
    return () => {
      document.removeEventListener("mousedown", handleOutside)
      document.removeEventListener("touchstart", handleOutside)
    }
  }, [open])

  // Auto-dismiss after 3 seconds on mobile
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => setOpen(false), 3000)
    return () => clearTimeout(timer)
  }, [open])

  const positionClasses = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-1.5",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-1.5",
    left: "right-full top-1/2 -translate-y-1/2 mr-1.5",
    right: "left-full top-1/2 -translate-y-1/2 ml-1.5",
  }

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground active:text-muted-foreground transition-colors"
        aria-label="More information"
      >
        <HelpCircle size={12} />
      </button>
      {open && (
        <div
          className={`absolute z-50 ${positionClasses[side]} w-max max-w-[200px] rounded-md bg-foreground px-3 py-1.5 text-xs text-background text-center animate-in fade-in-0 zoom-in-95`}
          role="tooltip"
        >
          {content}
        </div>
      )}
    </div>
  )
}
