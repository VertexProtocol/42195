"use client"

import { useMemo, lazy, Suspense, useState, useEffect, useCallback } from "react"
import { ChevronRight, TrendingUp, Clock, Footprints, AlertCircle, CheckCircle2, RefreshCw, ChevronUp, ChevronDown } from "lucide-react"
import { PoweredByStrava } from "@/components/strava-brand"
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
import type { Goal, WeeklySummary, Activity, SyncStatus } from "@/lib/types"
import { useI18n } from "@/lib/i18n"

const TrainingLoadIndicator = lazy(() => import("@/components/training-load-indicator").then(m => ({ default: m.TrainingLoadIndicator })))

interface HomeScreenProps {
  activeGoals: Goal[]
  activities: Activity[]
  weeklySummary: WeeklySummary
  recentActivities: Activity[]
  syncStatus?: SyncStatus
  stravaConnected?: boolean
  onViewActivities: () => void
  onViewGoal: (goal: Goal) => void
  onViewGoals: () => void
  onViewInsights: () => void
  onSelectActivity: (activity: Activity) => void
}

export function HomeScreen({
  activeGoals,
  activities,
  weeklySummary,
  recentActivities,
  syncStatus,
  stravaConnected,
  onViewActivities,
  onViewGoal,
  onViewGoals,
  onViewInsights,
  onSelectActivity,
}: HomeScreenProps) {
  const { t } = useI18n()
  
  // Goal ordering state (persisted to localStorage)
  const [goalOrder, setGoalOrder] = useState<string[]>([])
  
  useEffect(() => {
    const stored = localStorage.getItem("activeGoalOrder")
    if (stored) {
      try { setGoalOrder(JSON.parse(stored)) } catch { /* ignore */ }
    }
  }, [])
  
  const saveOrder = useCallback((newOrder: string[]) => {
    setGoalOrder(newOrder)
    localStorage.setItem("activeGoalOrder", JSON.stringify(newOrder))
  }, [])
  
  // Sort active goals by stored order
  const orderedGoals = useMemo(() => {
    return [...activeGoals].sort((a, b) => {
      const aIdx = goalOrder.indexOf(a.id)
      const bIdx = goalOrder.indexOf(b.id)
      if (aIdx === -1 && bIdx === -1) return 0
      if (aIdx === -1) return 1
      if (bIdx === -1) return -1
      return aIdx - bIdx
    })
  }, [activeGoals, goalOrder])
  
  const moveGoal = useCallback((id: string, direction: "up" | "down") => {
    const currentOrder = orderedGoals.map(g => g.id)
    const idx = currentOrder.indexOf(id)
    if (direction === "up" && idx > 0) {
      const newOrder = [...currentOrder]
      ;[newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]]
      saveOrder(newOrder)
    } else if (direction === "down" && idx < currentOrder.length - 1) {
      const newOrder = [...currentOrder]
      ;[newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]]
      saveOrder(newOrder)
    }
  }, [orderedGoals, saveOrder])

  // Pre-compute goal metrics outside JSX so we don't run O(goals * activities) on every render
  const goalMetrics = useMemo(
    () =>
      orderedGoals.map((goal) => {
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
    [orderedGoals, activities],
  )

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
        {/* Sync status pill */}
        {syncStatus && stravaConnected && syncStatus.state !== "never" && (
          <div className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
            syncStatus.state === "syncing" ? "bg-primary/10 text-primary" :
            syncStatus.state === "error" ? "bg-destructive/10 text-destructive" :
            "bg-success/10 text-success"
          }`}>
            {syncStatus.state === "syncing" && <RefreshCw size={10} className="animate-spin" />}
            {syncStatus.state === "error" && <AlertCircle size={10} />}
            {syncStatus.state === "success" && <CheckCircle2 size={10} />}
            <span>
              {syncStatus.state === "syncing" ? t("profile.syncing") :
               syncStatus.state === "error" ? "Sync failed" :
               t("profile.synced")}
            </span>
          </div>
        )}
      </header>

      {/* Training Load Indicator (Optimal / High Load / Overtraining Risk) */}
      {activities.length >= 7 && (
        <Suspense fallback={null}>
          <TrainingLoadIndicator activities={activities} />
        </Suspense>
      )}

      {/* Active Goals */}
      {orderedGoals.length > 0 ? (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("home.activeGoals")}
            </h3>
            {orderedGoals.length > 1 && (
              <span className="text-xs text-muted-foreground">
                {orderedGoals.length} {t("home.goals")}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-3">
            {orderedGoals.map((goal, i) => {
              const m = goalMetrics[i]

              return (
                <div
                  key={goal.id}
                  className="relative w-full overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border min-h-[120px] flex"
                >
                  {/* Reorder buttons - only show if multiple goals */}
                  {orderedGoals.length > 1 && (
                    <div className="flex flex-col items-center justify-center w-10 shrink-0 bg-secondary/30 border-r border-border/50">
                      <button
                        onClick={() => moveGoal(goal.id, "up")}
                        disabled={i === 0}
                        className="flex-1 flex items-center justify-center w-full active:bg-secondary/50 disabled:opacity-30 transition-colors"
                      >
                        <ChevronUp size={18} className="text-muted-foreground" />
                      </button>
                      <div className="w-5 h-px bg-border/50" />
                      <button
                        onClick={() => moveGoal(goal.id, "down")}
                        disabled={i === orderedGoals.length - 1}
                        className="flex-1 flex items-center justify-center w-full active:bg-secondary/50 disabled:opacity-30 transition-colors"
                      >
                        <ChevronDown size={18} className="text-muted-foreground" />
                      </button>
                    </div>
                  )}
                  
                  {/* Main content - clickable */}
                  <button
                    onClick={() => onViewGoal(goal)}
                    className="flex-1 p-5 text-left active:bg-secondary/10 transition-colors"
                  >
                    <div className="flex items-start justify-between h-full">
                      <div className="flex-1 pr-4 flex flex-col">
                        <p className="text-xs font-medium uppercase tracking-wider text-primary">
                          {t("home.activeGoal")}
                        </p>
                        <h2 className="mt-1 text-lg font-semibold text-card-foreground text-balance line-clamp-1">
                          {goal.name}
                        </h2>
                        <div className="mt-auto pt-2.5 flex flex-col gap-1">
                          <div className="flex items-center gap-4">
                            <span className="text-sm text-muted-foreground">
                              {m.days} {t("home.daysLeft")}
                            </span>
                            <span className="text-sm font-medium text-primary">
                              {formatDistance(m.logged)} {t("home.logged")}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground h-4">
                            {goal.target_time_seconds 
                              ? `${t("home.target")}: ${formatTargetTime(goal.target_time_seconds)}`
                              : "\u00A0"}
                          </span>
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
                </div>
              )
            })}
          </div>
        </section>
      ) : (
        <div className="rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border">
          <p className="text-sm text-muted-foreground">{t("home.noActiveGoals")}</p>
          <button
            onClick={onViewGoals}
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
                  <button
                    onClick={() => onSelectActivity(activity)}
                    className="w-full rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border text-left active:scale-[0.98] transition-transform"
                  >
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
                  </button>
                </CarouselItem>
              ))}
            </CarouselContent>
          </Carousel>
        </section>
      )}

      {/* Strava attribution */}
      {activities.length > 0 && (
        <PoweredByStrava className="mt-2" />
      )}
    </div>
  )
}
