"use client"

import { useMemo, useState, useEffect, useRef } from "react"
import { Activity as ActivityIcon, TrendingUp, AlertTriangle, ChevronDown } from "lucide-react"
import type { Activity } from "@/lib/types"
import { computeTrainingLoadStatus, type LoadStatus } from "@/lib/training-safety"
import { computeTrainingLoad, type TrainingLoadPoint } from "@/lib/training-utils"
import { useI18n, type TranslationKey } from "@/lib/i18n"
import { InfoTooltip } from "@/components/ui/info-tooltip"

interface TrainingLoadIndicatorProps {
  activities: Activity[]
  /** When true, renders a compact pill suited for headers/footers */
  compact?: boolean
}

function statusConfig(status: LoadStatus, t: (key: TranslationKey) => string) {
  switch (status) {
    case "optimal":
      return {
        label: t("loadIndicator.optimal"),
        Icon: TrendingUp,
        dotClass: "bg-emerald-500",
        textClass: "text-emerald-600 dark:text-emerald-400",
        ringClass: "ring-emerald-200 dark:ring-emerald-800",
        bgClass: "bg-emerald-50 dark:bg-emerald-950/40",
      }
    case "high":
      return {
        label: t("loadIndicator.high"),
        Icon: ActivityIcon,
        dotClass: "bg-amber-500",
        textClass: "text-amber-600 dark:text-amber-400",
        ringClass: "ring-amber-200 dark:ring-amber-800",
        bgClass: "bg-amber-50 dark:bg-amber-950/40",
      }
    case "overtraining_risk":
      return {
        label: t("loadIndicator.overtraining"),
        Icon: AlertTriangle,
        dotClass: "bg-red-500",
        textClass: "text-red-600 dark:text-red-400",
        ringClass: "ring-red-200 dark:ring-red-800",
        bgClass: "bg-red-50 dark:bg-red-950/40",
      }
  }
}

/**
 * Unified training load component combining safety status indicator with
 * fitness/fatigue trend chart.
 *
 * Compact mode: a small labeled pill, useful in plan headers.
 * Full mode: status header + metrics row + expandable fitness/fatigue chart.
 */
export function TrainingLoadIndicator({ activities, compact = false }: TrainingLoadIndicatorProps) {
  const { t } = useI18n()
  const [chartExpanded, setChartExpanded] = useState(false)

  const loadStatus = useMemo(() => computeTrainingLoadStatus(activities), [activities])
  const chartData = useMemo(() => computeTrainingLoad(activities), [activities])

  if (activities.length < 4) return null

  const cfg = statusConfig(loadStatus.status, t)
  const { Icon } = cfg

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${cfg.bgClass} ${cfg.ringClass} ${cfg.textClass}`}
        title={loadStatus.fatigue.description ?? undefined}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${cfg.dotClass}`} />
        {cfg.label}
      </span>
    )
  }

  const { acwr, fatigue, prolongedFatigue, athleteLevel } = loadStatus

  // Fitness trend from chart data
  const hasChartData = chartData.length >= 7
  const latest = hasChartData ? chartData[chartData.length - 1] : null
  const twoWeeksAgo = hasChartData ? chartData[Math.max(0, chartData.length - 15)] : null
  const fitnessDelta = latest && twoWeeksAgo ? latest.ctl - twoWeeksAgo.ctl : 0
  const fitnessArrow = fitnessDelta > 0.3 ? "↑" : fitnessDelta < -0.3 ? "↓" : "→"

  const formatDate = (d: string) => {
    const date = new Date(d + "T12:00:00")
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  }

  return (
    <div className={`rounded-2xl ring-1 overflow-hidden ${cfg.bgClass} ${cfg.ringClass}`}>
      {/* Status header */}
      <div className="flex items-center gap-2.5 px-4 py-3">
        <Icon size={16} className={`shrink-0 ${cfg.textClass}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <p className={`text-sm font-semibold ${cfg.textClass}`}>{cfg.label}</p>
            {latest && (
              <span className="text-xs text-muted-foreground">
                Fitness {fitnessArrow} {latest.ctl.toFixed(1)}
              </span>
            )}
          </div>
          {fatigue.description && (
            <p className="mt-0.5 text-xs text-muted-foreground leading-snug">
              {fatigue.description}
            </p>
          )}
          {prolongedFatigue.message && (
            <p className="mt-0.5 text-xs text-muted-foreground leading-snug">
              {prolongedFatigue.message}
            </p>
          )}
          {acwr.message && !fatigue.description && (
            <p className="mt-0.5 text-xs text-muted-foreground leading-snug">
              {acwr.message}
            </p>
          )}
        </div>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-4 border-t border-border/40 divide-x divide-border/40">
        <div className="px-2 py-2 text-center">
          <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground mb-0.5">
            {t("loadIndicator.acwr")}
            <InfoTooltip content="7-day load ÷ 4-week average. Safe range: 0.8–1.3. Above 1.5 means high injury risk." />
          </div>
          <div className={`text-sm font-semibold font-mono ${cfg.textClass}`}>
            {acwr.ratio > 0 ? acwr.ratio.toFixed(2) : "—"}
          </div>
        </div>
        {latest && (
          <div className="px-2 py-2 text-center">
            <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground mb-0.5">
              Form
              <InfoTooltip content="Fitness minus fatigue. Positive = fresh and ready to race. Negative = still building." />
            </div>
            <div className={`text-sm font-semibold font-mono ${cfg.textClass}`}>
              {latest.tsb > 0 ? "+" : ""}{latest.tsb.toFixed(1)}
            </div>
          </div>
        )}
        <div className="px-2 py-2 text-center">
          <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground mb-0.5">
            {t("loadIndicator.fatigue")}
            <InfoTooltip content="Signs of tiredness detected from your heart rate or pace in recent runs." />
          </div>
          <div className="text-sm font-semibold font-mono text-card-foreground capitalize">
            {fatigue.signal === "none"
              ? t("loadIndicator.fatigueNone")
              : fatigue.signal === "both"
                ? t("loadIndicator.fatigueHrPace")
                : fatigue.signal === "hr_elevated"
                  ? t("loadIndicator.fatigueHr")
                  : t("loadIndicator.fatiguePace")}
          </div>
        </div>
        <div className="px-2 py-2 text-center">
          <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground mb-0.5">
            {t("loadIndicator.level")}
            <InfoTooltip content="Your training level based on average weekly km over the last 12 weeks." />
          </div>
          <div className="text-sm font-semibold font-mono text-card-foreground capitalize">
            {t(`loadIndicator.level_${athleteLevel}`)}
          </div>
        </div>
      </div>

      {/* Chart toggle */}
      {hasChartData && (
        <>
          <button
            onClick={() => setChartExpanded(!chartExpanded)}
            className="flex w-full items-center justify-center gap-1.5 border-t border-border/40 py-2 text-xs text-muted-foreground active:bg-muted/30 transition-colors"
          >
            <span>{chartExpanded ? "Hide chart" : "Show chart"}</span>
            <ChevronDown
              size={14}
              className={`transition-transform duration-200 ${chartExpanded ? "rotate-180" : ""}`}
            />
          </button>

          {/* Collapsible momentum graph */}
          <div
            className={`grid transition-all duration-300 ease-in-out ${
              chartExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
            }`}
          >
            <div className="overflow-hidden">
              <MomentumGraph data={chartData} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ---- Momentum Graph Component ----

interface MomentumGraphProps {
  data: TrainingLoadPoint[]
}

function MomentumGraph({ data }: MomentumGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [animated, setAnimated] = useState(false)
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null)
  const [viewDays, setViewDays] = useState<7 | 14 | 30 | 90>(14)
  
  // Trigger animation on mount
  useEffect(() => {
    const timer = setTimeout(() => setAnimated(true), 50)
    return () => clearTimeout(timer)
  }, [])

  // Filter data based on view selection
  const displayData = useMemo(() => {
    return data.slice(-viewDays)
  }, [data, viewDays])

  if (displayData.length < 3) return null

  // Chart dimensions
  const width = 320
  const height = 140
  const padding = { top: 20, right: 16, bottom: 28, left: 16 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom

  // Normalize TSB (form) values for the momentum curve
  const tsbValues = displayData.map(d => d.tsb)
  const minTsb = Math.min(...tsbValues, -5)
  const maxTsb = Math.max(...tsbValues, 5)
  const tsbRange = Math.max(maxTsb - minTsb, 1)

  // Calculate points
  const points = displayData.map((d, i) => {
    const x = padding.left + (i / (displayData.length - 1)) * chartWidth
    const normalizedTsb = (d.tsb - minTsb) / tsbRange
    const y = padding.top + chartHeight - normalizedTsb * chartHeight
    return { x, y, data: d, index: i }
  })

  // Create smooth bezier path
  const createSmoothPath = () => {
    if (points.length < 2) return ""
    
    let path = `M ${points[0].x} ${points[0].y}`
    
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)]
      const p1 = points[i]
      const p2 = points[i + 1]
      const p3 = points[Math.min(points.length - 1, i + 2)]
      
      // Catmull-Rom to Bezier conversion for smooth curves
      const tension = 0.3
      const cp1x = p1.x + (p2.x - p0.x) * tension
      const cp1y = p1.y + (p2.y - p0.y) * tension
      const cp2x = p2.x - (p3.x - p1.x) * tension
      const cp2y = p2.y - (p3.y - p1.y) * tension
      
      path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`
    }
    
    return path
  }

  // Create gradient fill path (closed)
  const createFillPath = () => {
    const linePath = createSmoothPath()
    if (!linePath) return ""
    return `${linePath} L ${points[points.length - 1].x} ${height - padding.bottom} L ${points[0].x} ${height - padding.bottom} Z`
  }

  // Get color based on TSB value
  const getColor = (tsb: number) => {
    if (tsb > 2) return "#22c55e" // Green - fresh
    if (tsb > -2) return "#eab308" // Yellow - neutral
    return "#f97316" // Orange - fatigued
  }

  // Create gradient stops for the line
  const gradientStops = points.map((p, i) => ({
    offset: `${(i / (points.length - 1)) * 100}%`,
    color: getColor(p.data.tsb),
  }))

  const linePath = createSmoothPath()
  const fillPath = createFillPath()
  const pathLength = svgRef.current?.querySelector<SVGPathElement>("#momentumLine")?.getTotalLength() || 1000

  // Format day label
  const formatDayLabel = (dateStr: string) => {
    const date = new Date(dateStr + "T12:00:00")
    if (viewDays <= 14) {
      return date.toLocaleDateString("en-US", { weekday: "short" })
    }
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  }

  // Get tick indices for x-axis labels
  const getTickIndices = () => {
    const count = viewDays <= 14 ? Math.min(7, displayData.length) : Math.min(5, displayData.length)
    const step = Math.floor((displayData.length - 1) / (count - 1))
    return Array.from({ length: count }, (_, i) => Math.min(i * step, displayData.length - 1))
  }

  return (
    <div className="px-3 pb-3 pt-2">
      {/* View toggle */}
      <div className="flex justify-end gap-1 mb-2">
        {([7, 14, 30, 90] as const).map((days) => (
          <button
            key={days}
            onClick={() => setViewDays(days)}
            className={`px-2 py-0.5 text-[10px] rounded-full transition-colors ${
              viewDays === days
                ? "bg-primary/20 text-primary font-medium"
                : "text-muted-foreground hover:bg-muted/50"
            }`}
          >
            {days}d
          </button>
        ))}
      </div>

      {/* SVG Graph */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        style={{ maxHeight: 160 }}
      >
        <defs>
          {/* Line gradient */}
          <linearGradient id="momentumLineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            {gradientStops.map((stop, i) => (
              <stop key={i} offset={stop.offset} stopColor={stop.color} />
            ))}
          </linearGradient>
          
          {/* Fill gradient - follows line color but fades to transparent */}
          <linearGradient id="momentumFillGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.15" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
          
          {/* Glow filter for current day */}
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Zero line */}
        {minTsb < 0 && maxTsb > 0 && (
          <line
            x1={padding.left}
            y1={padding.top + chartHeight - ((0 - minTsb) / tsbRange) * chartHeight}
            x2={width - padding.right}
            y2={padding.top + chartHeight - ((0 - minTsb) / tsbRange) * chartHeight}
            stroke="currentColor"
            strokeOpacity="0.2"
            strokeDasharray="4 4"
            className="text-muted-foreground"
          />
        )}

        {/* Gradient fill under curve */}
        <path
          d={fillPath}
          fill="url(#momentumFillGradient)"
          className="text-emerald-500"
          style={{
            opacity: animated ? 1 : 0,
            transition: "opacity 400ms ease-out 200ms",
          }}
        />

        {/* Main momentum line */}
        <path
          id="momentumLine"
          d={linePath}
          fill="none"
          stroke="url(#momentumLineGradient)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            strokeDasharray: pathLength,
            strokeDashoffset: animated ? 0 : pathLength,
            transition: "stroke-dashoffset 600ms ease-out",
          }}
        />

        {/* Current day indicator only */}
        {points.length > 0 && (() => {
          const lastPoint = points[points.length - 1]
          const color = getColor(lastPoint.data.tsb)
          return (
            <g>
              <circle
                cx={lastPoint.x}
                cy={lastPoint.y}
                r={6}
                fill={color}
                filter="url(#glow)"
                style={{
                  opacity: animated ? 1 : 0,
                  transition: "opacity 300ms ease-out 400ms",
                }}
              />
              <circle
                cx={lastPoint.x}
                cy={lastPoint.y}
                r={2.5}
                fill="white"
                style={{
                  opacity: animated ? 1 : 0,
                  transition: "opacity 300ms ease-out 400ms",
                }}
              />
            </g>
          )
        })()}

        {/* Invisible touch targets for interactivity */}
        {points.map((p, i) => (
          <circle
            key={`touch-${i}`}
            cx={p.x}
            cy={p.y}
            r={12}
            fill="transparent"
            style={{ cursor: "pointer" }}
            onPointerDown={() => setSelectedPoint(selectedPoint === i ? null : i)}
          />
        ))}

        {/* X-axis labels */}
        {getTickIndices().map((idx) => {
          const p = points[idx]
          if (!p) return null
          return (
            <text
              key={idx}
              x={p.x}
              y={height - 8}
              textAnchor="middle"
              className="text-muted-foreground"
              style={{ fontSize: 9, fill: "currentColor" }}
            >
              {formatDayLabel(p.data.date)}
            </text>
          )
        })}

        {/* Tooltip */}
        {selectedPoint !== null && points[selectedPoint] && (
          <g>
            <rect
              x={Math.min(Math.max(points[selectedPoint].x - 45, 5), width - 95)}
              y={Math.max(points[selectedPoint].y - 52, 5)}
              width={90}
              height={48}
              rx={6}
              fill="var(--card)"
              stroke="var(--border)"
              strokeWidth="1"
            />
            <text
              x={Math.min(Math.max(points[selectedPoint].x, 50), width - 50)}
              y={Math.max(points[selectedPoint].y - 36, 21)}
              textAnchor="middle"
              style={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            >
              {new Date(points[selectedPoint].data.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </text>
            <text
              x={Math.min(Math.max(points[selectedPoint].x - 28, 22), width - 78)}
              y={Math.max(points[selectedPoint].y - 20, 37)}
              style={{ fontSize: 9, fill: "var(--muted-foreground)" }}
            >
              Fitness: {points[selectedPoint].data.ctl.toFixed(1)}
            </text>
            <text
              x={Math.min(Math.max(points[selectedPoint].x - 28, 22), width - 78)}
              y={Math.max(points[selectedPoint].y - 8, 49)}
              style={{ fontSize: 9, fill: "var(--muted-foreground)" }}
            >
              Fatigue: {points[selectedPoint].data.atl.toFixed(1)}
            </text>
          </g>
        )}
      </svg>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-1">
        <div className="flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="text-[10px] text-muted-foreground">Fresh</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-full bg-yellow-500" />
          <span className="text-[10px] text-muted-foreground">Neutral</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-full bg-orange-500" />
          <span className="text-[10px] text-muted-foreground">Building</span>
        </div>
      </div>
    </div>
  )
}
