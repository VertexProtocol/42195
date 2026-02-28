"use client"

import { useEffect, useState } from "react"
import { ArrowLeft, TrendingUp, Clock, Gauge, Mountain, Heart, Flame } from "lucide-react"
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, Label } from "recharts"
import { formatDistance, formatDuration, formatPace, formatDate, formatElapsed } from "@/lib/format"
import { ActivityTypeBadge } from "@/components/activity-type-badge"
import type { Activity, StreamPoint, Lap } from "@/lib/types"

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

export function ActivityDetailScreen({ activity, onBack }: ActivityDetailScreenProps) {
  const [streams, setStreams] = useState<StreamPoint[] | null>(null)
  const [laps, setLaps] = useState<Lap[] | null>(null)

  useEffect(() => {
    fetch(`/api/activities/${activity.id}/streams`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.points) setStreams(data.points) })
      .catch(() => {})

    fetch(`/api/activities/${activity.id}/laps`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.laps) setLaps(data.laps) })
      .catch(() => {})
  }, [activity.id])

  const hasAltitude = streams?.some((p) => p.altitude !== null) ?? false
  const hasPace = streams?.some((p) => p.pace !== null) ?? false
  const hasHr = streams?.some((p) => p.hr !== null) ?? false
  const showCharts = streams !== null && streams.length > 0 && (hasAltitude || hasPace || hasHr)

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
          <ActivityTypeBadge type={activity.type} size="md" />
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
        <div className={`grid gap-3 ${activity.pace_min_per_km !== null ? "grid-cols-3" : "grid-cols-2"}`}>
          <StatCard icon={TrendingUp} label="Distance" value={formatDistance(activity.distance_km)} />
          <StatCard icon={Clock} label="Duration" value={formatDuration(activity.duration_seconds)} />
          {activity.pace_min_per_km !== null && (
            <StatCard icon={Gauge} label="Pace" value={formatPace(activity.pace_min_per_km)} />
          )}
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

      {/* Performance Charts */}
      {showCharts && (
        <section>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Performance
          </h3>
          <div className="flex flex-col gap-3">
            {hasPace && (
              <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
                <p className="mb-3 text-xs font-medium text-card-foreground">Pace</p>
                <ResponsiveContainer width="100%" height={130}>
                  <AreaChart data={streams} margin={{ top: 8, right: 8, left: 8, bottom: 24 }}>
                    <XAxis
                      dataKey="time"
                      tickFormatter={formatElapsed}
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    >
                      <Label value="Time" position="insideBottom" offset={-12} style={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
                    </XAxis>
                    <YAxis
                      domain={["auto", "auto"]}
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      width={42}
                      tickFormatter={(v: number) =>
                        `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, "0")}`
                      }
                    >
                      <Label value="min/km" angle={-90} position="insideLeft" offset={12} style={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
                    </YAxis>
                    <Tooltip
                      formatter={(v) => [formatPace(v as number), "Pace"]}
                      labelFormatter={(l) => formatElapsed(l as number)}
                    />
                    <Area
                      type="monotone"
                      dataKey="pace"
                      stroke="var(--chart-1)"
                      fill="var(--chart-1)"
                      fillOpacity={0.15}
                      dot={false}
                      strokeWidth={1.5}
                      connectNulls
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {hasHr && (
              <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
                <p className="mb-3 text-xs font-medium text-card-foreground">Heart Rate</p>
                <ResponsiveContainer width="100%" height={130}>
                  <AreaChart data={streams} margin={{ top: 8, right: 8, left: 8, bottom: 24 }}>
                    <XAxis
                      dataKey="time"
                      tickFormatter={formatElapsed}
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    >
                      <Label value="Time" position="insideBottom" offset={-12} style={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
                    </XAxis>
                    <YAxis
                      domain={["auto", "auto"]}
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      width={42}
                    >
                      <Label value="bpm" angle={-90} position="insideLeft" offset={12} style={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
                    </YAxis>
                    <Tooltip
                      formatter={(v) => [`${v} bpm`, "Heart Rate"]}
                      labelFormatter={(l) => formatElapsed(l as number)}
                    />
                    <Area
                      type="monotone"
                      dataKey="hr"
                      stroke="var(--chart-5)"
                      fill="var(--chart-5)"
                      fillOpacity={0.15}
                      dot={false}
                      strokeWidth={1.5}
                      connectNulls
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {hasAltitude && (
              <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
                <p className="mb-3 text-xs font-medium text-card-foreground">Elevation</p>
                <ResponsiveContainer width="100%" height={130}>
                  <AreaChart data={streams} margin={{ top: 8, right: 8, left: 8, bottom: 24 }}>
                    <XAxis
                      dataKey="time"
                      tickFormatter={formatElapsed}
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    >
                      <Label value="Time" position="insideBottom" offset={-12} style={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
                    </XAxis>
                    <YAxis
                      domain={["auto", "auto"]}
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      width={42}
                    >
                      <Label value="m" angle={-90} position="insideLeft" offset={12} style={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
                    </YAxis>
                    <Tooltip
                      formatter={(v) => [`${Math.round(v as number)} m`, "Altitude"]}
                      labelFormatter={(l) => formatElapsed(l as number)}
                    />
                    <Area
                      type="monotone"
                      dataKey="altitude"
                      stroke="var(--chart-3)"
                      fill="var(--chart-3)"
                      fillOpacity={0.15}
                      dot={false}
                      strokeWidth={1.5}
                      connectNulls
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Laps */}
      {laps !== null && laps.length > 1 && (
        <section>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Laps
          </h3>
          <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border">
            <div className="grid grid-cols-4 gap-2 border-b border-border px-4 py-2">
              <span className="text-[11px] font-medium text-muted-foreground">#</span>
              <span className="text-right text-[11px] font-medium text-muted-foreground">Dist</span>
              <span className="text-right text-[11px] font-medium text-muted-foreground">Pace</span>
              <span className="text-right text-[11px] font-medium text-muted-foreground">HR</span>
            </div>
            {laps.map((lap, i) => (
              <div
                key={lap.index}
                className={`grid grid-cols-4 gap-2 px-4 py-3 ${i < laps.length - 1 ? "border-b border-border" : ""}`}
              >
                <span className="text-sm font-medium text-card-foreground">{lap.index}</span>
                <span className="text-right text-sm text-card-foreground">
                  {formatDistance(lap.distance_km)}
                </span>
                <span className="text-right text-sm text-card-foreground">
                  {formatPace(lap.pace_min_per_km)}
                </span>
                <span className="text-right text-sm text-card-foreground">
                  {lap.avg_heart_rate !== null ? `${Math.round(lap.avg_heart_rate)}` : "—"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
