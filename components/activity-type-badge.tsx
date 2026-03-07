import type { Activity } from "@/lib/types"

const colors: Record<Activity["type"], string> = {
  Run: "bg-primary/10 text-primary",
  "Trail Run": "bg-accent text-accent-foreground",
  Race: "bg-chart-1/15 text-chart-1",
  Walk: "bg-muted text-muted-foreground",
}

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
      className={`rounded-lg font-semibold uppercase tracking-wider ${sizeClasses} ${colors[type]}`}
    >
      {type}
    </span>
  )
}
