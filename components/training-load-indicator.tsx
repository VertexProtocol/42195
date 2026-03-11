"use client"

import { useMemo } from "react"
import { Activity as ActivityIcon, TrendingUp, AlertTriangle } from "lucide-react"
import type { Activity } from "@/lib/types"
import { computeTrainingLoadStatus, type LoadStatus } from "@/lib/training-safety"
import { useI18n } from "@/lib/i18n"
import { InfoTooltip } from "@/components/ui/info-tooltip"

interface TrainingLoadIndicatorProps {
  activities: Activity[]
  /** When true, renders a compact pill suited for headers/footers */
  compact?: boolean
}

function statusConfig(status: LoadStatus, t: (key: string) => string) {
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
 * A simple visual indicator showing the athlete's current training load status:
 * "Optimal" | "High Load" | "Overtraining Risk"
 *
 * Compact mode: a small labeled pill, useful in plan headers.
 * Full mode: a card with ACWR ratio, fatigue signal, and athlete level.
 */
export function TrainingLoadIndicator({ activities, compact = false }: TrainingLoadIndicatorProps) {
  const { t } = useI18n()

  const loadStatus = useMemo(() => computeTrainingLoadStatus(activities), [activities])

  // Don't render if there's no data
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

  return (
    <div className={`rounded-2xl ring-1 overflow-hidden ${cfg.bgClass} ${cfg.ringClass}`}>
      {/* Header row */}
      <div className="flex items-center gap-2.5 px-4 py-3">
        <Icon size={16} className={`shrink-0 ${cfg.textClass}`} />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${cfg.textClass}`}>{cfg.label}</p>
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
      <div className="grid grid-cols-3 border-t border-border/40 divide-x divide-border/40">
        <div className="px-3 py-2 text-center">
          <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground mb-0.5">
            {t("loadIndicator.acwr")}
            <InfoTooltip content="7-day load ÷ 4-week average. Safe range: 0.8–1.3. Above 1.5 means high injury risk." />
          </div>
          <div className={`text-sm font-semibold font-mono ${cfg.textClass}`}>
            {acwr.ratio > 0 ? acwr.ratio.toFixed(2) : "—"}
          </div>
        </div>
        <div className="px-3 py-2 text-center">
          <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground mb-0.5">
            {t("loadIndicator.fatigue")}
            <InfoTooltip content="Signs of tiredness detected from your heart rate or pace in recent runs." />
          </div>
          <div className="text-sm font-semibold font-mono text-card-foreground capitalize">
            {fatigue.signal === "none"
              ? "—"
              : fatigue.signal === "both"
                ? t("loadIndicator.fatigueHrPace")
                : fatigue.signal === "hr_elevated"
                  ? t("loadIndicator.fatigueHr")
                  : t("loadIndicator.fatiguePace")}
          </div>
        </div>
        <div className="px-3 py-2 text-center">
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
