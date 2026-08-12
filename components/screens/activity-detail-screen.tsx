"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  FlaskConical,
  Sparkles,
  Target,
  Trash2,
} from "lucide-react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { ActivityTypeBadge } from "@/components/activity-type-badge"
import { AppBar } from "@/components/app-bar"
import { PoweredByStrava } from "@/components/strava-brand"
import { AppCard, CardRow } from "@/components/ui/app-card"
import { BottomSheet } from "@/components/ui/bottom-sheet"
import { Button } from "@/components/ui/button"
import { Pill, type PillTone } from "@/components/ui/pill"
import { Section, SectionHeader } from "@/components/ui/section"
import { Stat, StatGroup } from "@/components/ui/stat"
import { TrackLoader } from "@/components/ui/track-mark"
import {
  formatDate,
  formatDistance,
  formatDuration,
  formatElapsed,
  formatPace,
  formatTargetTime,
  isRunActivity,
} from "@/lib/format"
import { useI18n, type TranslationKey, type TranslationParams } from "@/lib/i18n"
import { createClient } from "@/lib/supabase/client"
import { analyzeHrZones, analyzePaceZones, predictRaceTimes } from "@/lib/training-utils"
import type {
  Activity,
  Lap,
  PredictionValidationResult,
  StreamPoint,
  TestRun,
  TestRunType,
} from "@/lib/types"
import { TEST_RUN_TYPES } from "@/lib/types"

/**
 * One run, read the way a runner reads one.
 *
 * The order is the order the questions arrive in: what did I do, what does the
 * coach make of it, how did the effort run, how did the splits fall, what did
 * it cost the body, where did it go. Admin — tagging a benchmark, deleting the
 * activity — waits at the bottom, because it is never why this screen was
 * opened.
 *
 * What this screen refuses:
 *
 * - **Four stacked charts.** Pace, heart rate, elevation and cadence are four
 *   readings of the same run against the same clock, and stacking them made a
 *   wall of small graphs where only one of them was ever being read. They now
 *   share one plot and a row of chips.
 * - **A section per measurement.** Elevation, heart rate, cadence and calories
 *   were four rows in a card of their own under a heading. They are the small
 *   print of the headline numbers, so they sit under them, in the same card,
 *   behind a divider.
 * - **Ten progress bars.** Heart-rate zones and pace distribution are both
 *   "where did the time go" — one shape, one card, one at a time.
 * - **A modal-shaped picker inline.** Tagging a test run is a choice from a
 *   list, and the app already has a surface for that.
 */

type Translate = (key: TranslationKey, params?: TranslationParams) => string

/** Axis ticks. 12px is the app's readable floor and axes do not get an exception. */
const AXIS_TICK = { fontSize: 12, fill: "var(--muted-foreground)" } as const

const CHART_HEIGHT = 156

/* ─────────────────────────────  Route  ───────────────────────────── */

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

/**
 * The route as a line drawing.
 *
 * Drawn in a chart tone rather than the ember: the ember means "act on this",
 * and a route is data. The two end markers are ringed in the card's own colour
 * so they read as markers on both themes — the ring used to be literal white,
 * which is a bright dot on an espresso card at night.
 */
function RouteMap({ polyline, t }: { polyline: string; t: Translate }) {
  const geometry = useMemo(() => {
    const points = decodePolyline(polyline)
    if (points.length < 2) return null

    const lats = points.map((p) => p[0])
    const lngs = points.map((p) => p[1])
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    const minLng = Math.min(...lngs)
    const maxLng = Math.max(...lngs)

    const padding = 12
    const width = 400
    const height = 220
    const latRange = maxLat - minLat || 0.001
    const lngRange = maxLng - minLng || 0.001
    const scale = Math.min(
      (width - 2 * padding) / lngRange,
      (height - 2 * padding) / latRange,
    )
    const cx = (minLng + maxLng) / 2
    const cy = (minLat + maxLat) / 2
    const project = (p: [number, number]): [number, number] => [
      (p[1] - cx) * scale + width / 2,
      -(p[0] - cy) * scale + height / 2,
    ]

    return {
      width,
      height,
      path: points.map(project).map(([x, y]) => `${x},${y}`).join(" "),
      start: project(points[0]),
      finish: project(points[points.length - 1]),
    }
  }, [polyline])

  if (!geometry) return null

  return (
    <AppCard>
      <svg
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        className="w-full rounded-md bg-surface-sunken"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={t("activityDetail.route")}
      >
        <polyline
          points={geometry.path}
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle
          cx={geometry.start[0]}
          cy={geometry.start[1]}
          r="4.5"
          fill="var(--chart-4)"
          stroke="var(--card)"
          strokeWidth="2"
        />
        <circle
          cx={geometry.finish[0]}
          cy={geometry.finish[1]}
          r="4.5"
          fill="var(--chart-5)"
          stroke="var(--card)"
          strokeWidth="2"
        />
      </svg>

      {/* The two dots mean nothing on their own, and a route that loops back on
          itself is exactly where knowing which end is which matters. */}
      <p className="mt-3 flex items-center gap-4 text-micro text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            className="size-2 rounded-full bg-[var(--chart-4)]"
            aria-hidden
          />
          {t("activityDetail.start")}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="size-2 rounded-full bg-[var(--chart-5)]"
            aria-hidden
          />
          {t("activityDetail.finish")}
        </span>
      </p>
    </AppCard>
  )
}

/* ─────────────────────────────  Trace  ───────────────────────────── */

type TraceMetricKey = "pace" | "hr" | "altitude" | "cadence"

interface TracePoint {
  time: number
  value: number | null
}

interface TraceMetric {
  key: TraceMetricKey
  label: string
  unit: string
  color: string
  data: TracePoint[]
  domain: [number, number]
  ticks: number[]
  /** Pace runs the other way up: faster is better, so faster is higher. */
  reversed?: boolean
  /** Where the area fills to. With a reversed axis that is the bottom of it. */
  baseValue: number
  tickFormatter: (value: number) => string
  format: (value: number) => string
  /** The one-line reading under the plot: average, and the extreme worth knowing. */
  summary: string
}

interface TooltipInjected {
  active?: boolean
  payload?: { value?: number | null }[]
  label?: number
}

/** Steps a person would choose. Paces are read in seconds, so they get their own. */
const DECIMAL_STEPS = [1, 2, 2.5, 5, 10]
const SECOND_STEPS = [5, 10, 15, 20, 30, 60, 120, 300, 600]

/**
 * A scale that lands on round numbers.
 *
 * Left to itself the chart library scales an axis to the data and then labels
 * whatever falls out of it — which, on a two-minute spread of pace, was two
 * ticks reading 4:24 and 5:54. The axis is rounded outward to a step a runner
 * would have picked, and every tick is stated rather than negotiated.
 */
function axisScale(
  min: number,
  max: number,
  steps: number[] = DECIMAL_STEPS,
): { domain: [number, number]; ticks: number[] } {
  const span = max - min
  // A dead flat reading — a treadmill's altitude, a metronome's cadence — has
  // no span to divide, so it gets a band around itself instead of a division
  // by zero.
  const raw = span > 0 ? span / 4 : Math.max(Math.abs(max) / 20, 1)
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step =
    steps === DECIMAL_STEPS
      ? (DECIMAL_STEPS.map((s) => s * magnitude).find((s) => s >= raw) ?? 10 * magnitude)
      : (steps.find((s) => s >= raw) ?? steps[steps.length - 1])

  const low = Math.floor(min / step) * step
  const high = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let value = low; value <= high + step / 2; value += step) {
    ticks.push(Number(value.toFixed(6)))
  }
  return { domain: [low, high], ticks }
}

/** The same scale, worked out in seconds and handed back in minutes. */
function paceScale(fastest: number, slowest: number) {
  const { domain, ticks } = axisScale(fastest * 60, slowest * 60, SECOND_STEPS)
  return {
    domain: [domain[0] / 60, domain[1] / 60] as [number, number],
    ticks: ticks.map((tick) => tick / 60),
  }
}

/**
 * Recharts' default tooltip is a white box with black text and a grey border —
 * it belongs to no theme, least of all a warm dark one. This is the app's own
 * elevated surface with the app's own measurement type.
 */
function TraceTooltip({
  active,
  payload,
  label,
  format,
}: TooltipInjected & { format: (value: number) => string }) {
  const value = payload?.[0]?.value
  if (!active || value == null) return null
  return (
    <div className="surface-raised px-2.5 py-1.5">
      <p className="measure text-micro text-muted-foreground">{formatElapsed(label ?? 0)}</p>
      <p className="measure text-label font-semibold">{format(value)}</p>
    </div>
  )
}

function TraceChart({ metric }: { metric: TraceMetric }) {
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <AreaChart data={metric.data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
        <XAxis
          dataKey="time"
          tickFormatter={formatElapsed}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          minTickGap={44}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={metric.domain}
          ticks={metric.ticks}
          reversed={metric.reversed}
          tickFormatter={metric.tickFormatter}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={46}
        />
        <Tooltip
          content={<TraceTooltip format={metric.format} />}
          cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
        />
        {/* No entrance animation: the app has one authored motion moment and
            this is not it. */}
        <Area
          type="monotone"
          dataKey="value"
          stroke={metric.color}
          fill={metric.color}
          fillOpacity={0.14}
          strokeWidth={2}
          dot={false}
          connectNulls
          isAnimationActive={false}
          baseValue={metric.baseValue}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

/* ──────────────────────────  Distribution  ────────────────────────── */

interface DistributionRow {
  id: string
  label: string
  percentage: number
  seconds: number
  color: string
}

/**
 * Where the time went, as one bar and its key.
 *
 * Five separate meters made five separate comparisons; the run is one length of
 * time, so it is one length of bar. The rows underneath carry the numbers, and
 * every row names itself — the colour is a lookup, never the only cue.
 */
function Distribution({ rows, label }: { rows: DistributionRow[]; label: string }) {
  const shown = rows.filter((row) => row.percentage > 0)
  if (shown.length === 0) return null

  return (
    <AppCard>
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-sunken"
        role="img"
        aria-label={label}
      >
        {shown.map((row) => (
          <span
            key={row.id}
            style={{ width: `${row.percentage}%`, backgroundColor: row.color }}
          />
        ))}
      </div>

      <ul className="mt-4 flex flex-col gap-2.5">
        {shown.map((row) => (
          <li key={row.id} className="flex items-center gap-2.5">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: row.color }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-label text-card-foreground">
              {row.label}
            </span>
            <span className="measure text-label font-semibold text-card-foreground">
              {row.percentage}%
            </span>
            <span className="measure w-14 shrink-0 text-right text-micro text-muted-foreground">
              {formatElapsed(row.seconds)}
            </span>
          </li>
        ))}
      </ul>
    </AppCard>
  )
}

/* ────────────────────────────  Lookups  ──────────────────────────── */

const HR_ZONE_KEYS = [
  "hrZone.1",
  "hrZone.2",
  "hrZone.3",
  "hrZone.4",
  "hrZone.5",
] as const satisfies readonly TranslationKey[]

const PACE_ZONE_KEYS = [
  "paceZone.1",
  "paceZone.2",
  "paceZone.3",
  "paceZone.4",
  "paceZone.5",
] as const satisfies readonly TranslationKey[]

const TEST_RUN_TYPE_KEYS: Record<TestRunType, TranslationKey> = {
  "5k_time_trial": "testRun.type_5k_time_trial",
  "10k_time_trial": "testRun.type_10k_time_trial",
  max_effort: "testRun.type_max_effort",
  threshold_test: "testRun.type_threshold_test",
  custom: "testRun.type_custom",
}

const PREDICTION_RESULT_KEYS: Record<PredictionValidationResult, TranslationKey> = {
  validated: "testRun.result_validated",
  slightly_optimistic: "testRun.result_slightly_optimistic",
  too_aggressive: "testRun.result_too_aggressive",
  too_conservative: "testRun.result_too_conservative",
}

const PREDICTION_RESULT_TONES: Record<PredictionValidationResult, PillTone> = {
  validated: "positive",
  slightly_optimistic: "caution",
  too_aggressive: "negative",
  // Faster than predicted is good news, but it is not the same news as a
  // prediction that held — so it is marked as a reading, not as a pass.
  too_conservative: "data",
}

/**
 * Strava reports running cadence one leg at a time; a runner counts both feet.
 * Bikes really do turn the pedals once per revolution, so they are left alone.
 */
function cadenceValue(raw: number, isRun: boolean): number {
  return Math.round(isRun ? raw * 2 : raw)
}

/** Average, ignoring the gaps. */
function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/* ───────────────────────────  The screen  ─────────────────────────── */

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

export function ActivityDetailScreen({
  activity,
  onBack,
  onDelete,
  onTestRunChange,
  allActivities,
}: ActivityDetailScreenProps) {
  const { t } = useI18n()
  const [streams, setStreams] = useState<StreamPoint[] | null>(null)
  const [laps, setLaps] = useState<Lap[] | null>(null)
  const [loadingCharts, setLoadingCharts] = useState(true)
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null)
  const [aiAnalysisLoading, setAiAnalysisLoading] = useState(false)
  // Null is not "no analysis" until the lookup has answered. Rendering the
  // "get analysis" button before then offered to buy something the runner may
  // already own — and the button was live, so tapping it spent a real
  // Anthropic call and a slice of the AI rate limit on a duplicate.
  const [aiAnalysisResolved, setAiAnalysisResolved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Test run state
  const [testRun, setTestRun] = useState<TestRun | null>(null)
  // Same reason: an activity already tagged as a test run showed the "tag it"
  // affordance until its lookup landed.
  const [testRunResolved, setTestRunResolved] = useState(false)
  const [testRunLoading, setTestRunLoading] = useState<TestRunType | "remove" | false>(false)
  const [showTestRunPicker, setShowTestRunPicker] = useState(false)
  /** Which reading the one plot is drawing. Falls back when the run lacks it. */
  const [chosenMetric, setChosenMetric] = useState<TraceMetricKey>("pace")
  /** Which distribution the one bar is drawing. */
  const [chosenZones, setChosenZones] = useState<"hr" | "pace">("hr")
  // The route is kilobytes per activity, so the list queries leave it out and
  // this screen fetches the one it needs when it opens.
  const [polyline, setPolyline] = useState<string | null>(activity.map_polyline ?? null)

  const isRun = isRunActivity(activity.type)

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
    setAiAnalysisResolved(false)
    fetch(`/api/ai/activity-analysis?activityId=${activity.id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (!cancelled && data?.analysis) setAiAnalysis(data.analysis) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setAiAnalysisResolved(true) })
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
    setTestRunResolved(false)
    fetch(`/api/test-runs?activity_id=${activity.id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!cancelled && data?.test_runs) {
          const match = data.test_runs.find((tr: TestRun) => tr.activity_id === activity.id)
          if (match) setTestRun(match)
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setTestRunResolved(true) })
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
        onTestRunChange?.(activity.id, false)
      }
    } catch {}
    setTestRunLoading(false)
  }, [activity.id, onTestRunChange])

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

  /**
   * The readings this run actually carries, in the order they are offered.
   *
   * Everything the plot needs travels with the metric — its data, its scale,
   * its formatting — so the chart itself has no idea which of the four it is
   * drawing and there is no fourth copy of the same axis configuration.
   */
  const traceMetrics = useMemo<TraceMetric[]>(() => {
    if (!streams || streams.length === 0) return []
    const metrics: TraceMetric[] = []

    const collect = (
      source: StreamPoint[],
      read: (point: StreamPoint) => number | null,
    ): { data: TracePoint[]; values: number[] } => {
      const data = source.map((point) => ({ time: point.time, value: read(point) }))
      const values = data
        .map((point) => point.value)
        .filter((value): value is number => value !== null)
      return { data, values }
    }

    const paceSource = smoothedStreams ?? streams
    const pace = collect(paceSource, (point) => point.pace)
    if (pace.values.length > 1) {
      const fastest = Math.min(...pace.values)
      const slowest = Math.max(...pace.values)
      const scale = paceScale(fastest, slowest)
      metrics.push({
        key: "pace",
        label: t("activityDetail.pace"),
        unit: "min/km",
        color: "var(--chart-1)",
        data: pace.data,
        domain: scale.domain,
        ticks: scale.ticks,
        reversed: true,
        baseValue: scale.domain[1],
        tickFormatter: (value) =>
          `${Math.floor(value)}:${String(Math.round((value % 1) * 60)).padStart(2, "0")}`,
        format: (value) => formatPace(value),
        summary: `${t("activityDetail.avg")} ${formatPace(average(pace.values))} · ${t(
          "activityDetail.fastest",
        )} ${formatPace(fastest)}`,
      })
    }

    const hr = collect(streams, (point) => point.hr)
    if (hr.values.length > 1) {
      const max = Math.max(...hr.values)
      const scale = axisScale(Math.min(...hr.values), max)
      metrics.push({
        key: "hr",
        label: t("activityDetail.heartRate"),
        unit: "bpm",
        color: "var(--chart-5)",
        data: hr.data,
        domain: scale.domain,
        ticks: scale.ticks,
        baseValue: scale.domain[0],
        tickFormatter: (value) => String(Math.round(value)),
        format: (value) => `${Math.round(value)} bpm`,
        summary: `${t("activityDetail.avg")} ${Math.round(average(hr.values))} · ${t(
          "activityDetail.max",
        )} ${Math.round(max)} bpm`,
      })
    }

    const altitude = collect(streams, (point) => point.altitude)
    if (altitude.values.length > 1) {
      const min = Math.min(...altitude.values)
      const max = Math.max(...altitude.values)
      const scale = axisScale(min, max)
      metrics.push({
        key: "altitude",
        label: t("activityDetail.elevation"),
        unit: "m",
        color: "var(--chart-3)",
        data: altitude.data,
        domain: scale.domain,
        ticks: scale.ticks,
        baseValue: scale.domain[0],
        tickFormatter: (value) => String(Math.round(value)),
        format: (value) => `${Math.round(value)} m`,
        summary: `${Math.round(min)}–${Math.round(max)} m`,
      })
    }

    const cadenceUnit = isRun ? "spm" : "rpm"
    const cadence = collect(streams, (point) =>
      point.cadence === null ? null : cadenceValue(point.cadence, isRun),
    )
    if (cadence.values.length > 1) {
      const scale = axisScale(Math.min(...cadence.values), Math.max(...cadence.values))
      metrics.push({
        key: "cadence",
        label: t("activityDetail.cadence"),
        unit: cadenceUnit,
        color: "var(--chart-4)",
        data: cadence.data,
        domain: scale.domain,
        ticks: scale.ticks,
        baseValue: scale.domain[0],
        tickFormatter: (value) => String(Math.round(value)),
        format: (value) => `${Math.round(value)} ${cadenceUnit}`,
        summary: `${t("activityDetail.avg")} ${Math.round(
          average(cadence.values),
        )} ${cadenceUnit}`,
      })
    }

    return metrics
  }, [streams, smoothedStreams, isRun, t])

  // A run without a heart-rate belt has no HR chip to select, so the choice
  // falls back rather than leaving the card blank.
  const activeMetric =
    traceMetrics.find((metric) => metric.key === chosenMetric) ?? traceMetrics[0] ?? null

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

  const hrRows = useMemo<DistributionRow[]>(
    () =>
      (streams ? analyzeHrZones(streams, estimatedMaxHr) : []).map((zone) => ({
        id: `hr-${zone.zone}`,
        label: `Z${zone.zone} ${t(HR_ZONE_KEYS[zone.zone - 1] ?? HR_ZONE_KEYS[0])}`,
        percentage: zone.percentage,
        seconds: zone.seconds,
        color: zone.color,
      })),
    [streams, estimatedMaxHr, t],
  )

  const paceRows = useMemo<DistributionRow[]>(
    () =>
      (streams ? analyzePaceZones(streams) : []).map((zone) => ({
        id: `pace-${zone.zone}`,
        label: t(PACE_ZONE_KEYS[zone.zone - 1] ?? PACE_ZONE_KEYS[0]),
        percentage: zone.percentage,
        seconds: zone.seconds,
        color: zone.color,
      })),
    [streams, t],
  )

  const zoneTabs = useMemo(
    () =>
      [
        { key: "hr" as const, label: t("activityDetail.heartRate"), rows: hrRows },
        { key: "pace" as const, label: t("activityDetail.pace"), rows: paceRows },
      ].filter((tab) => tab.rows.some((row) => row.percentage > 0)),
    [hrRows, paceRows, t],
  )
  const activeZones = zoneTabs.find((tab) => tab.key === chosenZones) ?? zoneTabs[0] ?? null

  /**
   * The splits, and how they compare with each other.
   *
   * The bar is relative — the quickest lap fills it — because what a runner
   * reads off a split list is the shape of the run, not the absolute speed;
   * the absolute speed is printed on the same row.
   */
  const lapRows = useMemo(() => {
    if (!laps || laps.length < 2) return null
    const paces = laps.map((lap) => lap.pace_min_per_km).filter((pace) => pace > 0)
    if (paces.length === 0) return null
    const fastest = Math.min(...paces)
    const slowest = Math.max(...paces)
    const span = slowest - fastest
    return laps.map((lap) => ({
      lap,
      isFastest: lap.pace_min_per_km === fastest,
      // A floor of 20%, so the slowest lap is still a bar rather than a gap.
      fill:
        lap.pace_min_per_km <= 0
          ? 0
          : span === 0
            ? 100
            : Math.round(20 + 80 * ((slowest - lap.pace_min_per_km) / span)),
    }))
  }, [laps])

  /** The small print of the headline numbers, shown only where there is a reading. */
  const secondaryStats = useMemo(() => {
    const rows: { id: string; label: string; value: string; unit: string }[] = []
    if (activity.elevation_gain_m !== null) {
      rows.push({
        id: "elevation",
        label: t("activityDetail.elevationGain"),
        value: String(activity.elevation_gain_m),
        unit: "m",
      })
    }
    if (activity.avg_heart_rate !== null) {
      rows.push({
        id: "hr",
        label: t("activityDetail.avgHeartRate"),
        value: String(activity.avg_heart_rate),
        unit: "bpm",
      })
    }
    if (activity.avg_cadence !== null) {
      rows.push({
        id: "cadence",
        label: t("activityDetail.avgCadence"),
        value: String(cadenceValue(activity.avg_cadence, isRun)),
        unit: isRun ? "spm" : "rpm",
      })
    }
    if (activity.calories !== null) {
      rows.push({
        id: "calories",
        label: t("activityDetail.calories"),
        value: String(activity.calories),
        unit: "kcal",
      })
    }
    return rows
  }, [activity, isRun, t])

  const testRunStats = useMemo(() => {
    if (!testRun) return []
    const metrics = testRun.derived_metrics
    const rows: { id: string; label: string; value: string; unit?: string }[] = []
    if (metrics.estimated_vo2max != null) {
      rows.push({
        id: "vo2max",
        label: t("testRun.vo2max"),
        value: metrics.estimated_vo2max.toFixed(1),
      })
    }
    if (metrics.threshold_pace != null) {
      rows.push({
        id: "threshold-pace",
        label: t("testRun.thresholdPace"),
        value: formatPace(metrics.threshold_pace),
      })
    }
    if (metrics.threshold_hr != null) {
      rows.push({
        id: "threshold-hr",
        label: t("testRun.thresholdHr"),
        value: String(metrics.threshold_hr),
        unit: "bpm",
      })
    }
    if (metrics.running_efficiency != null) {
      rows.push({
        id: "efficiency",
        label: t("testRun.efficiency"),
        value: metrics.running_efficiency.toFixed(1),
      })
    }
    // Three columns is what a 390px screen holds without the values breaking;
    // efficiency is the one a runner asks for last, so it is the one that only
    // appears when something else is missing.
    return rows.slice(0, 3)
  }, [testRun, t])

  const predictionOptions = useMemo(
    () => (allActivities ? predictRaceTimes(allActivities).predictions : []),
    [allActivities],
  )

  const testRunTypeLabel = (type: TestRunType): string =>
    t(TEST_RUN_TYPE_KEYS[type] ?? "testRun.type_custom")

  const validation = testRun?.prediction_validation ?? null

  return (
    <>
      <AppBar title={activity.name} onBack={onBack} backLabel={t("tab.activities")} />

      <div className="flex flex-col gap-7 px-4 pb-8 screen-body">
        {/* ── What it was ─────────────────────────────────────────────── */}
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
            panel — with everything else the watch recorded set as their small
            print rather than as a section of its own. */}
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

          {secondaryStats.length > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4">
              {secondaryStats.map((row) => (
                <div key={row.id} className="min-w-0">
                  <p className="flex items-baseline gap-1">
                    <span className="measure text-label font-semibold text-card-foreground">
                      {row.value}
                    </span>
                    <span className="text-micro text-muted-foreground">{row.unit}</span>
                  </p>
                  <p className="mt-0.5 truncate text-micro text-muted-foreground">{row.label}</p>
                </div>
              ))}
            </div>
          )}
        </AppCard>

        {/* ── What the coach makes of it ──────────────────────────────── */}
        {!aiAnalysisResolved ? (
          // The height of either real branch, so nothing below it moves.
          <div className="h-11 animate-pulse rounded-md bg-surface-sunken" aria-hidden />
        ) : aiAnalysis ? (
          <Section>
            <SectionHeader title={t("analysis.coachAnalysis")} />
            <AppCard>
              <p className="max-w-[46ch] text-body leading-relaxed text-card-foreground">
                {aiAnalysis}
              </p>
            </AppCard>
          </Section>
        ) : (
          <Button
            variant="secondary"
            block
            loading={aiAnalysisLoading}
            onClick={handleGetAnalysis}
          >
            {aiAnalysisLoading ? (
              t("analysis.analyzing")
            ) : (
              <>
                <Sparkles size={16} />
                {t("analysis.getAnalysis")}
              </>
            )}
          </Button>
        )}

        {/* ── The benchmark, when this run is one ─────────────────────── */}
        {testRun && (
          <Section>
            <SectionHeader
              title={t("testRun.badge")}
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  loading={testRunLoading === "remove"}
                  disabled={!!testRunLoading}
                  onClick={handleRemoveTestRun}
                >
                  {t("testRun.remove")}
                </Button>
              }
            />
            <AppCard>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-label font-semibold text-card-foreground">
                  {testRunTypeLabel(testRun.test_type)}
                </p>
                {validation && (
                  <Pill tone={PREDICTION_RESULT_TONES[validation.result]}>
                    {t(PREDICTION_RESULT_KEYS[validation.result])}
                  </Pill>
                )}
              </div>

              {testRunStats.length > 0 && (
                <StatGroup className="mt-4">
                  {testRunStats.map((row) => (
                    <Stat key={row.id} label={row.label} value={row.value} unit={row.unit} />
                  ))}
                </StatGroup>
              )}

              {validation && (
                <AppCard variant="quiet" className="mt-4">
                  <p className="flex items-center gap-1.5 text-micro text-muted-foreground">
                    <Target size={12} aria-hidden />
                    {validation.prediction_distance_label} {t("testRun.predictionTest")}
                  </p>
                  <div className="mt-2.5 grid grid-cols-2 gap-4">
                    <div className="min-w-0">
                      <p className="text-micro text-muted-foreground">
                        {t("testRun.predictedTime")}
                      </p>
                      <p className="measure mt-0.5 text-lead font-semibold text-foreground">
                        {formatTargetTime(validation.predicted_seconds)}
                      </p>
                      <p className="measure text-micro text-muted-foreground">
                        {formatPace(validation.predicted_pace)}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-micro text-muted-foreground">
                        {t("testRun.actualTime")}
                      </p>
                      <p className="measure mt-0.5 text-lead font-semibold text-foreground">
                        {formatTargetTime(validation.actual_seconds)}
                      </p>
                      <p className="measure text-micro text-muted-foreground">
                        {formatPace(validation.actual_pace)}
                      </p>
                    </div>
                  </div>
                </AppCard>
              )}
            </AppCard>
          </Section>
        )}

        {/* ── How the effort ran ──────────────────────────────────────── */}
        {loadingCharts && streams === null ? (
          <Section>
            <SectionHeader title={t("activityDetail.trace")} />
            <div
              className="animate-pulse rounded-lg bg-surface-sunken"
              style={{ height: CHART_HEIGHT + 64 }}
              aria-hidden
            />
          </Section>
        ) : activeMetric ? (
          <Section>
            <SectionHeader title={t("activityDetail.trace")} />
            <AppCard>
              {traceMetrics.length > 1 && (
                <div
                  role="group"
                  aria-label={t("activityDetail.chooseMeasurement")}
                  className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1 pb-0.5"
                >
                  {traceMetrics.map((metric) => (
                    <button
                      key={metric.key}
                      type="button"
                      onClick={() => setChosenMetric(metric.key)}
                      aria-pressed={metric.key === activeMetric.key}
                      className={`press shrink-0 rounded-full px-2.5 py-1 text-micro font-semibold ${
                        metric.key === activeMetric.key
                          ? "bg-primary/12 text-primary"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {metric.label}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-baseline justify-between gap-3">
                <p className="text-micro text-muted-foreground">{activeMetric.unit}</p>
                <p className="measure truncate text-micro text-muted-foreground">
                  {activeMetric.summary}
                </p>
              </div>

              <div className="mt-1">
                <TraceChart metric={activeMetric} />
              </div>
            </AppCard>
          </Section>
        ) : null}

        {/* ── How the splits fell ─────────────────────────────────────── */}
        {lapRows && (
          <Section>
            <SectionHeader title={t("activityDetail.laps")} />
            <AppCard variant="rows">
              <div className="grid grid-cols-[1.75rem_1fr_1fr_2.5rem] gap-3 border-b border-border px-4 py-2">
                <span className="text-micro text-muted-foreground">#</span>
                <span className="text-right text-micro text-muted-foreground">
                  {t("activityDetail.dist")}
                </span>
                <span className="text-right text-micro text-muted-foreground">
                  {t("activityDetail.pace")}
                </span>
                <span className="text-right text-micro text-muted-foreground">
                  {t("activityDetail.hr")}
                </span>
              </div>
              {lapRows.map(({ lap, isFastest, fill }) => (
                <CardRow key={lap.index} className="py-2.5">
                  <div className="grid grid-cols-[1.75rem_1fr_1fr_2.5rem] items-baseline gap-3">
                    <span className="measure text-micro text-muted-foreground">{lap.index}</span>
                    <span className="measure text-right text-label text-card-foreground">
                      {formatDistance(lap.distance_km)}
                    </span>
                    <span
                      className={`measure text-right text-label font-semibold ${
                        isFastest ? "text-primary" : "text-card-foreground"
                      }`}
                    >
                      {formatPace(lap.pace_min_per_km)}
                    </span>
                    <span className="measure text-right text-label text-muted-foreground">
                      {lap.avg_heart_rate !== null ? Math.round(lap.avg_heart_rate) : "—"}
                    </span>
                  </div>
                  {/* The split as a length. Decorative — every number it encodes
                      is printed on the row above it. */}
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
                    <div
                      className={`h-full rounded-full ${
                        isFastest ? "bg-primary" : "bg-muted-foreground/40"
                      }`}
                      style={{ width: `${fill}%` }}
                    />
                  </div>
                </CardRow>
              ))}
            </AppCard>
          </Section>
        )}

        {/* ── What it cost ────────────────────────────────────────────── */}
        {activeZones && (
          <Section>
            <SectionHeader
              title={t("activityDetail.timeInZones")}
              action={
                zoneTabs.length > 1 ? (
                  <div
                    role="group"
                    aria-label={t("activityDetail.chooseDistribution")}
                    className="flex gap-1"
                  >
                    {zoneTabs.map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setChosenZones(tab.key)}
                        aria-pressed={tab.key === activeZones.key}
                        className={`press rounded-full px-2.5 py-1 text-micro font-semibold ${
                          tab.key === activeZones.key
                            ? "bg-primary/12 text-primary"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                ) : undefined
              }
            />
            <Distribution
              rows={activeZones.rows}
              label={`${t("activityDetail.timeInZones")} — ${activeZones.label}`}
            />
          </Section>
        )}

        {/* ── Where it went ───────────────────────────────────────────── */}
        {polyline && (
          <Section>
            <SectionHeader title={t("activityDetail.route")} />
            <RouteMap polyline={polyline} t={t} />
          </Section>
        )}

        {/* ── Admin ───────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-2 pt-1">
          {testRunResolved && !testRun && (
            <Button variant="secondary" block onClick={() => setShowTestRunPicker(true)}>
              <FlaskConical size={16} />
              {t("testRun.markAs")}
            </Button>
          )}

          {onDelete &&
            (confirmDelete ? (
              <AppCard variant="quiet" className="flex flex-col gap-3">
                <p className="text-label text-foreground">{t("activityDetail.deleteConfirm")}</p>
                <div className="flex gap-2">
                  <Button
                    variant="danger"
                    block
                    loading={deleting}
                    onClick={async () => {
                      setDeleting(true)
                      const ok = await onDelete(activity.id)
                      if (!ok) setDeleting(false)
                    }}
                  >
                    {deleting ? t("activityDetail.deleting") : t("activityDetail.delete")}
                  </Button>
                  <Button
                    variant="ghost"
                    block
                    disabled={deleting}
                    onClick={() => setConfirmDelete(false)}
                  >
                    {t("common.cancel")}
                  </Button>
                </div>
              </AppCard>
            ) : (
              <Button
                variant="ghost"
                block
                className="text-destructive hover:bg-destructive/10"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={16} />
                {t("activityDetail.delete")}
              </Button>
            ))}
        </div>

        {activity.strava_id && <PoweredByStrava className="mt-2" />}
      </div>

      {/* Choosing a benchmark is a choice from a list, and the app has one
          surface for that. It used to be a card that grew out of the page and
          pushed everything below it down. */}
      <BottomSheet
        open={showTestRunPicker}
        onClose={() => setShowTestRunPicker(false)}
        title={t("testRun.selectType")}
        description={t("testRun.pickHint")}
        closeLabel={t("common.cancel")}
      >
        <div className="flex flex-col">
          {TEST_RUN_TYPES.map((type) => (
            <button
              key={type.value}
              type="button"
              onClick={() => handleTagTestRun(type.value)}
              disabled={!!testRunLoading}
              className="press flex min-h-11 items-center gap-3 rounded-md px-3 py-2.5 text-left text-label text-card-foreground hover:bg-surface-sunken disabled:opacity-45"
            >
              {testRunLoading === type.value ? (
                <TrackLoader size={14} />
              ) : (
                <FlaskConical size={16} className="shrink-0 text-muted-foreground" aria-hidden />
              )}
              {testRunTypeLabel(type.value)}
            </button>
          ))}
        </div>

        {predictionOptions.length > 0 && (
          <>
            <div className="my-3 border-t border-border" />
            <p className="mb-1.5 px-3 text-micro text-muted-foreground">
              {t("testRun.predictionTests")}
            </p>
            <div className="flex flex-col">
              {predictionOptions.map((prediction) => (
                <button
                  key={prediction.distance_label}
                  type="button"
                  onClick={() => handleTagTestRun("custom", prediction.distance_km)}
                  disabled={!!testRunLoading}
                  className="press flex min-h-11 items-center gap-3 rounded-md px-3 py-2.5 text-left text-label text-card-foreground hover:bg-surface-sunken disabled:opacity-45"
                >
                  {testRunLoading === "custom" ? (
                    <TrackLoader size={14} />
                  ) : (
                    <Target size={16} className="shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {prediction.distance_label} {t("testRun.predictionTest")}
                  </span>
                  <span className="measure shrink-0 text-micro text-muted-foreground">
                    {formatTargetTime(prediction.predicted_seconds)}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </BottomSheet>
    </>
  )
}
