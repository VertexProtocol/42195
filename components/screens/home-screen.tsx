"use client"

import { useMemo, lazy, Suspense } from "react"
import { TrendingUp, Clock, Footprints, AlertCircle, CheckCircle2, RefreshCw, Star, Flame, Mountain, Target } from "lucide-react"
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
  computeWeeklyProgress,
  formatWeeklyMetric,
  progressPercentage,
} from "@/lib/format"
import type { Goal, WeeklySummary, Activity, SyncStatus, WeeklyGoal } from "@/lib/types"
import { useI18n } from "@/lib/i18n"

const TrainingLoadIndicator = lazy(() => import("@/components/training-load-indicator").then(m => ({ default: m.TrainingLoadIndicator })))

interface HomeScreenProps {
  starredGoals: Goal[] // [STAR] goals pinned to home screen
  currentWeekGoals: WeeklyGoal[]
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
  starredGoals,
  currentWeekGoals,
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

  const currentMondayStr = useMemo(() => {
    const now = new Date()
    const day = now.getDay()
    const diff = day === 0 ? -6 : 1 - day
    const mon = new Date(now)
    mon.setDate(now.getDate() + diff)
    const p = (n: number) => String(n).padStart(2, "0")
    return `${mon.getFullYear()}-${p(mon.getMonth() + 1)}-${p(mon.getDate())}`
  }, [])

  // Pre-compute goal metrics outside JSX so we don't run O(goals * activities) on every render
  const goalMetrics = useMemo(
    () =>
      starredGoals.map((goal) => {
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
    [starredGoals, activities],
  )

  return (
    <div className="flex flex-col gap-5 px-4 pb-6 pt-4">
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

      {/* [STAR] Starred goals carousel */}
      {starredGoals.length > 0 ? (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Star size={11} className="text-amber-500" fill="currentColor" />
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("home.activeGoals")}
              </h3>
            </div>
            {starredGoals.length > 1 && (
              <span className="text-xs text-muted-foreground">
                {starredGoals.length} {t("home.goals")}
              </span>
            )}
          </div>
          <Carousel opts={{ align: "start", dragFree: false }}>
            <CarouselContent className="-ml-3">
              {starredGoals.map((goal, i) => {
                const m = goalMetrics[i]

                return (
                  <CarouselItem
                    key={goal.id}
                    className={`pl-3 ${starredGoals.length > 1 ? "basis-[88%]" : "basis-full"}`}
                  >
                    <button
                      onClick={() => onViewGoal(goal)}
                      className="relative w-full overflow-hidden rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border text-left active:scale-[0.98] transition-transform min-h-[108px]"
                    >
                      <div className="flex items-start justify-between h-full">
                        <div className="flex-1 pr-4 flex flex-col">
                          <p className="text-xs font-medium uppercase tracking-wider text-primary">
                            {t("home.activeGoal")}
                          </p>
                          <h2 className="mt-1 text-base font-semibold text-card-foreground text-balance line-clamp-1">
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
                            size={64}
                            strokeWidth={5}
                          />
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-[10px] font-bold text-foreground">{m.timeProgress}%</span>
                            <span className="text-[8px] text-muted-foreground">{t("home.elapsed")}</span>
                          </div>
                        </div>
                      </div>
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
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-card p-3 shadow-sm ring-1 ring-border">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10">
              <TrendingUp size={16} className="text-primary" />
            </div>
            <span className="text-base font-bold text-card-foreground">
              {weeklySummary.total_distance_km.toFixed(1)}
            </span>
            <span className="text-xs text-muted-foreground">{t("home.km")}</span>
          </div>
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-card p-3 shadow-sm ring-1 ring-border">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10">
              <Clock size={16} className="text-primary" />
            </div>
            <span className="text-base font-bold text-card-foreground">
              {formatDuration(weeklySummary.total_time_seconds)}
            </span>
            <span className="text-xs text-muted-foreground">{t("home.time")}</span>
          </div>
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-card p-3 shadow-sm ring-1 ring-border">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10">
              <Footprints size={16} className="text-primary" />
            </div>
            <span className="text-base font-bold text-card-foreground">
              {weeklySummary.run_count}
            </span>
            <span className="text-xs text-muted-foreground">{t("home.runs")}</span>
          </div>
        </div>

        {/* Weekly goal progress rings */}
        {currentWeekGoals.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {currentWeekGoals.map((wg) => {
              const current = computeWeeklyProgress(
                activities,
                wg.metric,
                currentMondayStr,
                wg.session_min_duration_minutes,
                wg.session_min_distance_km,
              )
              const progress = progressPercentage(current, wg.target)
              const isComplete = current >= wg.target
              const ICONS: Record<string, typeof Target> = { distance_km: TrendingUp, sessions: Flame, duration_minutes: Clock, elevation_m: Mountain }
              const KEYS: Record<string, string> = { distance_km: "goals.weeklyDistance", sessions: "goals.trainingSessions", duration_minutes: "goals.activeMinutes", elevation_m: "goals.elevationGain" }
              const Icon = ICONS[wg.metric] ?? Target
              return (
                <button
                  key={wg.id}
                  onClick={onViewGoals}
                  className={`flex items-center gap-3.5 rounded-2xl bg-card px-4 py-3.5 shadow-sm ring-1 text-left active:scale-[0.99] transition-transform ${isComplete ? "ring-2 ring-success/40" : "ring-border"}`}
                >
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isComplete ? "bg-success/15" : "bg-secondary"}`}>
                    <Icon size={18} className={isComplete ? "text-success" : "text-muted-foreground"} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-card-foreground truncate">
                      {t(KEYS[wg.metric]) || wg.label}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                      <span className={`font-semibold ${isComplete ? "text-success" : "text-foreground"}`}>{formatWeeklyMetric(current, wg.metric)}</span>
                      {" / "}{formatWeeklyMetric(wg.target, wg.metric)}
                    </p>
                  </div>

                  <div className="relative flex shrink-0 items-center justify-center">
                    <ProgressRing percentage={progress} size={52} strokeWidth={4} />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className={`text-[10px] font-bold tabular-nums ${isComplete ? "text-success" : "text-foreground"}`}>
                        {progress}%
                      </span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
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
                <CarouselItem key={activity.id} className="pl-3 basis-[68%]">
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
