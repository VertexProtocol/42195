import type { Activity } from "@/lib/types"

/**
 * Activity type marker.
 *
 * Types are grouped by discipline rather than given a colour each: running is
 * the accent, everything else is a neutral or a single data hue. A palette
 * with twenty entries is a legend nobody reads.
 */

const RUN_TYPES = new Set(["Run", "Trail Run", "Race", "Virtual Run", "Treadmill"])
const RIDE_TYPES = new Set([
  "Ride",
  "Virtual Ride",
  "Gravel Ride",
  "Mountain Bike Ride",
  "E-Bike Ride",
])
const SNOW_TYPES = new Set(["Nordic Ski", "Alpine Ski", "Backcountry Ski", "Snowboard", "Snowshoe"])
const WATER_TYPES = new Set(["Swim", "Rowing", "Kayaking", "Surfing", "Canoeing"])

function toneFor(type: string): string {
  if (RUN_TYPES.has(type)) return "bg-primary/12 text-primary"
  if (RIDE_TYPES.has(type)) return "bg-chart-2/14 text-chart-2"
  if (WATER_TYPES.has(type)) return "bg-chart-4/14 text-chart-4"
  if (SNOW_TYPES.has(type)) return "bg-chart-5/14 text-chart-5"
  return "bg-surface-sunken text-secondary-foreground"
}

export function ActivityTypeBadge({
  type,
  size = "sm",
}: {
  type: Activity["type"]
  size?: "sm" | "md"
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full font-semibold ${
        size === "md" ? "px-2.5 py-1 text-micro" : "px-2 py-0.5 text-micro"
      } ${toneFor(type)}`}
    >
      {type}
    </span>
  )
}
