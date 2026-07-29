import type { Activity } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * ActivityTypeBadge
 *
 * The label is always neutral text on a neutral pill; the activity's colour
 * lives in a 5px dot beside it.
 *
 * Why not colour the text? The chart palette is tuned for *marks* — filled
 * areas and strokes, which WCAG holds to 3:1. Set as 10px uppercase text it
 * has to clear 4.5:1, and two of the five (teal, green) land at ~3.9:1 in
 * light mode. Moving colour to a dot keeps every type distinguishable while
 * the text runs at 16:1, and has the side benefit of quieting a row that
 * already has a name, a date, a duration, a pace and a distance in it.
 *
 * Race is the exception: it is the one type worth interrupting a scan for,
 * so it gets a filled brand pill, which passes by construction.
 */

const dotColors: Record<string, string> = {
  Run: "bg-chart-1",
  "Trail Run": "bg-chart-5",
  Walk: "bg-muted-foreground",
  Hike: "bg-chart-3",
  Ride: "bg-chart-2",
  "Virtual Ride": "bg-chart-2",
  "Gravel Ride": "bg-chart-2",
  "Mountain Bike Ride": "bg-chart-2",
  Swim: "bg-chart-4",
  "Nordic Ski": "bg-chart-3",
  "Alpine Ski": "bg-chart-3",
  "Backcountry Ski": "bg-chart-3",
  Yoga: "bg-chart-4",
  HIIT: "bg-chart-1",
  "Weight Training": "bg-chart-1",
}

const FALLBACK_DOT = "bg-muted-foreground"

export function ActivityTypeBadge({
  type,
  size = "sm",
}: {
  type: Activity["type"]
  size?: "sm" | "md"
}) {
  const sizeClasses =
    size === "md" ? "gap-1.5 px-2.5 py-1 text-[11px]" : "gap-1 px-2 py-0.5 text-[10px]"

  if (type === "Race") {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center rounded-md bg-primary font-semibold uppercase tracking-wider text-primary-foreground",
          sizeClasses,
        )}
      >
        {type}
      </span>
    )
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md bg-secondary font-semibold uppercase tracking-wider text-secondary-foreground",
        sizeClasses,
      )}
    >
      <span
        aria-hidden
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotColors[type] ?? FALLBACK_DOT)}
      />
      {type}
    </span>
  )
}
