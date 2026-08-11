"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
import { ArrowLeft, TrendingUp, Clock, Gauge, Mountain, Heart, Flame, MapPin, Sparkles, Loader2, Trash2, Activity as ActivityIcon, FlaskConical, X, ChevronDown, ChevronUp, Zap, Target } from "lucide-react"
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, Label } from "recharts"
import { formatDistance, formatDuration, formatPace, formatDate, formatElapsed, formatTargetTime } from "@/lib/format"
import { analyzeHrZones, analyzePaceZones, predictRaceTimes, PREDICTION_DISTANCES } from "@/lib/training-utils"
import { ActivityTypeBadge } from "@/components/activity-type-badge"
import { useI18n } from "@/lib/i18n"
import type { Activity, StreamPoint, Lap, TestRun, TestRunType, DerivedMetrics, PredictionValidation } from "@/lib/types"
import { TEST_RUN_TYPES } from "@/lib/types"
import { PoweredByStrava } from "@/components/strava-brand"
import { createClient } from "@/lib/supabase/client"
import { AppCard } from '@/components/ui/app-card'
import { TrackLoader } from '@/components/ui/track-mark'
import { AppBar } from '@/components/app-bar'
import { Stat, StatGroup } from '@/components/ui/stat'
import { Pill } from '@/components/ui/pill'

interface ActivityDetailScreenProps {
  activity: Activity
  onBack: () => void
  onDelete?: (activityId: string) => Promise<boolean>
  /**
   * Tagging or untagging a test run here changes which filter chips the
   * Activities list offers, and that list no longer refetches on every visit.
   */
  onTestRunChange?: (activityId: string, isTestRun: boolean) => void
  /** All activities — used to compute global max HR for consistent zone calculation */
  allActivities?: Activity[]
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
    <AppCard>
      <div className="mb-3 flex items-center gap-2">
        <MapPin size={14} className="text-muted-foreground" />
        <p className="text-micro font-medium text-card-foreground">Route</p>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full rounded-md bg-secondary/50"
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
    </AppCard>
  )
}

export function ActivityDetailScreen({ activity, onBack, onDelete, onTestRunChange, allActivities }: ActivityDetailScreenProps) {
  const { t } = useI18n()
  const [streams, setStreams] = useState<StreamPoint[] | null>(null)
  const [laps, setLaps] = useState<Lap[] | null>(null)
  const [loadingCharts, setLoadingCharts] = useState(true)
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null)
  const [aiAnalysisLoading, setAiAnalysisLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Test run state
  const [testRun, setTestRun] = useState<TestRun | null>(null)
  const [testRunLoading, setTestRunLoading] = useState<TestRunType | "remove" | false>(false)
  const [showTestRunPicker, setShowTestRunPicker] = useState(false)
  const [testRunExpanded, setTestRunExpanded] = useState(false)
  // The route is kilobytes per activity, so the list queries leave it out and
  // this screen fetches the one it needs when it opens.
  const [polyline, setPolyline] = useState<string | null>(activity.map_polyline ?? null)

  useEffect(() => {
    if (activity.map_polyline) {
      setPolyline(activity.map_polyline)
      return
    }
    let cancelled = false
    setPolyline(null)
    createClient()
      .from("activities")
      .select("map_polyline")
      .eq("id", activity.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setPolyline((data?.map_polyline as string | null) ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [activity.id, activity.map_polyline])

  // Load cached analysis on mount
  useEffect(() => {
    let cancelled = false
    fetch(`/api/ai/activity-analysis?activityId=${activity.id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (!cancelled && data?.analysis) setAiAnalysis(data.analysis) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [activity.id])

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

  // Fetch test run status for this activity
  useEffect(() => {
    let cancelled = false
    fetch(`/api/test-runs?activity_id=${activity.id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!cancelled && data?.test_runs) {
          const match = data.test_runs.find((tr: TestRun) => tr.activity_id === activity.id)
          if (match) setTestRun(match)
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [activity.id])

  const handleTagTestRun = useCallback(async (testType: TestRunType, predictionDistanceKm?: number) => {
    setTestRunLoading(testType)
    try {
      const body: Record<string, unknown> = { activity_id: activity.id, test_type: testType }
      if (predictionDistanceKm != null) {
        body.prediction_distance_km = predictionDistanceKm
      }
      const res = await fetch("/api/test-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = await res.json()
        setTestRun(data.test_run)
        setShowTestRunPicker(false)
        onTestRunChange?.(activity.id, true)
      }
    } catch {}
    setTestRunLoading(false)
  }, [activity.id, onTestRunChange])

  const handleRemoveTestRun = useCallback(async () => {
    setTestRunLoading("remove")
    try {
      const res = await fetch(`/api/test-runs?activity_id=${activity.id}`, { method: "DELETE" })
      if (res.ok) {
        setTestRun(null)
        setTestRunExpanded(false)
        onTestRunChange?.(activity.id, false)
      }
    } catch {}
    setTestRunLoading(false)
  }, [activity.id, onTestRunChange])

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
    const upperBound = medianPace * 1.5
    const lowerBound = medianPace * 0.5
    // Null out the first 8 points if they deviate from median (GPS warmup)
    // and any mid-run outliers beyond the bounds
    return streams.map((point, i) => {
      if (point.pace === null) return point
      if (i < 8 && (point.pace > medianPace * 1.15 || point.pace < lowerBound)) return { ...point, pace: null }
      if (point.pace > upperBound || point.pace < lowerBound) return { ...point, pace: null }
      return point
    })
  }, [streams])

  // Compute Y-axis domain for pace chart — clamp to reasonable range
  const paceDomain = useMemo(() => {
    if (!smoothedStreams) return [0, 10] as [number, number]
    const paces = smoothedStreams.map(p => p.pace).filter((p): p is number => p !== null && p > 0)
    if (paces.length === 0) return [0, 10] as [number, number]
    const min = Math.min(...paces)
    const max = Math.max(...paces)
    return [Math.floor((min - 0.3) * 10) / 10, Math.ceil((max + 0.3) * 10) / 10] as [number, number]
  }, [smoothedStreams])

  // Compute global max HR from all activities for consistent zone boundaries
  const estimatedMaxHr = useMemo(() => {
    // Best source: actual max HR from stream data (second-by-second readings)
    const streamMax = streams
      ? Math.max(...streams.filter((p) => p.hr !== null && p.hr > 0).map((p) => p.hr!), 0)
      : 0

    // Fallback: highest avg HR across all activities × 1.1 (smaller multiplier since
    // avg HR is already close to max on hard efforts)
    const activityMax = allActivities
      ? Math.max(
          ...allActivities
            .map((a) => a.avg_heart_rate)
            .filter((hr): hr is number => hr !== null && hr > 0),
          0,
        )
      : 0

    // Use stream max directly if available (most accurate), otherwise estimate from avg HR
    if (streamMax > 0 && activityMax > 0) {
      // Use the higher of: stream max from this activity, or highest avg HR × 1.1
      return Math.max(streamMax, activityMax * 1.1)
    }
    if (streamMax > 0) return streamMax
    if (activityMax > 0) return activityMax * 1.1
    return undefined
  }, [streams, allActivities])

  const hrZones = useMemo(
    () => (streams ? analyzeHrZones(streams, estimatedMaxHr) : []),
    [streams, estimatedMaxHr],
  )

  const paceZones = useMemo(
    () => (streams ? analyzePaceZones(streams) : []),
    [streams],
  )

  return (
    <>
      <AppBar title={activity.name} onBack={onBack} backLabel={t("tab.activities")} />

      <div className="flex flex-col gap-6 px-4 pb-6 screen-body">
        <div className="flex flex-wrap items-center gap-2">
          <ActivityTypeBadge type={activity.type} size="md" />
          <span className="text-micro text-muted-foreground">{formatDate(activity.date)}</span>
          {testRun && (
            <Pill tone="data" icon={<FlaskConical size={10} />}>
              {t("testRun.badge")}
            </Pill>
          )}
        </div>

        {/* The three numbers the run is judged by, read as one instrument
            panel rather than three separate cards. */}
        <AppCard>
          <h2 className="sr-only">{t("activityDetail.details")}</h2>
          <StatGroup>
            <Stat
              label={t("activityDetail.distance")}
              value={formatDistance(activity.distance_km)}
            />
            <Stat
              label={t("activityDetail.duration")}
              value={formatDuration(activity.duration_seconds)}
            />
            {activity.pace_min_per_km !== null ? (
              <Stat
                label={t("activityDetail.pace")}
                value={formatPace(activity.pace_min_per_km)}
              />
            ) : null}
          </StatGroup>
        </AppCard>

      {/* Secondary Stats */}
      <section>
        <h3 className="mb-3 text-micro font-medium uppercase tracking-wider text-muted-foreground">
          {t("activityDetail.details")}
        </h3>
        <AppCard variant="rows" className="flex flex-col gap-0">
          {activity.elevation_gain_m !== null && (
            <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
              <div className="flex items-center gap-3">
                <Mountain size={18} className="text-muted-foreground" />
                <span className="text-label text-card-foreground">{t("activityDetail.elevationGain")}</span>
              </div>
              <span className="text-label font-semibold text-card-foreground">
                {activity.elevation_gain_m} m
              </span>
            </div>
          )}
          {activity.avg_heart_rate !== null && (
            <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
              <div className="flex items-center gap-3">
                <Heart size={18} className="text-muted-foreground" />
                <span className="text-label text-card-foreground">{t("activityDetail.avgHeartRate")}</span>
              </div>
              <span className="text-label font-semibold text-card-foreground">
                {activity.avg_heart_rate} bpm
              </span>
            </div>
          )}
          {activity.avg_cadence !== null && (
            <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
              <div className="flex items-center gap-3">
                <ActivityIcon size={18} className="text-muted-foreground" />
                <span className="text-label text-card-foreground">{t("activityDetail.avgCadence")}</span>
              </div>
              <span className="text-label font-semibold text-card-foreground">
                {activity.avg_cadence} spm
              </span>
            </div>
          )}
          {activity.calories !== null && (
            <div className="flex items-center justify-between px-4 py-3.5">
              <div className="flex items-center gap-3">
                <Flame size={18} className="text-muted-foreground" />
                <span className="text-label text-card-foreground">{t("activityDetail.calories")}</span>
              </div>
              <span className="text-label font-semibold text-card-foreground">
                {activity.calories} kcal
              </span>
            </div>
          )}
        </AppCard>
      </section>

      {/* AI Analysis */}
      <section>
        {aiAnalysis ? (
          <AppCard>
            <div className="mb-2 flex items-center gap-2">
              <Sparkles size={14} className="text-primary" />
              <span className="text-micro font-medium text-primary">{t("analysis.coachAnalysis")}</span>
            </div>
            <p className="text-label leading-relaxed text-card-foreground">{aiAnalysis}</p>
          </AppCard>
        ) : (
          <button
            onClick={handleGetAnalysis}
            disabled={aiAnalysisLoading}
            className="flex w-full items-center justify-center gap-2 surface px-4 py-3.5 text-label font-medium text-primary transition-colors hover:bg-muted/50 disabled:opacity-50 active:opacity-80"
          >
            {aiAnalysisLoading ? (
              <>
                <TrackLoader size={14} />
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

      {/* Test Run Section */}
      <section>
        {testRun ? (
          <div className="rounded-lg bg-chart-5/5 ring-1 ring-chart-5/20 overflow-hidden">
            <button
              onClick={() => setTestRunExpanded(!testRunExpanded)}
              className="flex w-full items-center justify-between px-4 py-3 active:bg-chart-5/10 transition-colors"
            >
              <div className="flex items-center gap-2">
                <FlaskConical size={14} className="text-chart-5" />
                <span className="text-label font-semibold text-chart-5">
                  {t("testRun.badge")} — {TEST_RUN_TYPES.find(tt => tt.value === testRun.test_type)?.label ?? testRun.test_type}
                </span>
              </div>
              {testRunExpanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
            </button>

            {testRunExpanded && (
              <div className="border-t border-chart-5/20 px-4 py-3">
                {/* Prediction Validation */}
                {testRun.prediction_validation && (
                  <div className="mb-3 rounded-md bg-surface-sunken p-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Target size={12} className="text-chart-5" />
                      <span className="text-micro text-muted-foreground uppercase tracking-wide">
                        {testRun.prediction_validation.prediction_distance_label} {t("testRun.predictionTest")}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div>
                        <p className="text-micro text-muted-foreground">{t("testRun.predictedTime")}</p>
                        <p className="text-label font-bold measure text-card-foreground">
                          {formatTargetTime(testRun.prediction_validation.predicted_seconds)}
                        </p>
                        <p className="text-micro text-muted-foreground">
                          {formatPace(testRun.prediction_validation.predicted_pace)}
                        </p>
                      </div>
                      <div>
                        <p className="text-micro text-muted-foreground">{t("testRun.actualTime")}</p>
                        <p className="text-label font-bold measure text-card-foreground">
                          {formatTargetTime(testRun.prediction_validation.actual_seconds)}
                        </p>
                        <p className="text-micro text-muted-foreground">
                          {formatPace(testRun.prediction_validation.actual_pace)}
                        </p>
                      </div>
                    </div>
                    <div className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-semibold ${
                      testRun.prediction_validation.result === "validated"
                        ? "bg-success/10 text-success"
                        : testRun.prediction_validation.result === "too_conservative"
                          ? "bg-chart-4/10 text-chart-4"
                          : testRun.prediction_validation.result === "slightly_optimistic"
                            ? "bg-warning/10 text-warning"
                            : "bg-destructive/10 text-destructive"
                    }`}>
                      {t(`testRun.result_${testRun.prediction_validation.result}` as any)}
                    </div>
                  </div>
                )}

                {/* Derived metrics */}
                <div className="grid grid-cols-2 gap-3 mb-3">
                  {testRun.derived_metrics.estimated_vo2max != null && (
                    <div className="rounded-md bg-surface-sunken p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Zap size={12} className="text-chart-5" />
                        <span className="text-micro text-muted-foreground uppercase tracking-wide">{t("testRun.vo2max")}</span>
                      </div>
                      <span className="text-lead font-bold measure text-card-foreground">
                        {testRun.derived_metrics.estimated_vo2max.toFixed(1)}
                      </span>
                    </div>
                  )}
                  {testRun.derived_metrics.threshold_pace != null && (
                    <div className="rounded-md bg-surface-sunken p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Gauge size={12} className="text-chart-5" />
                        <span className="text-micro text-muted-foreground uppercase tracking-wide">{t("testRun.thresholdPace")}</span>
                      </div>
                      <span className="text-lead font-bold measure text-card-foreground">
                        {formatPace(testRun.derived_metrics.threshold_pace)}
                      </span>
                    </div>
                  )}
                  {testRun.derived_metrics.threshold_hr != null && (
                    <div className="rounded-md bg-surface-sunken p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Heart size={12} className="text-chart-5" />
                        <span className="text-micro text-muted-foreground uppercase tracking-wide">{t("testRun.thresholdHr")}</span>
                      </div>
                      <span className="text-lead font-bold measure text-card-foreground">
                        {testRun.derived_metrics.threshold_hr} <span className="text-micro font-normal text-muted-foreground">bpm</span>
                      </span>
                    </div>
                  )}
                  {testRun.derived_metrics.running_efficiency != null && (
                    <div className="rounded-md bg-surface-sunken p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <TrendingUp size={12} className="text-chart-5" />
                        <span className="text-micro text-muted-foreground uppercase tracking-wide">{t("testRun.efficiency")}</span>
                      </div>
                      <span className="text-lead font-bold measure text-card-foreground">
                        {testRun.derived_metrics.running_efficiency.toFixed(1)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Remove button */}
                <button
                  onClick={handleRemoveTestRun}
                  disabled={!!testRunLoading}
                  className="flex items-center gap-1.5 text-micro text-muted-foreground active:opacity-70 disabled:opacity-50"
                >
                  {testRunLoading === "remove" ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                  {t("testRun.remove")}
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {!showTestRunPicker ? (
              <button
                onClick={() => setShowTestRunPicker(true)}
                className="flex w-full items-center justify-center gap-2 surface px-4 py-3.5 text-label font-medium text-chart-5 transition-colors hover:bg-chart-5/5 active:opacity-80"
              >
                <FlaskConical size={16} />
                {t("testRun.markAs")}
              </button>
            ) : (
              <AppCard>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <FlaskConical size={14} className="text-chart-5" />
                    <span className="text-label font-medium text-card-foreground">{t("testRun.selectType")}</span>
                  </div>
                  <button onClick={() => setShowTestRunPicker(false)} className="p-1 text-muted-foreground active:opacity-70">
                    <X size={14} />
                  </button>
                </div>
                <div className="flex flex-col gap-1.5">
                  {TEST_RUN_TYPES.map((tt) => (
                    <button
                      key={tt.value}
                      onClick={() => handleTagTestRun(tt.value)}
                      disabled={!!testRunLoading}
                      className="flex items-center gap-2 rounded-md px-3 py-2.5 text-label text-card-foreground transition-colors hover:bg-chart-5/5 active:bg-chart-5/10 disabled:opacity-50"
                    >
                      {testRunLoading === tt.value ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} className="text-chart-5/60" />}
                      {tt.label}
                    </button>
                  ))}
                </div>

                {/* Prediction Test options */}
                {(() => {
                  const preds = allActivities ? predictRaceTimes(allActivities) : { predictions: [], referenceActivity: null }
                  if (preds.predictions.length === 0) return null
                  return (
                    <>
                      <div className="my-3 border-t border-border" />
                      <div className="flex items-center gap-1.5 mb-2">
                        <Target size={12} className="text-primary" />
                        <span className="text-micro text-muted-foreground uppercase tracking-wide">{t("testRun.predictionTests")}</span>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {preds.predictions.map((pred) => {
                          const targetPace = pred.predicted_seconds / 60 / pred.distance_km
                          const predKey = `pred_${pred.distance_km}` as TestRunType
                          return (
                            <button
                              key={pred.distance_label}
                              onClick={() => handleTagTestRun("custom", pred.distance_km)}
                              disabled={!!testRunLoading}
                              className="flex items-center justify-between rounded-md px-3 py-2.5 text-label text-card-foreground transition-colors hover:bg-primary/5 active:bg-primary/10 disabled:opacity-50"
                            >
                              <div className="flex items-center gap-2">
                                {testRunLoading === "custom" ? <Loader2 size={14} className="animate-spin" /> : <Target size={14} className="text-primary/60" />}
                                <span>{pred.distance_label} {t("testRun.predictionTest")}</span>
                              </div>
                              <span className="text-micro measure text-muted-foreground">
                                {formatPace(targetPace)} · {formatTargetTime(pred.predicted_seconds)}
                                <span className="text-micro opacity-70"> ({formatTargetTime(pred.low_seconds)}–{formatTargetTime(pred.high_seconds)})</span>
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </>
                  )
                })()}
              </AppCard>
            )}
          </>
        )}
      </section>

      {/* Route Map */}
      {polyline && (
        <section>
          <RouteMap polyline={polyline} />
        </section>
      )}

      {/* Heart Rate Zones */}
      {hrZones.length > 0 && (
        <section>
          <h3 className="mb-3 text-micro font-medium uppercase tracking-wider text-muted-foreground">
            {t("activityDetail.hrZones")}
          </h3>
          <AppCard>
            <div className="flex flex-col gap-2.5">
              {hrZones.map((zone) => (
                <div key={zone.zone} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-micro">
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
          </AppCard>
        </section>
      )}

      {/* Pace Zones */}
      {paceZones.length > 0 && (
        <section>
          <h3 className="mb-3 text-micro font-medium uppercase tracking-wider text-muted-foreground">
            {t("activityDetail.paceDistribution")}
          </h3>
          <AppCard>
            <div className="flex flex-col gap-2.5">
              {paceZones.filter((z) => z.percentage > 0).map((zone) => (
                <div key={zone.zone} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-micro">
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
          </AppCard>
        </section>
      )}

      {/* Performance Charts */}
      {loadingCharts && (
        <section>
          <h3 className="mb-3 text-micro font-medium uppercase tracking-wider text-muted-foreground">
            {t("activityDetail.performance")}
          </h3>
          <div className="flex flex-col gap-3">
            <div className="h-[170px] animate-pulse rounded-lg bg-surface-sunken" />
            <div className="h-[170px] animate-pulse rounded-lg bg-surface-sunken" />
          </div>
        </section>
      )}
      {showCharts && (
        <section>
          <h3 className="mb-3 text-micro font-medium uppercase tracking-wider text-muted-foreground">
            {t("activityDetail.performance")}
          </h3>
          <div className="flex flex-col gap-3">
            {hasPace && (
              <AppCard>
                <p className="mb-3 text-micro font-medium text-card-foreground">{t("activityDetail.pace")}</p>
                <ResponsiveContainer width="100%" height={130}>
                  <AreaChart data={smoothedStreams ?? undefined} margin={{ top: 8, right: 8, left: 8, bottom: 24 }}>
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
                      domain={paceDomain}
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
              </AppCard>
            )}

            {hasHr && (
              <AppCard>
                <p className="mb-3 text-micro font-medium text-card-foreground">{t("activityDetail.heartRate")}</p>
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
              </AppCard>
            )}

            {hasAltitude && (
              <AppCard>
                <p className="mb-3 text-micro font-medium text-card-foreground">{t("activityDetail.elevation")}</p>
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
              </AppCard>
            )}

            {hasCadence && (
              <AppCard>
                <p className="mb-3 text-micro font-medium text-card-foreground">{t("activityDetail.cadence")}</p>
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
              </AppCard>
            )}
          </div>
        </section>
      )}

      {/* Laps */}
      {laps !== null && laps.length > 1 && (
        <section>
          <h3 className="mb-3 text-micro font-medium uppercase tracking-wider text-muted-foreground">
            {t("activityDetail.laps")}
          </h3>
          <AppCard variant="rows">
            <div className="grid grid-cols-4 gap-2 border-b border-border px-4 py-2">
              <span className="text-micro font-medium text-muted-foreground">#</span>
              <span className="text-right text-micro font-medium text-muted-foreground">{t("activityDetail.dist")}</span>
              <span className="text-right text-micro font-medium text-muted-foreground">{t("activityDetail.pace")}</span>
              <span className="text-right text-micro font-medium text-muted-foreground">{t("activityDetail.hr")}</span>
            </div>
            {laps.map((lap, i) => (
              <div
                key={lap.index}
                className={`grid grid-cols-4 gap-2 px-4 py-3 ${i < laps.length - 1 ? "border-b border-border" : ""}`}
              >
                <span className="text-label font-medium text-card-foreground">{lap.index}</span>
                <span className="text-right text-label text-card-foreground">
                  {formatDistance(lap.distance_km)}
                </span>
                <span className="text-right text-label text-card-foreground">
                  {formatPace(lap.pace_min_per_km)}
                </span>
                <span className="text-right text-label text-card-foreground">
                  {lap.avg_heart_rate !== null ? `${Math.round(lap.avg_heart_rate)}` : "\u2014"}
                </span>
              </div>
            ))}
          </AppCard>
        </section>
      )}

      {/* Delete Activity */}
      {onDelete && (
        <section className="pt-2">
          {confirmDelete ? (
            <div className="rounded-lg bg-destructive/10 p-4 ring-1 ring-destructive/20">
              <p className="mb-3 text-label text-destructive">
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
                  className="w-full rounded-md bg-destructive px-4 py-2.5 text-label font-semibold text-white transition-opacity disabled:opacity-50"
                >
                  {deleting ? t("activityDetail.deleting") : t("activityDetail.delete")}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
                  className="w-full rounded-md px-4 py-2.5 text-label font-medium text-muted-foreground transition-opacity disabled:opacity-50"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3.5 text-label font-medium text-destructive transition-colors hover:bg-destructive/10 active:opacity-80"
            >
              <Trash2 size={16} />
              {t("activityDetail.delete")}
            </button>
          )}
        </section>
      )}

      {/* Strava attribution */}
      {activity.strava_id && (
        <PoweredByStrava className="mt-4 mb-2" />
      )}
      </div>
    </>
  )
}
