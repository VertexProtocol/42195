import type { Activity } from "@/lib/types"

const colors: Record<string, string> = {
  Run: "bg-primary/10 text-primary",
  "Trail Run": "bg-accent text-accent-foreground",
  Race: "bg-chart-1/15 text-chart-1",
  Walk: "bg-muted text-muted-foreground",
  Ride: "bg-chart-2/15 text-chart-2",
  "Virtual Ride": "bg-chart-2/10 text-chart-2",
  "Gravel Ride": "bg-chart-2/15 text-chart-2",
  "Mountain Bike Ride": "bg-chart-2/15 text-chart-2",
  Swim: "bg-chart-4/15 text-chart-4",
  Hike: "bg-chart-3/15 text-chart-3",
  "Nordic Ski": "bg-chart-5/15 text-chart-5",
  "Alpine Ski": "bg-chart-5/15 text-chart-5",
  "Backcountry Ski": "bg-chart-5/15 text-chart-5",
  Yoga: "bg-chart-3/10 text-chart-3",
  HIIT: "bg-chart-1/10 text-chart-1",
  "Weight Training": "bg-chart-1/10 text-chart-1",
}

const FALLBACK_COLOR = "bg-secondary text-secondary-foreground"

export function ActivityTypeBadge({
  type,
  size = "sm",
}: {
  type: Activity["type"]
  size?: "sm" | "md"
}) {
  const sizeClasses = size === "md"
    ? "px-2.5 py-1 text-[11px]"
    : "px-2 py-0.5 text-[10px]"

  return (
    <span
      className={`rounded-lg font-semibold uppercase tracking-wider ${sizeClasses} ${colors[type] ?? FALLBACK_COLOR}`}
    >
      {type}
    </span>
  )
}
