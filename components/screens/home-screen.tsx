"use client"

import { useState, useMemo, lazy, Suspense } from "react"
import { ChevronRight, TrendingUp, Clock, Footprints, Target, Flame, Mountain, AlertTriangle, Timer } from "lucide-react"
import { ProgressRing } from "@/components/progress-ring"
import { Carousel, CarouselContent, CarouselItem } from "@/components/ui/carousel"
import {
  formatDistance,
  formatDuration,
  formatDateShort,
  daysUntil,
  progressPercentage,
  timeElapsedPercentage,
  formatWeeklyMetric,
  formatTargetTime,
  computeDistanceInRange,
  computeWeeklyProgress,
} from "@/lib/format"
import { computeACWR, predictRaceTimes } from "@/lib/training-utils"
import type { Goal, WeeklySummary, WeeklyGoal, Activity } from "@/lib/types"
import { useI18n } from "@/lib/i18n"

const TrainingLoadChart = lazy(() => import("@/components/training-load-chart").then(m => ({ default: m.TrainingLoadChart })))

const METRIC_ICONS: Record<string, typeof Flame> = {
  distance_km: TrendingUp,
  sessions: Flame,
  duration_minutes: Clock,
  elevation_m: Mountain,
}

interface HomeScreenProps {
  activeGoals: Goal[]
  activities: Activity[]
  weeklySummary: WeeklySummary
  weeklyGoals: WeeklyGoal[]
  currentWeekStart: string
  recentActivities: Activity[]
  onViewActivities: () => void
  onViewGoal: () => void
}

export function HomeScreen({
  activeGoals,
  activities,
  weeklySummary,
  weeklyGoals,
  currentWeekStart,
  recentActivities,
  onViewActivities,
  onViewGoal,
}: HomeScreenProps) {
  const { t } = useI18n()
  const [loadWindow, setLoadWindow] = useState<7 | 30>(7)

  // Pre-compute goal metrics outside JSX so we don't run O(goals * activities) on every render
  const goalMetrics = useMemo(
    () =>
      activeGoals.map((goal) => {
        const logged = computeDistanceInRange(
          activities,
          goal.start_date,
          goal.target_date,
          goal.created_at,
        )
        const effectiveStart = goal.start_date ?? goal.created_at
        return {
          id: goal.id,
          logged,
          timeProgress: timeElapsedPercentage(effectiveStart, goal.target_date),
          days: daysUntil(goal.target_date),
        }
      }),
    [activeGoals, activities],
  )

  const weeklyMetrics = useMemo(
    () =>
      weeklyGoals.map((wg) => {
        const current = computeWeeklyProgress(
          activities,
          wg.metric,
          currentWeekStart,
          wg.session_min_duration_minutes,
          wg.session_min_distance_km,
        )
        return {
          id: wg.id,
          current,
          progress: progressPercentage(current, wg.target),
          isComplete: current >= wg.target,
        }
      }),
    [weeklyGoals, activities, currentWeekStart],
  )

  const loadStats = useMemo(() => {
    const cutoff = Date.now() - loadWindow * 24 * 60 * 60 * 1000
    const relevant = activities.filter((a) => new Date(a.date).getTime() >= cutoff)
    return {
      total_distance_km: relevant.reduce((s, a) => s + a.distance_km, 0),
      total_time_seconds: relevant.reduce((s, a) => s + a.duration_seconds, 0),
      run_count: relevant.length,
    }
  }, [activities, loadWindow])

  const acwr = useMemo(() => computeACWR(activities), [activities])
  const racePredictions = useMemo(() => predictRaceTimes(activities), [activities])

  return (
    <div className="flex flex-col gap-6 px-5 pb-6 pt-4">
      {/* Header */}
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="font-mono text-3xl font-bold tracking-tight text-foreground">
            42195
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("app.tagline")}</p>
        </div>
      </header>

      {/* ACWR Injury Risk Banner */}
      {acwr.ratio > 0 && acwr.risk !== "low" && (
        <div className={`flex items-start gap-3 rounded-2xl px-4 py-3.5 ring-1 ${
          acwr.risk === "high"
            ? "bg-destructive/10 ring-destructive/30"
            : "bg-warning/10 ring-warning/30"
        }`}>
          <AlertTriangle size={18} className={`mt-0.5 shrink-0 ${
            acwr.risk === "high" ? "text-destructive" : "text-warning"
          }`} />
          <div>
            <p className={`text-sm font-semibold ${
              acwr.risk === "high" ? "text-destructive" : "text-warning"
            }`}>
              {acwr.risk === "high" ? t("home.highInjuryRisk") : t("home.elevatedLoad")}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Your 7-day load ({acwr.acuteLoad.toFixed(1)} km) is {acwr.ratio.toFixed(1)}x your 4-week average ({acwr.chronicLoad.toFixed(1)} km/week).
              {acwr.risk === "high"
                ? ` ${t("home.considerRecovery")}`
                : ` ${t("home.monitorFeeling")}`}
            </p>
          </div>
        </div>
      )}

      {/* Active Goals */}
      {activeGoals.length > 0 ? (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("home.activeGoals")}
            </h3>
            {activeGoals.length > 1 && (
              <span className="text-xs text-muted-foreground">
                {activeGoals.length} {t("home.goals")}
              </span>
            )}
          </div>
          <Carousel opts={{ align: "start", dragFree: false }}>
            <CarouselContent className="-ml-3">
              {activeGoals.map((goal, i) => {
                const m = goalMetrics[i]

                return (
                  <CarouselItem
                    key={goal.id}
                    className={`pl-3 ${activeGoals.length > 1 ? "basis-[88%]" : "basis-full"}`}
                  >
                    <button
                      onClick={onViewGoal}
                      className="relative w-full overflow-hidden rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border text-left active:scale-[0.98] transition-transform"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 pr-4">
                          <p className="text-xs font-medium uppercase tracking-wider text-primary">
                            {t("home.activeGoal")}
                          </p>
                          <h2 className="mt-1 text-lg font-semibold text-card-foreground text-balance">
                            {goal.name}
                          </h2>
                          <div className="mt-2.5 flex flex-col gap-1">
                            <div className="flex items-center gap-4">
                              <span className="text-sm text-muted-foreground">
                                {m.days} {t("home.daysLeft")}
                              </span>
                              <span className="text-sm font-medium text-primary">
                                {formatDistance(m.logged)} {t("home.logged")}
                              </span>
                            </div>
                            {goal.target_time_seconds && (
                              <span className="text-xs text-muted-foreground">
                                {t("home.target")}: {formatTargetTime(goal.target_time_seconds)}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="relative flex shrink-0 items-center justify-center">
                          <ProgressRing
                            percentage={m.timeProgress}
                            size={72}
                            strokeWidth={5}
                          />
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-[10px] font-bold text-foreground">{m.timeProgress}%</span>
                            <span className="text-[8px] text-muted-foreground">{t("home.elapsed")}</span>
                          </div>
                        </div>
                      </div>
                      <ChevronRight size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                    </button>
                  </CarouselItem>
                )
              })}
            </CarouselContent>
          </Carousel>
        </section>
      ) : (
        <div className="rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border">
          <p className="text-sm text-muted-foreground">{t("home.noActiveGoals")}</p>
          <button
            onClick={onViewGoal}
            className="mt-2 text-sm font-medium text-primary active:opacity-70"
          >
            {t("home.setGoal")}
          </button>
        </div>
      )}

      {/* Weekly Summary */}
      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("home.thisWeek")}
        </h3>
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <TrendingUp size={20} className="text-primary" />
            </div>
            <span className="text-lg font-bold text-card-foreground">
              {weeklySummary.total_distance_km.toFixed(1)}
            </span>
            <span className="text-xs text-muted-foreground">{t("home.km")}</span>
          </div>
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <Clock size={20} className="text-primary" />
            </div>
            <span className="text-lg font-bold text-card-foreground">
              {formatDuration(weeklySummary.total_time_seconds)}
            </span>
            <span className="text-xs text-muted-foreground">{t("home.time")}</span>
          </div>
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <Footprints size={20} className="text-primary" />
            </div>
            <span className="text-lg font-bold text-card-foreground">
              {weeklySummary.run_count}
            </span>
            <span className="text-xs text-muted-foreground">{t("home.runs")}</span>
          </div>
        </div>
      </section>

      {/* Training Load */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("home.trainingLoad")}
          </h3>
          <div className="flex items-center gap-0.5 rounded-full bg-secondary p-0.5">
            <button
              onClick={() => setLoadWindow(7)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                loadWindow === 7
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              {t("home.days7")}
            </button>
            <button
              onClick={() => setLoadWindow(30)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                loadWindow === 30
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              {t("home.days30")}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-3 divide-x divide-border overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border">
          <div className="flex flex-col items-center gap-1.5 p-4">
            <TrendingUp size={16} className="text-muted-foreground" />
            <span className="text-lg font-bold font-mono text-card-foreground">
              {loadStats.total_distance_km.toFixed(1)}
            </span>
            <span className="text-xs text-muted-foreground">{t("home.km")}</span>
          </div>
          <div className="flex flex-col items-center gap-1.5 p-4">
            <Clock size={16} className="text-muted-foreground" />
            <span className="text-lg font-bold font-mono text-card-foreground">
              {formatDuration(loadStats.total_time_seconds)}
            </span>
            <span className="text-xs text-muted-foreground">{t("home.time")}</span>
          </div>
          <div className="flex flex-col items-center gap-1.5 p-4">
            <Footprints size={16} className="text-muted-foreground" />
            <span className="text-lg font-bold font-mono text-card-foreground">
              {loadStats.run_count}
            </span>
            <span className="text-xs text-muted-foreground">{t("home.runs")}</span>
          </div>
        </div>
      </section>

      {/* Fitness & Fatigue Chart */}
      {activities.length >= 14 && (
        <Suspense fallback={
          <div className="h-[230px] animate-pulse rounded-2xl bg-card shadow-sm ring-1 ring-border" />
        }>
          <TrainingLoadChart activities={activities} />
        </Suspense>
      )}

      {/* Weekly Goals Progress */}
      {weeklyGoals.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("home.weeklyGoals")}
            </h3>
            <button
              onClick={onViewGoal}
              className="text-xs font-medium text-primary active:opacity-70"
            >
              {t("home.seeAll")}
            </button>
          </div>
          <Carousel opts={{ align: "start", dragFree: true }}>
            <CarouselContent className="-ml-3">
              {weeklyGoals.map((wg, i) => {
                const m = weeklyMetrics[i]
                const Icon = METRIC_ICONS[wg.metric] || Target

                return (
                  <CarouselItem key={wg.id} className="pl-3 basis-[46%]">
                    <button
                      onClick={onViewGoal}
                      className="flex w-full flex-col items-start gap-2.5 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border text-left active:scale-[0.98] transition-transform"
                    >
                      <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                        m.isComplete ? "bg-success/15" : "bg-primary/10"
                      }`}>
                        <Icon size={16} className={m.isComplete ? "text-success" : "text-primary"} />
                      </div>
                      <div className="w-full">
                        <p className="text-[11px] text-muted-foreground">{wg.label}</p>
                        <div className="mt-0.5 flex items-baseline gap-1">
                          <span className="text-sm font-bold font-mono text-card-foreground">
                            {formatWeeklyMetric(m.current, wg.metric)}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            / {formatWeeklyMetric(wg.target, wg.metric)}
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              m.isComplete ? "bg-success" : "bg-primary"
                            }`}
                            style={{ width: `${m.progress}%` }}
                          />
                        </div>
                      </div>
                    </button>
                  </CarouselItem>
                )
              })}
            </CarouselContent>
          </Carousel>
        </section>
      )}

      {/* Race Time Predictions */}
      {racePredictions.predictions.length > 0 && (
        <section>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("home.racePredictions")}
          </h3>
          <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border">
            {racePredictions.predictions.map((pred, i) => (
              <div
                key={pred.distance_label}
                className={`flex items-center justify-between px-4 py-3 ${
                  i < racePredictions.predictions.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  <Timer size={14} className="text-muted-foreground" />
                  <span className="text-sm text-card-foreground">{pred.distance_label}</span>
                </div>
                <span className="text-sm font-bold font-mono text-foreground">
                  {formatTargetTime(pred.predicted_seconds)}
                </span>
              </div>
            ))}
            {racePredictions.referenceActivity && (
              <div className="border-t border-border px-4 py-2">
                <p className="text-[10px] text-muted-foreground">
                  {t("home.basedOn")} {formatDistance(racePredictions.referenceActivity.distance_km)} {t("home.on")} {formatDateShort(racePredictions.referenceActivity.date)}
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Recent Activities Carousel */}
      {recentActivities.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("home.recentActivities")}
            </h3>
            <button
              onClick={onViewActivities}
              className="text-xs font-medium text-primary active:opacity-70"
            >
              {t("home.seeAll")}
            </button>
          </div>
          <Carousel opts={{ align: "start", dragFree: true }}>
            <CarouselContent className="-ml-3">
              {recentActivities.map((activity) => (
                <CarouselItem key={activity.id} className="pl-3 basis-[72%]">
                  <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                      {activity.type}
                    </p>
                    <h4 className="mt-1 truncate text-sm font-semibold text-card-foreground">
                      {activity.name}
                    </h4>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatDateShort(activity.date)}
                    </p>
                    <div className="mt-3 flex items-center gap-3">
                      <span className="font-mono text-sm font-bold text-card-foreground">
                        {formatDistance(activity.distance_km)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDuration(activity.duration_seconds)}
                      </span>
                    </div>
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
          </Carousel>
        </section>
      )}

    </div>
  )
}
