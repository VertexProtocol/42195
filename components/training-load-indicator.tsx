"use client"

import { useState, useMemo } from "react"
import { Activity as ActivityIcon, TrendingUp, AlertTriangle, Heart, TrendingDown, Zap, X } from "lucide-react"
import type { Activity } from "@/lib/types"
import { computeTrainingLoadStatus, type LoadStatus } from "@/lib/training-safety"
import { computeTrainingLoad, type TrainingLoadPoint } from "@/lib/training-utils"
import { isRunActivity } from "@/lib/format"
import { useI18n, type TranslationKey } from "@/lib/i18n"
import { InfoTooltip } from "@/components/ui/info-tooltip"
import type { Warning, WarningSeverity, WarningType } from "@/lib/training-warnings"

interface TrainingLoadIndicatorProps {
  activities: Activity[]
  /** When true, renders a compact pill suited for headers/footers */
  compact?: boolean
  /** Proactive warnings from the warnings engine — rendered as dismissible rows at the bottom of the card */
  warnings?: Warning[]
  onDismissWarning?: (type: WarningType) => void | Promise<void>
}

const WARNING_ICON_BY_TYPE: Record<WarningType, typeof AlertTriangle> = {
  elevated_acwr: Zap,
  prolonged_fatigue: AlertTriangle,
  hr_drift: Heart,
  pace_drift: TrendingDown,
}

const WARNING_SEVERITY_TEXT: Record<WarningSeverity, string> = {
  info: "text-primary",
  warn: "text-amber-600 dark:text-amber-400",
  critical: "text-destructive",
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
export function TrainingLoadIndicator({ activities, compact = false, warnings = [], onDismissWarning }: TrainingLoadIndicatorProps) {
  const { t } = useI18n()

  // Scope load + fatigue analysis to running activities only. Cycling, hiking,
  // and other cross-training would otherwise inflate chronic load and cause
  // false "high" or "overtraining_risk" labels for runners who also bike/swim.
  const runActivities = useMemo(
    () => activities.filter((a) => isRunActivity(a.type)),
    [activities],
  )

  const loadStatus = useMemo(() => computeTrainingLoadStatus(runActivities), [runActivities])
  const chartData = useMemo(() => computeTrainingLoad(runActivities), [runActivities])

  const [dismissing, setDismissing] = useState<Set<WarningType>>(new Set())
  const [hidden, setHidden] = useState<Set<WarningType>>(new Set())
  const visibleWarnings = warnings.filter((w) => !hidden.has(w.type))

  if (runActivities.length < 4) return null

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

  const { acwr, athleteLevel, fatigue } = loadStatus

  const handleDismiss = async (type: WarningType) => {
    if (dismissing.has(type)) return
    setDismissing((prev) => new Set(prev).add(type))
    try {
      await onDismissWarning?.(type)
      setHidden((prev) => new Set(prev).add(type))
    } finally {
      setDismissing((prev) => {
        const next = new Set(prev)
        next.delete(type)
        return next
      })
    }
  }

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
      {/* Status header — advisory messages moved to the warning rows below so
          they can be dismissed and get a visible severity chip */}
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

      {/* Proactive warnings — dismissible rows that replace the passive message
          lines that used to live in the header */}
      {visibleWarnings.length > 0 && (
        <div className="border-t border-border/40">
          {visibleWarnings.map((w, i) => {
            const WarningIcon = WARNING_ICON_BY_TYPE[w.type]
            const textClass = WARNING_SEVERITY_TEXT[w.severity]
            const isDismissing = dismissing.has(w.type)
            return (
              <div
                key={w.type}
                className={`flex items-start gap-2.5 px-4 py-2.5 ${
                  i < visibleWarnings.length - 1 ? "border-b border-border/40" : ""
                }`}
              >
                <WarningIcon size={14} className={`shrink-0 mt-0.5 ${textClass}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-semibold ${textClass}`}>{w.title}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                    {w.message}
                  </p>
                </div>
                {onDismissWarning && (
                  <button
                    onClick={() => handleDismiss(w.type)}
                    disabled={isDismissing}
                    aria-label="Dismiss warning"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:opacity-50 transition-colors -mt-0.5"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

