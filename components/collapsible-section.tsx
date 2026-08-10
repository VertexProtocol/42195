"use client"

import { useState, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface CollapsibleSectionProps {
  title: string
  /** Optional badge/count to show next to the title */
  badge?: string | number
  /** Whether section starts collapsed */
  defaultCollapsed?: boolean
  /** Additional classes for the container */
  className?: string
  children: ReactNode
}

export function CollapsibleSection({
  title,
  badge,
  defaultCollapsed = false,
  className,
  children,
}: CollapsibleSectionProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed)

  return (
    <section className={cn("", className)}>
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="mb-3 flex w-full min-h-[44px] items-center justify-between text-left active:opacity-70 transition-opacity"
        aria-expanded={!isCollapsed}
      >
        <div className="flex items-center gap-2">
          <h3 className="text-micro font-medium uppercase tracking-wider text-muted-foreground">
            {title}
          </h3>
          {badge !== undefined && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-micro font-medium text-primary">
              {badge}
            </span>
          )}
        </div>
        <ChevronDown
          size={16}
          className={cn(
            "text-muted-foreground transition-transform duration-200",
            isCollapsed && "-rotate-90"
          )}
        />
      </button>
      <div
        className={cn(
          "grid transition-all duration-200 ease-in-out",
          isCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
        )}
      >
        <div className="overflow-hidden">
          {children}
        </div>
      </div>
    </section>
  )
}
