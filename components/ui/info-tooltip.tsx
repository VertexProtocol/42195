"use client"

import { HelpCircle } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

interface InfoTooltipProps {
  content: string
  side?: "top" | "bottom" | "left" | "right"
}

/**
 * A small inline ? icon that shows a tooltip on hover (desktop) or tap (mobile).
 * Place it directly after a label or metric heading.
 */
export function InfoTooltip({ content, side = "top" }: InfoTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground active:text-muted-foreground transition-colors"
          aria-label="More information"
        >
          <HelpCircle size={12} />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-[200px] text-center">
        {content}
      </TooltipContent>
    </Tooltip>
  )
}
