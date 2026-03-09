"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
import { ArrowLeft, TrendingUp, Clock, Gauge, Mountain, Heart, Flame, MapPin, Sparkles, Loader2, Trash2, Activity as ActivityIcon } from "lucide-react"
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, Label } from "recharts"
import { formatDistance, formatDuration, formatPace, formatDate, formatElapsed } from "@/lib/format"
import { analyzeHrZones, analyzePaceZones } from "@/lib/training-utils"
import { ActivityTypeBadge } from "@/components/activity-type-badge"
import { useI18n } from "@/lib/i18n"
import type { Activity, StreamPoint, Lap } from "@/lib/types"

interface ActivityDetailScreenProps {
  activity: Activity
  onBack: () => void
  onDelete?: (activityId: string) => Promise<boolean>
  /** All activities — used to compute global max HR for consistent zone calculation */
  allActivities?: Activity[]
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

/** Decode Google's encoded polyline format to [lat, lng] pairs */
function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = []
  let index = 0
  let lat = 0
  let lng = 0

  while (index < encoded.length) {
    let shift = 0
    let result = 0
    let b: number
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    lat += result & 1 ? ~(result >> 1) : result >> 1

    shift = 0
    result = 0
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    lng += result & 1 ? ~(result >> 1) : result >> 1

    points.push([lat / 1e5, lng / 1e5])
  }
  return points
}

/** Render a lightweight SVG map from polyline coordinates */
function RouteMap({ polyline }: { polyline: string }) {
  const points = useMemo(() => decodePolyline(polyline), [polyline])

  if (points.length < 2) return null

  const lats = points.map((p) => p[0])
  const lngs = points.map((p) => p[1])
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)

  const padding = 10
  const width = 400
  const height = 250

  // Scale points to SVG viewport
  const latRange = maxLat - minLat || 0.001
  const lngRange = maxLng - minLng || 0.001
  const scale = Math.min(
    (width - 2 * padding) / lngRange,
    (height - 2 * padding) / latRange,
  )

  const cx = (minLng + maxLng) / 2
  const cy = (minLat + maxLat) / 2

  const svgPoints = points
    .map((p) => {
      const x = (p[1] - cx) * scale + width / 2
      const y = -(p[0] - cy) * scale + height / 2
      return `${x},${y}`
    })
    .join(" ")

  return (
    <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
      <div className="mb-3 flex items-center gap-2">
        <MapPin size={14} className="text-muted-foreground" />
        <p className="text-xs font-medium text-card-foreground">Route</p>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full rounded-xl bg-secondary/50"
        preserveAspectRatio="xMidYMid meet"
      >
        <polyline
          points={svgPoints}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.8"
        />
        {/* Start marker */}
        {points.length > 0 && (
          <circle
            cx={(points[0][1] - cx) * scale + width / 2}
            cy={-(points[0][0] - cy) * scale + height / 2}
            r="4"
            fill="var(--chart-4)"
            stroke="white"
            strokeWidth="1.5"
          />
        )}
        {/* End marker */}
        {points.length > 1 && (
          <circle
            cx={(points[points.length - 1][1] - cx) * scale + width / 2}
            cy={-(points[points.length - 1][0] - cy) * scale + height / 2}
            r="4"
            fill="var(--chart-5)"
            stroke="white"
            strokeWidth="1.5"
          />
        )}
      </svg>
    </div>
  )
}

export function ActivityDetailScreen({ activity, onBack, onDelete, allActivities }: ActivityDetailScreenProps) {
  const { t } = useI18n()
  const [streams, setStreams] = useState<StreamPoint[] | null>(null)
  const [laps, setLaps] = useState<Lap[] | null>(null)
  const [loadingCharts, setLoadingCharts] = useState(true)
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null)
  const [aiAnalysisLoading, setAiAnalysisLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleGetAnalysis = useCallback(async () => {
    setAiAnalysisLoading(true)
    try {
      const res = await fetch("/api/ai/activity-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityId: activity.id }),
      })
      if (res.ok) {
        const data = await res.json()
        setAiAnalysis(data.analysis)
      }
    } catch {}
    setAiAnalysisLoading(false)
  }, [activity.id])

  useEffect(() => {
    let cancelled = false
    setLoadingCharts(true)

    Promise.all([
      fetch(`/api/activities/${activity.id}/streams`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => { if (!cancelled && data?.points) setStreams(data.points) })
        .catch(() => {}),
      fetch(`/api/activities/${activity.id}/laps`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => { if (!cancelled && data?.laps) setLaps(data.laps) })
        .catch(() => {}),
    ]).finally(() => { if (!cancelled) setLoadingCharts(false) })

    return () => { cancelled = true }
  }, [activity.id])

  const hasAltitude = streams?.some((p) => p.altitude !== null) ?? false
  const hasPace = streams?.some((p) => p.pace !== null) ?? false
  const hasHr = streams?.some((p) => p.hr !== null) ?? false
  const hasCadence = streams?.some((p) => p.cadence !== null) ?? false
  const showCharts = streams !== null && streams.length > 0 && (hasAltitude || hasPace || hasHr || hasCadence)

  // Smooth pace data to remove GPS warmup artifacts and outliers
  const smoothedStreams = useMemo(() => {
    if (!streams || streams.length === 0) return streams
    const validPaces = streams.map(p => p.pace).filter((p): p is number => p !== null && p > 0 && p < 15)
    if (validPaces.length === 0) return streams
    validPaces.sort((a, b) => a - b)
    const medianPace = validPaces[Math.floor(validPaces.length / 2)]
    const upperBound = medianPace * 2
    const lowerBound = medianPace * 0.4
    return streams.map((point, i) => {
      if (i < 3 && point.pace !== null && point.pace > upperBound) return { ...point, pace: null }
      if (point.pace !== null && (point.pace > upperBound || point.pace < lowerBound)) return { ...point, pace: null }
      return point
    })
  }, [streams])

  // Compute global max HR from all activities for consistent zone boundaries
  const globalMaxHr = useMemo(() => {
    if (!allActivities) return undefined
    const hrs = allActivities
      .map((a) => a.avg_heart_rate)
      .filter((hr): hr is number => hr !== null && hr > 0)
    if (hrs.length === 0) return undefined
    // Avg HR × 1.2 approximates max HR better than using avg HR directly.
    // A more accurate approach would use stream data, but avg_heart_rate is available for all activities.
    return Math.max(...hrs) * 1.2
  }, [allActivities])

  const hrZones = useMemo(
    () => (streams ? analyzeHrZones(streams, globalMaxHr) : []),
    [streams, globalMaxHr],
  )

  const paceZones = useMemo(
    () => (streams ? analyzePaceZones(streams) : []),
    [streams],
  )

  return (
    <div className="flex flex-col gap-6 px-5 pb-6 pt-4">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex min-h-[44px] min-w-[44px] items-center gap-1.5 self-start text-sm font-medium text-primary active:opacity-70 transition-opacity"
        aria-label="Back to activities"
      >
        <ArrowLeft size={20} />
        <span>{t("activities.backToActivities")}</span>
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
          <StatCard icon={TrendingUp} label={t("activityDetail.distance")} value={formatDistance(activity.distance_km)} />
          <StatCard icon={Clock} label={t("activityDetail.duration")} value={formatDuration(activity.duration_seconds)} />
          {activity.pace_min_per_km !== null && (
            <StatCard icon={Gauge} label={t("activityDetail.pace")} value={formatPace(activity.pace_min_per_km)} />
          )}
        </div>
      </section>

      {/* Secondary Stats */}
      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("activityDetail.details")}
        </h3>
        <div className="flex flex-col gap-0 overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border">
          {activity.elevation_gain_m !== null && (
            <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
              <div className="flex items-center gap-3">
                <Mountain size={18} className="text-muted-foreground" />
                <span className="text-sm text-card-foreground">{t("activityDetail.elevationGain")}</span>
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
                <span className="text-sm text-card-foreground">{t("activityDetail.avgHeartRate")}</span>
              </div>
              <span className="text-sm font-semibold text-card-foreground">
                {activity.avg_heart_rate} bpm
              </span>
            </div>
          )}
          {activity.avg_cadence !== null && (
            <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
              <div className="flex items-center gap-3">
                <ActivityIcon size={18} className="text-muted-foreground" />
                <span className="text-sm text-card-foreground">{t("activityDetail.avgCadence")}</span>
              </div>
              <span className="text-sm font-semibold text-card-foreground">
                {activity.avg_cadence} spm
              </span>
            </div>
          )}
          {activity.calories !== null && (
            <div className="flex items-center justify-between px-4 py-3.5">
              <div className="flex items-center gap-3">
                <Flame size={18} className="text-muted-foreground" />
                <span className="text-sm text-card-foreground">{t("activityDetail.calories")}</span>
              </div>
              <span className="text-sm font-semibold text-card-foreground">
                {activity.calories} kcal
              </span>
            </div>
          )}
        </div>
      </section>

      {/* AI Analysis */}
      <section>
        {aiAnalysis ? (
          <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
            <div className="mb-2 flex items-center gap-2">
              <Sparkles size={14} className="text-primary" />
              <span className="text-xs font-medium text-primary">{t("analysis.coachAnalysis")}</span>
            </div>
            <p className="text-sm leading-relaxed text-card-foreground">{aiAnalysis}</p>
          </div>
        ) : (
          <button
            onClick={handleGetAnalysis}
            disabled={aiAnalysisLoading}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-card px-4 py-3.5 text-sm font-medium text-primary shadow-sm ring-1 ring-border transition-colors hover:bg-muted/50 disabled:opacity-50 active:opacity-80"
          >
            {aiAnalysisLoading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {t("analysis.analyzing")}
              </>
            ) : (
              <>
                <Sparkles size={16} />
                {t("analysis.getAnalysis")}
              </>
            )}
          </button>
        )}
      </section>

      {/* Route Map */}
      {activity.map_polyline && (
        <section>
          <RouteMap polyline={activity.map_polyline} />
        </section>
      )}

      {/* Heart Rate Zones */}
      {hrZones.length > 0 && (
        <section>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("activityDetail.hrZones")}
          </h3>
          <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
            <div className="flex flex-col gap-2.5">
              {hrZones.map((zone) => (
                <div key={zone.zone} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-card-foreground">
                      Z{zone.zone} {zone.label}
                    </span>
                    <span className="text-muted-foreground">
                      {zone.percentage}% · {formatElapsed(zone.seconds)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${zone.percentage}%`,
                        backgroundColor: zone.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Pace Zones */}
      {paceZones.length > 0 && (
        <section>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("activityDetail.paceDistribution")}
          </h3>
          <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
            <div className="flex flex-col gap-2.5">
              {paceZones.filter((z) => z.percentage > 0).map((zone) => (
                <div key={zone.zone} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-card-foreground">
                      {zone.label}
                    </span>
                    <span className="text-muted-foreground">
                      {zone.percentage}% · {formatElapsed(zone.seconds)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${zone.percentage}%`,
                        backgroundColor: zone.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Performance Charts */}
      {loadingCharts && (
        <section>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("activityDetail.performance")}
          </h3>
          <div className="flex flex-col gap-3">
            <div className="h-[170px] animate-pulse rounded-2xl bg-card shadow-sm ring-1 ring-border" />
            <div className="h-[170px] animate-pulse rounded-2xl bg-card shadow-sm ring-1 ring-border" />
          </div>
        </section>
      )}
      {showCharts && (
        <section>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("activityDetail.performance")}
          </h3>
          <div className="flex flex-col gap-3">
            {hasPace && (
              <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
                <p className="mb-3 text-xs font-medium text-card-foreground">{t("activityDetail.pace")}</p>
                <ResponsiveContainer width="100%" height={130}>
                  <AreaChart data={smoothedStreams} margin={{ top: 8, right: 8, left: 8, bottom: 24 }}>
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
                      domain={["dataMin - 0.5", "dataMax + 0.5"]}
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
                <p className="mb-3 text-xs font-medium text-card-foreground">{t("activityDetail.heartRate")}</p>
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
                <p className="mb-3 text-xs font-medium text-card-foreground">{t("activityDetail.elevation")}</p>
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

            {hasCadence && (
              <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
                <p className="mb-3 text-xs font-medium text-card-foreground">{t("activityDetail.cadence")}</p>
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
                      <Label value="spm" angle={-90} position="insideLeft" offset={12} style={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
                    </YAxis>
                    <Tooltip
                      formatter={(v) => [`${Math.round((v as number) * 2)} spm`, "Cadence"]}
                      labelFormatter={(l) => formatElapsed(l as number)}
                    />
                    <Area
                      type="monotone"
                      dataKey="cadence"
                      stroke="var(--chart-4)"
                      fill="var(--chart-4)"
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
            {t("activityDetail.laps")}
          </h3>
          <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border">
            <div className="grid grid-cols-4 gap-2 border-b border-border px-4 py-2">
              <span className="text-[11px] font-medium text-muted-foreground">#</span>
              <span className="text-right text-[11px] font-medium text-muted-foreground">{t("activityDetail.dist")}</span>
              <span className="text-right text-[11px] font-medium text-muted-foreground">{t("activityDetail.pace")}</span>
              <span className="text-right text-[11px] font-medium text-muted-foreground">{t("activityDetail.hr")}</span>
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
                  {lap.avg_heart_rate !== null ? `${Math.round(lap.avg_heart_rate)}` : "\u2014"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Delete Activity */}
      {onDelete && (
        <section className="pt-2">
          {confirmDelete ? (
            <div className="rounded-2xl bg-destructive/10 p-4 ring-1 ring-destructive/20">
              <p className="mb-3 text-sm text-destructive">
                {t("activityDetail.deleteConfirm")}
              </p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={async () => {
                    setDeleting(true)
                    const ok = await onDelete(activity.id)
                    if (!ok) setDeleting(false)
                  }}
                  disabled={deleting}
                  className="w-full rounded-xl bg-destructive px-4 py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                >
                  {deleting ? t("activityDetail.deleting") : t("activityDetail.delete")}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
                  className="w-full rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground transition-opacity disabled:opacity-50"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 active:opacity-80"
            >
              <Trash2 size={16} />
              {t("activityDetail.delete")}
            </button>
          )}
        </section>
      )}
    </div>
  )
}
