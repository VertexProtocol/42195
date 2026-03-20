"use client"

import { useMemo } from "react"
import { Activity as ActivityIcon, TrendingUp, AlertTriangle } from "lucide-react"
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
              <span className="text-xs text-muted-foreground" suppressHydrationWarning>
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
        </div>
      </div>

      {/* Load bar 0–100 */}
      <div className="border-t border-border/40 px-4 py-3">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1.5">
          <span>Training Load</span>
          <span className="font-medium tabular-nums">
            {acwr.ratio > 0 ? Math.min(Math.round((acwr.ratio / 1.5) * 100), 100) : 0}
            <span className="text-muted-foreground/60"> / 100</span>
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-secondary">
          {acwr.ratio > 0 && (
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${Math.min((acwr.ratio / 1.5) * 100, 100)}%` }}
            />
          )}
        </div>
        <div className="flex justify-between text-[9px] text-muted-foreground/60 mt-1">
          <span>Low</span>
          <span className="text-emerald-600/70 dark:text-emerald-400/70">Optimal</span>
          <span>High</span>
        </div>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-2 border-t border-border/40 divide-x divide-border/40">
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
    </div>
  )
}

