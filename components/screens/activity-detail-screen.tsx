"use client"

import { ArrowLeft, TrendingUp, Clock, Gauge, Mountain, Heart, Flame } from "lucide-react"
import { formatDistance, formatDuration, formatPace, formatDate } from "@/lib/format"
import type { Activity } from "@/lib/types"

interface ActivityDetailScreenProps {
  activity: Activity
  onBack: () => void
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof TrendingUp
  label: string
  value: string
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
        <Icon size={20} className="text-primary" />
      </div>
      <span className="text-base font-bold text-card-foreground">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

function ActivityTypeBadge({ type }: { type: Activity["type"] }) {
  const colors: Record<Activity["type"], string> = {
    Run: "bg-primary/10 text-primary",
    "Trail Run": "bg-accent text-accent-foreground",
    Race: "bg-chart-1/15 text-chart-1",
  }
  return (
    <span className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${colors[type]}`}>
      {type}
    </span>
  )
}

export function ActivityDetailScreen({ activity, onBack }: ActivityDetailScreenProps) {
  return (
    <div className="flex flex-col gap-6 px-5 pb-6 pt-4">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex min-h-[44px] min-w-[44px] items-center gap-1.5 self-start text-sm font-medium text-primary active:opacity-70 transition-opacity"
        aria-label="Back to activities"
      >
        <ArrowLeft size={20} />
        <span>Activities</span>
      </button>

      {/* Header */}
      <header>
        <div className="flex items-center gap-2">
          <ActivityTypeBadge type={activity.type} />
          <span className="text-xs text-muted-foreground">
            {formatDate(activity.date)}
          </span>
        </div>
        <h1 className="mt-2 text-2xl font-bold text-foreground text-balance">
          {activity.name}
        </h1>
      </header>

      {/* Primary Stats */}
      <section>
        <h2 className="sr-only">Key metrics</h2>
        <div className="grid grid-cols-3 gap-3">
          <StatCard icon={TrendingUp} label="Distance" value={formatDistance(activity.distance_km)} />
          <StatCard icon={Clock} label="Duration" value={formatDuration(activity.duration_seconds)} />
          <StatCard icon={Gauge} label="Pace" value={formatPace(activity.pace_min_per_km)} />
        </div>
      </section>

      {/* Secondary Stats */}
      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Details
        </h3>
        <div className="flex flex-col gap-0 overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border">
          {activity.elevation_gain_m !== null && (
            <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
              <div className="flex items-center gap-3">
                <Mountain size={18} className="text-muted-foreground" />
                <span className="text-sm text-card-foreground">Elevation Gain</span>
              </div>
              <span className="text-sm font-semibold text-card-foreground">
                {activity.elevation_gain_m} m
              </span>
            </div>
          )}
          {activity.avg_heart_rate !== null && (
            <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
              <div className="flex items-center gap-3">
                <Heart size={18} className="text-muted-foreground" />
                <span className="text-sm text-card-foreground">Avg Heart Rate</span>
              </div>
              <span className="text-sm font-semibold text-card-foreground">
                {activity.avg_heart_rate} bpm
              </span>
            </div>
          )}
          {activity.calories !== null && (
            <div className="flex items-center justify-between px-4 py-3.5">
              <div className="flex items-center gap-3">
                <Flame size={18} className="text-muted-foreground" />
                <span className="text-sm text-card-foreground">Calories</span>
              </div>
              <span className="text-sm font-semibold text-card-foreground">
                {activity.calories} kcal
              </span>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
