"use client"

import { useMemo, lazy, Suspense } from "react"
import { ChevronRight, TrendingUp, Clock, Footprints, AlertTriangle } from "lucide-react"
import { ProgressRing } from "@/components/progress-ring"
import { Carousel, CarouselContent, CarouselItem } from "@/components/ui/carousel"
import {
  formatDistance,
  formatDuration,
  formatDateShort,
  daysUntil,
  timeElapsedPercentage,
  formatTargetTime,
  computeDistanceInRange,
} from "@/lib/format"
import { computeACWR } from "@/lib/training-utils"
import type { Goal, WeeklySummary, Activity } from "@/lib/types"
import { useI18n } from "@/lib/i18n"

const TrainingLoadChart = lazy(() => import("@/components/training-load-chart").then(m => ({ default: m.TrainingLoadChart })))

interface HomeScreenProps {
  activeGoals: Goal[]
  activities: Activity[]
  weeklySummary: WeeklySummary
  recentActivities: Activity[]
  onViewActivities: () => void
  onViewGoal: () => void
  onViewInsights: () => void
}

export function HomeScreen({
  activeGoals,
  activities,
  weeklySummary,
  recentActivities,
  onViewActivities,
  onViewGoal,
  onViewInsights,
}: HomeScreenProps) {
  const { t } = useI18n()

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

  const acwr = useMemo(() => computeACWR(activities), [activities])

  return (
    <div className="flex flex-col gap-6 px-5 pb-6 pt-4 md:px-8 md:max-w-2xl md:mx-auto">
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
                      className="relative w-full overflow-hidden rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border text-left active:scale-[0.98] transition-all hover:shadow-md hover:ring-border/80 group"
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
                      <ChevronRight size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 group-hover:translate-x-1 transition-transform" />
                    </button>
                  </CarouselItem>
                )
              })}
            </CarouselContent>
          </Carousel>
        </section>
      ) : (
        <div className="rounded-2xl bg-gradient-to-br from-card to-card/80 p-5 shadow-sm ring-1 ring-border hover:ring-border/80 hover:shadow-md transition-all">
          <p className="text-sm text-muted-foreground">{t("home.noActiveGoals")}</p>
          <button
            onClick={onViewGoal}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-2 text-sm font-semibold text-primary transition-all hover:bg-primary/20 active:scale-95"
          >
            + {t("home.setGoal")}
          </button>
        </div>
      )}

      {/* Weekly Summary */}
      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("home.thisWeek")}
        </h3>
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border hover:ring-border/80 hover:shadow-md transition-all hover:scale-[1.02] active:scale-95">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 group-hover:bg-primary/20 transition-colors">
              <TrendingUp size={20} className="text-primary" />
            </div>
            <span className="text-xl font-bold text-card-foreground">
              {weeklySummary.total_distance_km.toFixed(1)}
            </span>
            <span className="text-xs text-muted-foreground font-medium">{t("home.km")}</span>
          </div>
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border hover:ring-border/80 hover:shadow-md transition-all hover:scale-[1.02] active:scale-95">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 group-hover:bg-primary/20 transition-colors">
              <Clock size={20} className="text-primary" />
            </div>
            <span className="text-xl font-bold text-card-foreground">
              {formatDuration(weeklySummary.total_time_seconds)}
            </span>
            <span className="text-xs text-muted-foreground font-medium">{t("home.time")}</span>
          </div>
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border hover:ring-border/80 hover:shadow-md transition-all hover:scale-[1.02] active:scale-95">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 group-hover:bg-primary/20 transition-colors">
              <Footprints size={20} className="text-primary" />
            </div>
            <span className="text-xl font-bold text-card-foreground">
              {weeklySummary.run_count}
            </span>
            <span className="text-xs text-muted-foreground font-medium">{t("home.runs")}</span>
          </div>
        </div>
      </section>

      {/* Training Status */}
      {activities.length >= 14 && (
        <Suspense fallback={
          <div className="h-[180px] animate-pulse rounded-2xl bg-card shadow-sm ring-1 ring-border" />
        }>
          <TrainingLoadChart activities={activities} />
        </Suspense>
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
              className="text-xs font-semibold text-primary transition-all hover:gap-1 active:scale-95 inline-flex items-center gap-0.5"
            >
              {t("home.seeAll")} <ChevronRight size={14} className="transition-transform group-hover:translate-x-0.5" />
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
