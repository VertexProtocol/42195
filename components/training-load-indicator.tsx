"use client"

import { useMemo, useState } from "react"
import {
  AreaChart,
  Area,
  XAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts"
import { Activity as ActivityIcon, TrendingUp, AlertTriangle, ChevronDown } from "lucide-react"
import type { Activity } from "@/lib/types"
import { computeTrainingLoadStatus, type LoadStatus } from "@/lib/training-safety"
import { computeTrainingLoad } from "@/lib/training-utils"
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

          {/* Collapsible fitness/fatigue chart */}
          <div
            className={`grid transition-all duration-300 ease-in-out ${
              chartExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
            }`}
          >
            <div className="overflow-hidden">
              <div className="px-2 pb-2 pt-1">
                <ResponsiveContainer width="100%" height={120}>
                  <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                    <defs>
                      <linearGradient id="fitnessGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="fatigueGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--chart-5)" stopOpacity={0.15} />
                        <stop offset="100%" stopColor="var(--chart-5)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatDate}
                      tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                      minTickGap={50}
                    />
                    <Tooltip
                      labelFormatter={formatDate}
                      formatter={(value: number, name: string) => [
                        value.toFixed(1),
                        name === "ctl" ? "Fitness" : "Fatigue",
                      ]}
                      contentStyle={{
                        fontSize: 11,
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "var(--card)",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="ctl"
                      name="ctl"
                      stroke="var(--chart-2)"
                      fill="url(#fitnessGrad)"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="atl"
                      name="atl"
                      stroke="var(--chart-5)"
                      fill="url(#fatigueGrad)"
                      strokeWidth={1.5}
                      dot={false}
                      strokeDasharray="4 2"
                    />
                  </AreaChart>
                </ResponsiveContainer>
                <div className="flex items-center justify-center gap-4 pt-1 pb-1">
                  <div className="flex items-center gap-1.5">
                    <div className="h-0.5 w-3 rounded-full" style={{ background: "var(--chart-2)" }} />
                    <span className="text-[10px] text-muted-foreground">Fitness</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="h-0.5 w-3 rounded-full" style={{ background: "var(--chart-5)", opacity: 0.7 }} />
                    <span className="text-[10px] text-muted-foreground">Fatigue</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
