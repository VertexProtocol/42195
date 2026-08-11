"use client"

import { useState, useMemo, useSyncExternalStore } from "react"
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
import {
  computeTrainingLoadStatus,
  type AcwrSafety,
  type LoadStatus,
} from "@/lib/training-safety"
import { isRunActivity, formatDateShort } from "@/lib/format"
import { useI18n, type TranslationKey } from "@/lib/i18n"
import { InfoTooltip } from "@/components/ui/info-tooltip"
import { AppCard } from "@/components/ui/app-card"
import { Meter } from "@/components/ui/meter"
import { Pill } from "@/components/ui/pill"
import {
  ACWR_LOW_THRESHOLD,
  ACWR_HIGH_THRESHOLD,
  ACWR_UNSAFE_THRESHOLD,
  LOAD_INDICATOR_MIN_RUNS,
  FITNESS_TREND_LOOKBACK_DAYS,
  FITNESS_TREND_MIN_DELTA,
} from "@/lib/training-constants"
import type { Warning, WarningSeverity, WarningType } from "@/lib/training-warnings"

/**
 * Training load — the "should I run today" answer.
 *
 * The status is carried by a labelled pill and by the meter's tone, never by
 * a tinted card alone: colour is the second cue here, not the only one. The
 * card itself stays neutral so that a red state does not turn a third of the
 * Today screen into an alarm.
 *
 * Nothing here states a number the engine did not actually measure. Two of the
 * fields have an "unknown" that is not a value — fatigue reports "none" both
 * when it compared and found nothing and when it had too few runs to compare,
 * and the athlete level falls back to "beginner" on thin history — and this
 * card used to render both as confident readings, on the same card whose own
 * headline admitted it had no baseline yet. Where the engine does not know,
 * the card says so.
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

/**
 * The card's own advice line, keyed by risk tier.
 *
 * AcwrSafety carries a `message` for each tier already, but that prose is
 * written for the coach prompt and only exists in English — rendering it here
 * would put an English sentence inside a Norwegian card, which is the bug this
 * pass removed from the warnings engine. The engine decides the tier; the
 * dictionary decides the wording.
 */
const ADVICE_KEY_BY_RISK: Record<AcwrSafety["risk"], TranslationKey | null> = {
  no_baseline: null, // the empty state below says this at more length
  detraining: "loadIndicator.advice_detraining",
  low: null, // in the band and nothing to report — silence is the message
  moderate: "loadIndicator.advice_moderate",
  high: "loadIndicator.advice_high",
  unsafe: "loadIndicator.advice_unsafe",
}

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
    case "detraining":
      return {
        label: t("loadIndicator.detraining"),
        Icon: TrendingDown,
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

/**
 * Where the optimal ACWR band sits on a bar that runs from 0 to the unsafe
 * threshold. Derived, not typed in: the scale labels used to sit at 0/50/100%
 * while the band they named covered 53–87%, so "Optimal" pointed at an ACWR of
 * 0.75 — below the band it was labelling.
 */
/** useSyncExternalStore arguments for "has this rendered on the client yet". */
const NEVER_CHANGES = () => () => {}
const onClient = () => true
const onServer = () => false

const BAND_FROM_PCT = (ACWR_LOW_THRESHOLD / ACWR_UNSAFE_THRESHOLD) * 100
const BAND_TO_PCT = (ACWR_HIGH_THRESHOLD / ACWR_UNSAFE_THRESHOLD) * 100
const BAND_CENTER_PCT = (BAND_FROM_PCT + BAND_TO_PCT) / 2

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

  // Every window in the engine is measured back from "now", so a server render
  // and the client render that follows it can land on different days and
  // disagree. This used to be papered over with suppressHydrationWarning on the
  // one line that showed a number; the card instead holds off until it is on
  // the client, and then measures every signal from a single reference date.
  const hydrated = useSyncExternalStore(NEVER_CHANGES, onClient, onServer)
  const referenceDate = useMemo(() => (hydrated ? new Date() : null), [hydrated])

  const loadStatus = useMemo(
    () => (referenceDate ? computeTrainingLoadStatus(runActivities, referenceDate) : null),
    [runActivities, referenceDate],
  )

  const [dismissing, setDismissing] = useState<Set<WarningType>>(new Set())
  const [hidden, setHidden] = useState<Set<WarningType>>(new Set())
  const visibleWarnings = warnings.filter((w) => !hidden.has(w.type))

  if (!loadStatus) return null
  if (runActivities.length < LOAD_INDICATOR_MIN_RUNS) return null

  const cfg = statusConfig(loadStatus.status, t)
  const { Icon } = cfg

  if (compact) {
    return (
      <Pill tone={cfg.tone} icon={<Icon size={11} />}>
        {cfg.label}
      </Pill>
    )
  }

  const { acwr, athleteLevel, athleteLevelKnown, fatigue, prolongedFatigue, loadPoints } =
    loadStatus

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

  const warningList = visibleWarnings.length > 0 && (
    <ul className="border-t border-border">
      {visibleWarnings.map((w) => {
        const WarningIcon = WARNING_ICON_BY_TYPE[w.type]
        const textClass = WARNING_SEVERITY_TEXT[w.severity]
        const isDismissing = dismissing.has(w.type)
        const title = t(w.titleKey, w.params)
        return (
          <li
            key={w.type}
            className="flex items-start gap-2.5 border-b border-border px-4 py-3 last:border-b-0"
          >
            <WarningIcon size={15} className={`mt-px shrink-0 ${textClass}`} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className={`text-label font-semibold ${textClass}`}>{title}</p>
              <p className="mt-0.5 text-micro leading-relaxed text-muted-foreground">
                {t(w.messageKey, w.params)}
              </p>
            </div>
            {onDismissWarning && (
              <button
                onClick={() => handleDismiss(w.type)}
                disabled={isDismissing}
                aria-label={`${t("loadIndicator.dismiss")}: ${title}`}
                className="press -mr-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <X size={14} />
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )

  // ── Nothing to measure against ────────────────────────────────────────────
  // Chronic load is zero: no running in the last four weeks. A meter at 0/100
  // under a scale ending in "High" reads as "your load is low", which is a
  // claim about training that has not happened. Say what is missing instead,
  // and drop the fields that would otherwise be filled with defaults.
  if (loadStatus.status === "insufficient_data") {
    const lastRun = runActivities.reduce<Activity | null>(
      (latest, a) =>
        !latest || new Date(a.date).getTime() > new Date(latest.date).getTime() ? a : latest,
      null,
    )
    return (
      <AppCard padding="sm" className="p-0">
        <div className="px-4 pb-3.5 pt-3.5">
          <Pill tone={cfg.tone} icon={<Icon size={11} />}>
            {cfg.label}
          </Pill>
          <p className="mt-2.5 text-micro leading-relaxed text-muted-foreground">
            {t("loadIndicator.baselineEmptyBody")}
          </p>
          {lastRun && (
            <p className="mt-1.5 text-micro text-muted-foreground">
              {t("loadIndicator.lastRun")}{" "}
              <span className="measure font-medium text-foreground">
                {formatDateShort(lastRun.date)}
              </span>
            </p>
          )}
        </div>
        {warningList}
      </AppCard>
    )
  }

  // Fitness only means something once the model has load to decay. The old
  // guard asked whether the series had 7 points, which it always does whenever
  // there is a single activity anywhere in the window.
  const latest = loadPoints.length > 0 ? loadPoints[loadPoints.length - 1] : null
  const priorIdx = loadPoints.length - 1 - FITNESS_TREND_LOOKBACK_DAYS
  const prior = priorIdx >= 0 ? loadPoints[priorIdx] : null
  const showFitness = latest !== null && latest.ctl > 0

  const fitnessDelta = latest && prior ? latest.ctl - prior.ctl : 0
  const fitnessTrend =
    fitnessDelta > FITNESS_TREND_MIN_DELTA
      ? t("loadIndicator.rising")
      : fitnessDelta < -FITNESS_TREND_MIN_DELTA
        ? t("loadIndicator.easing")
        : t("loadIndicator.steady")

  // The bar is clamped at the unsafe threshold, but the ratio beside it is
  // not: at 100/100 an ACWR of 1.5 and one of 2.5 looked identical, and the
  // more dangerous of the two was the one the runner could not see.
  const loadPct = Math.min((acwr.ratio / ACWR_UNSAFE_THRESHOLD) * 100, 100)
  const ratioText = t("loadIndicator.ratio", { ratio: acwr.ratio.toFixed(2) })

  // Prolonged fatigue can set the headline to "Overtraining Risk" on its own.
  // While it was missing from this grid, the card could carry that pill above a
  // Fatigue cell reading "Normal", with nothing to explain the contradiction.
  const fatigueText = prolongedFatigue.detected
    ? t("loadIndicator.fatigueSustained", {
        weeks: prolongedFatigue.consecutiveNegativeTsbWeeks,
      })
    : !fatigue.hasEnoughData
      ? t("loadIndicator.unknown")
      : fatigue.signal === "none"
        ? t("loadIndicator.fatigueNone")
        : fatigue.signal === "both"
          ? t("loadIndicator.fatigueHrPace")
          : fatigue.signal === "hr_elevated"
            ? t("loadIndicator.fatigueHr")
            : t("loadIndicator.fatiguePace")

  const adviceKey = prolongedFatigue.detected
    ? "loadIndicator.advice_prolongedFatigue"
    : ADVICE_KEY_BY_RISK[acwr.risk]

  return (
    <AppCard padding="sm" className="p-0">
      <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-3.5">
        <Pill tone={cfg.tone} icon={<Icon size={11} />}>
          {cfg.label}
        </Pill>
        {showFitness && latest && (
          <span className="text-micro text-muted-foreground">
            {t("loadIndicator.fitness")} {fitnessTrend}{" "}
            <span className="measure font-medium text-foreground">{latest.ctl.toFixed(1)}</span>
          </span>
        )}
      </div>

      <div className="px-4 pb-3.5">
        <div className="mb-1.5 flex items-baseline justify-between gap-2 text-micro">
          <span className="flex items-center gap-1 text-muted-foreground">
            {t("loadIndicator.trainingLoad")}
            <InfoTooltip content={t("loadIndicator.ratioHelp")} />
          </span>
          <span className="measure shrink-0 font-medium text-foreground">{ratioText}</span>
        </div>
        <Meter
          value={loadPct}
          tone={cfg.meterTone}
          label={t("loadIndicator.trainingLoad")}
          valueText={`${ratioText} — ${cfg.label}`}
          zone={{ from: BAND_FROM_PCT, to: BAND_TO_PCT }}
        />
        {/* Absolute rather than space-between: the middle label names the band
            drawn on the track above it, so it has to sit over the band. The
            first span is an in-flow spacer that gives the row the height of one
            line of its own type — absolute children contribute nothing, and a
            fixed height here would be a second copy of the line-height token. */}
        <div className="relative mt-1.5 text-micro text-muted-foreground" aria-hidden>
          <span className="invisible">&nbsp;</span>
          <span className="absolute left-0 top-0">{t("loadIndicator.scaleLow")}</span>
          <span
            className="absolute top-0 -translate-x-1/2 whitespace-nowrap"
            style={{ left: `${BAND_CENTER_PCT}%` }}
          >
            {t("loadIndicator.scaleOptimal")}
          </span>
          <span className="absolute right-0 top-0">{t("loadIndicator.scaleHigh")}</span>
        </div>
        {adviceKey && (
          <p className="mt-2 text-micro leading-relaxed text-muted-foreground">{t(adviceKey)}</p>
        )}
      </div>

      <dl className="grid grid-cols-2 border-t border-border">
        <div className="px-4 py-3">
          <dt className="flex items-center gap-1 text-micro text-muted-foreground">
            {t("loadIndicator.fatigue")}
            <InfoTooltip content={t("loadIndicator.fatigueHelp")} />
          </dt>
          <dd
            className={`mt-1 text-label font-semibold ${
              fatigue.hasEnoughData || prolongedFatigue.detected
                ? "text-card-foreground"
                : "text-muted-foreground"
            }`}
          >
            {fatigueText}
          </dd>
        </div>
        <div className="border-l border-border px-4 py-3">
          <dt className="flex items-center gap-1 text-micro text-muted-foreground">
            {t("loadIndicator.level")}
            <InfoTooltip content={t("loadIndicator.levelHelp")} />
          </dt>
          <dd
            className={`mt-1 text-label font-semibold ${
              athleteLevelKnown ? "text-card-foreground" : "text-muted-foreground"
            }`}
          >
            {athleteLevelKnown
              ? t(`loadIndicator.level_${athleteLevel}`)
              : t("loadIndicator.unknown")}
          </dd>
        </div>
      </dl>

      {warningList}
    </AppCard>
  )
}
