"use client"

import { useState, useRef, useEffect } from "react"
import { HelpCircle } from "lucide-react"

interface InfoTooltipProps {
  content: string
}

/**
 * A small inline ? icon that shows a tooltip on tap (mobile-first).
 * Always shows BELOW the icon to avoid top cutoff on mobile.
 * Uses fixed positioning to avoid any overflow/clipping issues.
 */
export function InfoTooltip({ content }: InfoTooltipProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Calculate position when opening
  useEffect(() => {
    if (!open || !buttonRef.current) return
    
    const button = buttonRef.current
    const rect = button.getBoundingClientRect()
    const padding = 16
    const tooltipWidth = Math.min(220, window.innerWidth - padding * 2)
    
    // Position below the button, centered
    let left = rect.left + rect.width / 2 - tooltipWidth / 2
    
    // Keep within horizontal bounds
    if (left < padding) {
      left = padding
    } else if (left + tooltipWidth > window.innerWidth - padding) {
      left = window.innerWidth - padding - tooltipWidth
    }
    
    setPosition({
      top: rect.bottom + 8, // 8px below the icon
      left,
    })
  }, [open])

  // Close on outside tap / click
  useEffect(() => {
    if (!open) return
    function handleOutside(e: MouseEvent | TouchEvent) {
      if (buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
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

  // Auto-dismiss after 4 seconds
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => setOpen(false), 4000)
    return () => clearTimeout(timer)
  }, [open])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(!open)}
        className="press inline-flex size-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
        aria-label="More information"
        aria-expanded={open}
      >
        <HelpCircle size={14} />
      </button>
      {open && (
        <div
          className="fixed z-[100] w-[240px] max-w-[calc(100vw-32px)] rounded-md bg-foreground px-3 py-2.5 text-micro leading-relaxed text-background shadow-e2 animate-in fade-in-0 zoom-in-95"
          style={{
            top: position.top,
            left: position.left,
          }}
          role="tooltip"
        >
          {content}
        </div>
      )}
    </>
  )
}
