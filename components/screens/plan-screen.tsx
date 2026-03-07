"use client"

import { Plus, Pencil, CalendarCheck, TrendingUp, Footprints, Clock, MapPin, Check, Trophy, Sparkles, ChevronRight } from "lucide-react"
import {
  formatDistance,
  formatDate,
  formatDuration,
  daysUntil,
  isDatePast,
  timeElapsedPercentage,
  computeDistanceInRange,
  bestRelevantRun,
  longestRun,
} from "@/lib/format"
import type { Activity, Goal } from "@/lib/types"
import { useI18n } from "@/lib/i18n"

interface PlanScreenProps {
  goals: Goal[]
  activities: Activity[]
  onEditGoal: (goal: Goal) => void
  onAddGoal: () => void
  onToggleActive: (goalId: string) => void
  onSelectGoal: (goal: Goal) => void
}

/**
 * Returns a training phase label based on how far through the preparation period we are.
 * 0–70%  → Building base
 * 70–85% → Peak training
 * 85–95% → Tapering
 * 95%+   → Race week
 */
function trainingPhaseKey(startDate: string | null, targetDate: string): {
  labelKey: "plan.raceWeek" | "plan.tapering" | "plan.peakTraining" | "plan.buildingBase"
  color: string
} {
  const pct = timeElapsedPercentage(startDate, targetDate)
  if (pct >= 95) return { labelKey: "plan.raceWeek", color: "text-destructive" }
  if (pct >= 85) return { labelKey: "plan.tapering", color: "text-warning" }
  if (pct >= 70) return { labelKey: "plan.peakTraining", color: "text-primary" }
  return { labelKey: "plan.buildingBase", color: "text-success" }
}

export function PlanScreen({ goals, activities, onEditGoal, onAddGoal, onToggleActive, onSelectGoal }: PlanScreenProps) {
  const { t } = useI18n()
  const eventGoals = goals.filter((g) => g.goal_category === "event_training")

  // Sort: active first, then by target date ascending
  const sorted = [...eventGoals].sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1
    return new Date(a.target_date).getTime() - new Date(b.target_date).getTime()
  })

  return (
    <div className="flex flex-col gap-5 px-5 pb-6 pt-4">
      <header>
        <h1 className="text-2xl font-bold text-foreground">{t("plan.title")}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {t("plan.subtitle")}
        </p>
      </header>

      {/* Add event goal */}
      <button
        onClick={onAddGoal}
        className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground active:bg-secondary transition-colors"
      >
        <Plus size={18} />
        {t("plan.addEvent")}
      </button>

      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
            <CalendarCheck size={28} className="text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-muted-foreground">{t("plan.noEvents")}</p>
          <p className="text-xs text-muted-foreground text-center max-w-[220px]">
            {t("plan.noEventsDesc")}
          </p>
        </div>
      ) : (
        sorted.map((goal) => {
          const days = daysUntil(goal.target_date)
          const past = isDatePast(goal.target_date)
          const effectiveStart = goal.start_date ?? goal.created_at
          const timeProgress = past ? 100 : timeElapsedPercentage(effectiveStart, goal.target_date)
          const logged = computeDistanceInRange(
            activities,
            goal.start_date,
            goal.target_date,
            goal.created_at,
          )
          const phase = trainingPhaseKey(goal.start_date, goal.target_date)
          const best = bestRelevantRun(activities, goal.target_distance_km)
          const longest = longestRun(activities, goal.start_date, goal.created_at)

          return (
            <div
              key={goal.id}
              className={`overflow-hidden rounded-2xl bg-card shadow-sm ring-1 transition-all ${
                past
                  ? "ring-success/40 ring-2"
                  : goal.is_active
                    ? "ring-primary/40 ring-2"
                    : "ring-border"
              }`}
            >
              {/* Tappable card body */}
              <button
                onClick={() => onSelectGoal(goal)}
                className="w-full text-left active:bg-secondary/50 transition-colors"
                aria-label={`Open training plan for ${goal.name}`}
              >
              {/* Card header */}
              <div className="px-5 pt-5 pb-4">
                <div className="flex items-start justify-between">
                  <div className="flex flex-col gap-1 min-w-0 pr-3">
                    {past ? (
                      <div className="flex items-center gap-1.5">
                        <Trophy size={12} className="text-success" />
                        <span className="text-[10px] font-semibold uppercase tracking-widest text-success">
                          {t("plan.raceComplete")}
                        </span>
                      </div>
                    ) : goal.is_active ? (
                      <div className="flex items-center gap-1.5">
                        <div className="h-2 w-2 rounded-full bg-primary" />
                        <span className="text-[10px] font-semibold uppercase tracking-widest text-primary">
                          {t("plan.activePlan")}
                        </span>
                      </div>
                    ) : null}
                    <h3 className="text-xl font-bold text-card-foreground leading-tight">
                      {goal.name}
                    </h3>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); onEditGoal(goal) }}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground active:bg-accent transition-colors"
                    aria-label={`Edit ${goal.name}`}
                  >
                    <Pencil size={14} />
                  </button>
                </div>

                {/* Event details row */}
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin size={13} />
                    <span>{formatDistance(goal.target_distance_km)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarCheck size={13} />
                    <span>{formatDate(goal.target_date)}</span>
                  </div>
                  {!past && days > 0 && (
                    <div className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-foreground">
                      {days} {t("plan.daysToGo")}
                    </div>
                  )}
                  {!past && days === 0 && (
                    <div className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                      {t("plan.raceDay")}
                    </div>
                  )}
                </div>

                {/* Training phase — only while still preparing */}
                {goal.start_date && !past && days > 0 && (
                  <div className={`mt-2 text-xs font-semibold ${phase.color}`}>
                    {t(phase.labelKey)}
                  </div>
                )}
              </div>

              {/* Training progress */}
              <div className="px-5 pb-4">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-muted-foreground">
                    {past
                      ? t("plan.trainingCompleted")
                      : goal.start_date
                        ? `${t("plan.trainingFrom")} ${formatDate(goal.start_date)}`
                        : t("plan.trainingProgress")}
                  </span>
                  <span className={`font-medium ${past ? "text-success" : "text-foreground"}`}>
                    {timeProgress}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${past ? "bg-success" : "bg-primary"}`}
                    style={{ width: `${timeProgress}%` }}
                  />
                </div>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-3 divide-x divide-border border-t border-border">
                <div className="flex flex-col items-center gap-1 px-3 py-3">
                  <TrendingUp size={14} className="text-muted-foreground" />
                  <span className="text-base font-bold font-mono text-foreground">
                    {logged.toFixed(0)}
                  </span>
                  <span className="text-[10px] text-muted-foreground text-center">{t("plan.kmLogged")}</span>
                </div>
                <div className="flex flex-col items-center gap-1 px-3 py-3">
                  <Footprints size={14} className="text-muted-foreground" />
                  <span className="text-base font-bold font-mono text-foreground">
                    {longest ? `${longest.distance_km.toFixed(1)}` : "—"}
                  </span>
                  <span className="text-[10px] text-muted-foreground text-center">{t("plan.longestRun")}</span>
                </div>
                <div className="flex flex-col items-center gap-1 px-3 py-3">
                  <Clock size={14} className="text-muted-foreground" />
                  <span className="text-base font-bold font-mono text-foreground">
                    {best ? formatDuration(best.duration_seconds) : "—"}
                  </span>
                  <span className="text-[10px] text-muted-foreground text-center">{t("plan.bestSimRun")}</span>
                </div>
              </div>

              {/* AI plan hint row */}
              <div className="flex items-center gap-2 border-t border-border px-5 py-3 text-xs text-muted-foreground">
                <Sparkles size={13} className="text-primary" />
                <span>{t("plan.aiPlan")}</span>
                <ChevronRight size={13} className="ml-auto" />
              </div>
              </button>{/* end tappable button */}

              {/* Active toggle — outside the tappable area */}
              <div className="border-t border-border px-5 py-3 flex justify-end">
                <button
                  onClick={() => onToggleActive(goal.id)}
                  className={`flex min-h-[36px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    goal.is_active
                      ? "bg-primary/10 text-primary active:bg-primary/20"
                      : "bg-secondary text-secondary-foreground active:bg-accent"
                  }`}
                >
                  <Check size={14} />
                  {goal.is_active ? t("plan.activePlan") : t("plan.setAsActive")}
                </button>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
