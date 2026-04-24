"use client"

import { Target, Trophy, Pause } from "lucide-react"
import { AppCard } from "@/components/ui/app-card"
import { useI18n, type TranslationKey } from "@/lib/i18n"
import { formatPace } from "@/lib/format"
import type { IntervalAnalysis, IntensityLevel, Segment, WorkoutPattern } from "@/lib/interval-analysis"

interface Props {
  analysis: IntervalAnalysis
}

/** mm:ss formatter for lap-ish durations */
function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, "0")}`
}

const PATTERN_KEY: Record<WorkoutPattern, TranslationKey> = {
  intervals: "intervals.pattern_intervals",
  progression: "intervals.pattern_progression",
  pyramid: "intervals.pattern_pyramid",
  steady: "intervals.pattern_steady",
  mixed: "intervals.pattern_mixed",
}

const INTENSITY_KEY: Record<IntensityLevel, TranslationKey> = {
  easy: "intervals.intensity_easy",
  moderate: "intervals.intensity_moderate",
  tempo: "intervals.intensity_tempo",
  hard: "intervals.intensity_hard",
  max: "intervals.intensity_max",
}

/** Tailwind colour tokens per intensity — consistent bar + badge palette */
const INTENSITY_COLOURS: Record<IntensityLevel, { bar: string; text: string; dot: string }> = {
  easy:     { bar: "bg-emerald-500/30", text: "text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500" },
  moderate: { bar: "bg-lime-500/40",    text: "text-lime-700 dark:text-lime-400",       dot: "bg-lime-500" },
  tempo:    { bar: "bg-amber-500/50",   text: "text-amber-700 dark:text-amber-400",     dot: "bg-amber-500" },
  hard:     { bar: "bg-orange-500/60",  text: "text-orange-700 dark:text-orange-400",   dot: "bg-orange-500" },
  max:      { bar: "bg-red-500/70",     text: "text-red-700 dark:text-red-400",         dot: "bg-red-500" },
}

const WARMUP_COLOUR = { bar: "bg-violet-400/40", text: "text-violet-700 dark:text-violet-400" }
const COOLDOWN_COLOUR = { bar: "bg-slate-400/40", text: "text-slate-700 dark:text-slate-400" }

export function IntervalAnalysisCard({ analysis }: Props) {
  const { t } = useI18n()

  if (!analysis.detected) return null

  const workSegments = analysis.segments.filter((s) => s.type === "work")
  const fastestWork = workSegments.reduce<Segment | null>((best, s) => {
    if (s.avgPaceMinPerKm == null) return best
    if (best == null || best.avgPaceMinPerKm == null) return s
    return s.avgPaceMinPerKm < best.avgPaceMinPerKm ? s : best
  }, null)

  // Longest segment duration — used to scale the bar widths proportionally
  const longest = analysis.segments.reduce((m, s) => Math.max(m, s.durationSeconds), 0) || 1

  // Consistency copy: substitute {n} token with the real pace spread
  const consistencyCopy = analysis.consistencyLabel && analysis.paceSpreadSec != null
    ? t(`intervals.consistency_${analysis.consistencyLabel}` as TranslationKey)
        .replace("{n}", String(analysis.paceSpreadSec))
    : null

  return (
    <AppCard>
      <div className="flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-xl bg-primary/10">
            <Target size={16} className="text-primary" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("intervals.title")}
            </p>
            <p className="text-sm font-semibold text-foreground">
              {workSegments.length}{" "}
              {workSegments.length === 1 ? t("intervals.workInterval") : t("intervals.workIntervals")}
              {" · "}
              <span className="text-primary">{t(PATTERN_KEY[analysis.pattern])}</span>
            </p>
          </div>
        </div>

        {/* Segment bars */}
        <ul className="flex flex-col gap-1.5">
          {analysis.segments.map((s) => {
            const isFastest = fastestWork?.index === s.index
            const widthPct = Math.max(8, (s.durationSeconds / longest) * 100)
            const palette =
              s.type === "warmup" ? WARMUP_COLOUR :
              s.type === "cooldown" ? COOLDOWN_COLOUR :
              INTENSITY_COLOURS[s.intensity]
            const label =
              s.type === "warmup" ? t("intervals.type_warmup") :
              s.type === "cooldown" ? t("intervals.type_cooldown") :
              t(INTENSITY_KEY[s.intensity])
            return (
              <li key={s.index} className="flex items-center gap-2">
                <span className="w-4 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {s.index}
                </span>
                <div className="relative h-7 flex-1 overflow-hidden rounded-md bg-secondary/40">
                  <div
                    className={`h-full ${palette.bar}`}
                    style={{ width: `${widthPct}%` }}
                  />
                  <div className="absolute inset-0 flex items-center justify-between px-2 text-[11px]">
                    <span className={`font-medium ${palette.text}`}>
                      {label}
                      {isFastest && (
                        <Trophy size={10} className="ml-1 inline-block text-amber-500" />
                      )}
                    </span>
                    <span className="tabular-nums text-foreground/80">
                      {fmtClock(s.durationSeconds)}
                      {s.avgPaceMinPerKm && <span className="ml-1.5">{formatPace(s.avgPaceMinPerKm)}</span>}
                    </span>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>

        {/* Summary row: fastest · consistency · rest */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2 text-[11px]">
          {fastestWork?.avgPaceMinPerKm && (
            <div className="flex items-center gap-1">
              <Trophy size={11} className="text-amber-500" />
              <span className="text-muted-foreground">{t("intervals.fastest")}:</span>
              <span className="font-medium text-foreground tabular-nums">
                {formatPace(fastestWork.avgPaceMinPerKm)}
                {fastestWork.peakHeartRate != null && ` · HR ${fastestWork.peakHeartRate}`}
              </span>
            </div>
          )}
          {analysis.totalRestSeconds > 0 && (
            <div className="flex items-center gap-1">
              <Pause size={11} className="text-muted-foreground" />
              <span className="text-muted-foreground">{t("intervals.restTotal")}:</span>
              <span className="font-medium text-foreground tabular-nums">
                {fmtClock(analysis.totalRestSeconds)}
              </span>
            </div>
          )}
          {consistencyCopy && (
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">{t("intervals.consistency")}:</span>
              <span className="font-medium text-foreground">{consistencyCopy}</span>
            </div>
          )}
        </div>

        {/* Source attribution — quietly at the bottom */}
        <p className="text-[10px] text-muted-foreground/70">
          {analysis.source === "laps" ? t("intervals.sourceLaps") : t("intervals.sourceStreams")}
        </p>
      </div>
    </AppCard>
  )
}
