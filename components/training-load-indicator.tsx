"use client"

import { useState, useMemo } from "react"
import {
  Activity as ActivityIcon,
  TrendingUp,
  TriangleAlert,
  Heart,
  TrendingDown,
  Zap,
  X,
} from "lucide-react"
import type { Activity } from "@/lib/types"
import { computeTrainingLoadStatus, type LoadStatus } from "@/lib/training-safety"
import { computeTrainingLoad } from "@/lib/training-utils"
import { isRunActivity } from "@/lib/format"
import { useI18n, type TranslationKey } from "@/lib/i18n"
import { InfoTooltip } from "@/components/ui/info-tooltip"
import { AppCard } from "@/components/ui/app-card"
import { Meter } from "@/components/ui/meter"
import { Pill } from "@/components/ui/pill"
import type { Warning, WarningSeverity, WarningType } from "@/lib/training-warnings"

/**
 * Training load — the "should I run today" answer.
 *
 * The status is carried by a labelled pill and by the meter's tone, never by
 * a tinted card alone: colour is the second cue here, not the only one. The
 * card itself stays neutral so that a red state does not turn a third of the
 * Today screen into an alarm.
 */

interface TrainingLoadIndicatorProps {
  activities: Activity[]
  /** Compact renders a single labelled pill, for use inside a plan header. */
  compact?: boolean
  warnings?: Warning[]
  onDismissWarning?: (type: WarningType) => void | Promise<void>
}

const WARNING_ICON_BY_TYPE: Record<WarningType, typeof TriangleAlert> = {
  elevated_acwr: Zap,
  prolonged_fatigue: TriangleAlert,
  hr_drift: Heart,
  pace_drift: TrendingDown,
}

const WARNING_SEVERITY_TEXT: Record<WarningSeverity, string> = {
  info: "text-primary",
  warn: "text-warning",
  critical: "text-destructive",
}

type Tone = "neutral" | "positive" | "caution" | "negative"

function statusConfig(status: LoadStatus, t: (key: TranslationKey) => string) {
  switch (status) {
    case "insufficient_data":
      return {
        label: t("loadIndicator.insufficientData"),
        Icon: ActivityIcon,
        tone: "neutral" as Tone,
        meterTone: "quiet" as const,
        textClass: "text-muted-foreground",
      }
    case "optimal":
      return {
        label: t("loadIndicator.optimal"),
        Icon: TrendingUp,
        tone: "positive" as Tone,
        meterTone: "done" as const,
        textClass: "text-success",
      }
    case "high":
      return {
        label: t("loadIndicator.high"),
        Icon: ActivityIcon,
        tone: "caution" as Tone,
        meterTone: "caution" as const,
        textClass: "text-warning",
      }
    case "overtraining_risk":
      return {
        label: t("loadIndicator.overtraining"),
        Icon: TriangleAlert,
        tone: "negative" as Tone,
        meterTone: "action" as const,
        textClass: "text-destructive",
      }
  }
}

export function TrainingLoadIndicator({
  activities,
  compact = false,
  warnings = [],
  onDismissWarning,
}: TrainingLoadIndicatorProps) {
  const { t } = useI18n()

  // Load and fatigue are running-specific. Cycling and swimming would inflate
  // chronic load and produce false "high" labels for runners who cross-train.
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
      <Pill tone={cfg.tone} icon={<Icon size={11} />}>
        {cfg.label}
      </Pill>
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

  const hasChartData = chartData.length >= 7
  const latest = hasChartData ? chartData[chartData.length - 1] : null
  const twoWeeksAgo = hasChartData ? chartData[Math.max(0, chartData.length - 15)] : null

  const fitnessDelta = latest && twoWeeksAgo ? latest.ctl - twoWeeksAgo.ctl : 0
  const fitnessTrend =
    fitnessDelta > 0.3 ? t("loadIndicator.rising") : fitnessDelta < -0.3 ? t("loadIndicator.easing") : t("loadIndicator.steady")

  const loadValue = acwr.ratio > 0 ? Math.min(Math.round((acwr.ratio / 1.5) * 100), 100) : 0

  return (
    <AppCard padding="sm" className="p-0">
      <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-3.5">
        <Pill tone={cfg.tone} icon={<Icon size={11} />}>
          {cfg.label}
        </Pill>
        {latest && (
          <span className="text-micro text-muted-foreground" suppressHydrationWarning>
            {t("loadIndicator.fitness")} {fitnessTrend}{" "}
            <span className="measure font-medium text-foreground">{latest.ctl.toFixed(1)}</span>
          </span>
        )}
      </div>

      <div className="px-4 pb-3.5">
        <div className="mb-1.5 flex items-baseline justify-between text-micro">
          <span className="text-muted-foreground">{t("loadIndicator.trainingLoad")}</span>
          <span className="measure font-medium text-foreground">{loadValue} / 100</span>
        </div>
        <Meter
          value={loadValue}
          tone={cfg.meterTone}
          label={t("loadIndicator.trainingLoad")}
          valueText={`${loadValue} / 100 — ${cfg.label}`}
        />
        <div className="mt-1.5 flex justify-between text-micro text-muted-foreground">
          <span>{t("loadIndicator.scaleLow")}</span>
          <span>{t("loadIndicator.scaleOptimal")}</span>
          <span>{t("loadIndicator.scaleHigh")}</span>
        </div>
      </div>

      <dl className="grid grid-cols-2 border-t border-border">
        <div className="px-4 py-3">
          <dt className="flex items-center gap-1 text-micro text-muted-foreground">
            {t("loadIndicator.fatigue")}
            <InfoTooltip content={t("loadIndicator.fatigueHelp")} />
          </dt>
          <dd className="mt-1 text-label font-semibold text-card-foreground">
            {fatigue.signal === "none"
              ? t("loadIndicator.fatigueNone")
              : fatigue.signal === "both"
                ? t("loadIndicator.fatigueHrPace")
                : fatigue.signal === "hr_elevated"
                  ? t("loadIndicator.fatigueHr")
                  : t("loadIndicator.fatiguePace")}
          </dd>
        </div>
        <div className="border-l border-border px-4 py-3">
          <dt className="flex items-center gap-1 text-micro text-muted-foreground">
            {t("loadIndicator.level")}
            <InfoTooltip content={t("loadIndicator.levelHelp")} />
          </dt>
          <dd className="mt-1 text-label font-semibold capitalize text-card-foreground">
            {t(`loadIndicator.level_${athleteLevel}`)}
          </dd>
        </div>
      </dl>

      {visibleWarnings.length > 0 && (
        <ul className="border-t border-border">
          {visibleWarnings.map((w) => {
            const WarningIcon = WARNING_ICON_BY_TYPE[w.type]
            const textClass = WARNING_SEVERITY_TEXT[w.severity]
            const isDismissing = dismissing.has(w.type)
            return (
              <li
                key={w.type}
                className="flex items-start gap-2.5 border-b border-border px-4 py-3 last:border-b-0"
              >
                <WarningIcon size={15} className={`mt-px shrink-0 ${textClass}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className={`text-label font-semibold ${textClass}`}>{w.title}</p>
                  <p className="mt-0.5 text-micro leading-relaxed text-muted-foreground">
                    {w.message}
                  </p>
                </div>
                {onDismissWarning && (
                  <button
                    onClick={() => handleDismiss(w.type)}
                    disabled={isDismissing}
                    aria-label={`${t("loadIndicator.dismiss")}: ${w.title}`}
                    className="press -mr-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    <X size={14} />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </AppCard>
  )
}
