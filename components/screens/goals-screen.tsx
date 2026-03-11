"use client"

import { useState, useMemo } from "react"
import {
  Check, Calendar, Target, Plus, Pencil,
  Flame, TrendingUp, Clock, Mountain,
  ChevronLeft, ChevronRight, RefreshCw, Timer, Trophy,
  CalendarCheck, MapPin, Footprints, Sparkles,
} from "lucide-react"
import {
  formatDistance,
  formatDate,
  formatDateShort,
  formatDuration,
  daysUntil,
  isDatePast,
  progressPercentage,
  timeElapsedPercentage,
  formatWeeklyMetric,
  formatTargetTime,
  computeWeeklyProgress,
  evaluatePerformanceGoal,
  computeDistanceInRange,
  bestRelevantRun,
  longestRun,
} from "@/lib/format"
import type { Activity, Goal, WeeklyGoal, WeeklyGoalMetric } from "@/lib/types"
import { useI18n } from "@/lib/i18n"

type GoalTab = "weekly" | "performance" | "events"

const METRIC_ICONS: Record<string, typeof Flame> = {
  distance_km: TrendingUp,
  sessions: Flame,
  duration_minutes: Clock,
  elevation_m: Mountain,
}

const METRIC_LABEL_KEYS: Record<WeeklyGoalMetric, "goals.weeklyDistance" | "goals.trainingSessions" | "goals.activeMinutes" | "goals.elevationGain"> = {
  distance_km: "goals.weeklyDistance",
  sessions: "goals.trainingSessions",
  duration_minutes: "goals.activeMinutes",
  elevation_m: "goals.elevationGain",
}

interface GoalsScreenProps {
  goals: Goal[]
  activities: Activity[]
  weeklyGoals: WeeklyGoal[]
  onToggleActive: (goalId: string) => void
  onEditGoal: (goal: Goal) => void
  onAddGoal: () => void
  onAddEventGoal: () => void
  onEditWeeklyGoal: (goal: WeeklyGoal) => void
  onAddWeeklyGoal: () => void
  onSelectGoal: (goal: Goal) => void
}

// ---- date helpers ----

function localMondayStr(date: Date): string {
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const mon = new Date(date)
  mon.setDate(date.getDate() + diff)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${mon.getFullYear()}-${p(mon.getMonth() + 1)}-${p(mon.getDate())}`
}

function shiftWeek(weekStr: string, delta: number): string {
  const d = new Date(weekStr + "T12:00:00")
  d.setDate(d.getDate() + delta * 7)
  return localMondayStr(d)
}

function weekLabel(weekStr: string, currentStr: string, thisWeekLabel: string): string {
  if (weekStr === currentStr) return thisWeekLabel
  const start = new Date(weekStr + "T12:00:00")
  const end = new Date(weekStr + "T12:00:00")
  end.setDate(end.getDate() + 6)
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { day: "numeric", month: "short" })
  return `${fmt(start)} – ${fmt(end)}`
}

// ---- training phase helper ----
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

// ---- component ----

export function GoalsScreen({
  goals,
  activities,
  weeklyGoals,
  onToggleActive,
  onEditGoal,
  onAddGoal,
  onAddEventGoal,
  onEditWeeklyGoal,
  onAddWeeklyGoal,
  onSelectGoal,
}: GoalsScreenProps) {
  const { t } = useI18n()
  const [tab, setTab] = useState<GoalTab>("weekly")

  const todayMondayStr = localMondayStr(new Date())
  const [selectedWeekStart, setSelectedWeekStart] = useState(todayMondayStr)

  const isCurrentWeek = selectedWeekStart === todayMondayStr
  const canGoForward = selectedWeekStart < todayMondayStr

  // Recurring goals show in every week; one-off goals only in their own week
  const selectedWeekGoals = weeklyGoals.filter((wg) =>
    wg.is_recurring || wg.week_start === selectedWeekStart
  )

  // Performance goals
  const performanceGoals = goals.filter((g) => g.goal_category === "performance")

  // Event training goals (sorted: active first, then by date)
  const eventGoals = [...goals.filter((g) => g.goal_category === "event_training")].sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1
    return new Date(a.target_date).getTime() - new Date(b.target_date).getTime()
  })

  // Pre-compute performance goal evaluations (avoids O(goals * activities) inside JSX)
  const perfGoalStatuses = useMemo(
    () =>
      new Map(
        performanceGoals.map((goal) => [
          goal.id,
          evaluatePerformanceGoal(activities, goal.target_distance_km, goal.target_time_seconds),
        ]),
      ),
    [performanceGoals, activities],
  )

  return (
    <div className="flex flex-col gap-5 px-5 pb-6 pt-4 md:px-8 md:max-w-2xl md:mx-auto">
      <header>
        <h1 className="text-2xl font-bold text-foreground">{t("goals.title")}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {t("goals.subtitle")}
        </p>
      </header>

      {/* Segmented control */}
      <div className="flex rounded-xl bg-secondary p-1">
        <button
          onClick={() => setTab("weekly")}
          className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition-all ${
            tab === "weekly"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground active:text-foreground"
          }`}
        >
          {t("goals.weekly")}
        </button>
        <button
          onClick={() => setTab("performance")}
          className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition-all ${
            tab === "performance"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground active:text-foreground"
          }`}
        >
          {t("goals.performance")}
        </button>
        <button
          onClick={() => setTab("events")}
          className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition-all ${
            tab === "events"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground active:text-foreground"
          }`}
        >
          {t("goals.events")}
        </button>
      </div>

      {/* ── Weekly tab ── */}
      {tab === "weekly" && (
        <div className="flex flex-col gap-4">

          {/* Week navigator */}
          <div className="flex items-center justify-between rounded-xl bg-secondary px-2 py-1">
            <button
              onClick={() => setSelectedWeekStart(shiftWeek(selectedWeekStart, -1))}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground active:bg-accent transition-colors"
              aria-label="Previous week"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="text-sm font-semibold text-foreground">
              {weekLabel(selectedWeekStart, todayMondayStr, t("goals.thisWeek"))}
            </span>
            <button
              onClick={() => setSelectedWeekStart(shiftWeek(selectedWeekStart, 1))}
              disabled={!canGoForward}
              className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                canGoForward ? "text-muted-foreground active:bg-accent" : "text-border"
              }`}
              aria-label="Next week"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Add button — current week only */}
          {isCurrentWeek && (
            <button
              onClick={onAddWeeklyGoal}
              className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground active:bg-secondary transition-colors"
            >
              <Plus size={18} />
              {t("goals.addWeeklyGoal")}
            </button>
          )}

          {selectedWeekGoals.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
                <Flame size={28} className="text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">
                {isCurrentWeek ? t("goals.noWeeklyGoals") : t("goals.noGoalsThisWeek")}
              </p>
              <p className="text-xs text-muted-foreground">
                {isCurrentWeek
                  ? t("goals.setTargets")
                  : t("goals.noGoalsSetThisWeek")}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {selectedWeekGoals.map((wg) => {
              const current = computeWeeklyProgress(
                activities,
                wg.metric,
                selectedWeekStart,
                wg.session_min_duration_minutes,
                wg.session_min_distance_km,
              )
              const progress = progressPercentage(current, wg.target)
              const Icon = METRIC_ICONS[wg.metric] || Target
              const isComplete = current >= wg.target
              const label = t(METRIC_LABEL_KEYS[wg.metric]) ?? wg.label

              return (
                <div
                  key={wg.id}
                  className={`rounded-2xl bg-card p-4 shadow-sm ring-1 transition-all ${
                    isComplete ? "ring-success/40 ring-2" : "ring-border"
                  }`}
                >
                  <div className="flex items-start gap-3.5">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                      isComplete ? "bg-success/15" : "bg-secondary"
                    }`}>
                      <Icon size={18} className={isComplete ? "text-success" : "text-muted-foreground"} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <h4 className="text-sm font-semibold text-card-foreground truncate">
                            {label}
                          </h4>
                          {wg.is_recurring && (
                            <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                              <RefreshCw size={9} />
                              {t("goals.weekly")}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => onEditWeeklyGoal(wg)}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground active:bg-accent transition-colors"
                          aria-label={`Edit ${label}`}
                        >
                          <Pencil size={12} />
                        </button>
                      </div>

                      {/* Per-session requirement hint */}
                      {wg.metric === "sessions" && (wg.session_min_duration_minutes || wg.session_min_distance_km) && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {[
                            wg.session_min_duration_minutes && `≥ ${wg.session_min_duration_minutes} min`,
                            wg.session_min_distance_km && `≥ ${wg.session_min_distance_km} km`,
                          ].filter(Boolean).join(" · ")} {t("goals.perSession")}
                        </p>
                      )}

                      <div className="mt-1 flex items-baseline gap-1">
                        <span className="text-xl font-bold font-mono text-foreground">
                          {formatWeeklyMetric(current, wg.metric)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          / {formatWeeklyMetric(wg.target, wg.metric)}
                        </span>
                      </div>

                      <div className="mt-2.5">
                        <div className="h-3 overflow-hidden rounded-full bg-secondary ring-1 ring-border/50">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              isComplete ? "bg-gradient-to-r from-success to-success/80 shadow-lg" : "bg-gradient-to-r from-primary to-primary/80"
                            }`}
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <div className="mt-2 flex items-center justify-between">
                          <span className={`text-[11px] font-medium ${isComplete ? "text-success" : "text-muted-foreground"}`}>
                            {isComplete ? t("goals.completed") : `${progress}%`}
                          </span>
                          {isComplete && (
                            <span className="text-[11px] font-semibold text-success animate-pulse">
                              ✓ {t("goals.goalReached")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
            </div>
          )}
        </div>
      )}

      {/* ── Performance tab ── */}
      {tab === "performance" && (
        <div className="flex flex-col gap-4">
          <button
            onClick={onAddGoal}
            className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground active:bg-secondary transition-colors"
          >
            <Plus size={18} />
            {t("goals.addPerfGoal")}
          </button>

          {performanceGoals.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
                <Timer size={28} className="text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">{t("goals.noPerfGoals")}</p>
              <p className="text-xs text-muted-foreground">
                {t("goals.setPerfTargets")}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {performanceGoals.map((goal) => {
              const status = perfGoalStatuses.get(goal.id) ?? { reached: false, bestActivity: null, bestTimeSeconds: null, progress: 0 }
              const days = daysUntil(goal.target_date)

              return (
                <div
                  key={goal.id}
                  className={`overflow-hidden rounded-2xl bg-card p-5 shadow-sm ring-1 transition-all ${
                    status.reached
                      ? "ring-success/40 ring-2"
                      : goal.is_active
                        ? "ring-primary/40 ring-2"
                        : "ring-border"
                  }`}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div className="flex flex-col gap-1 min-w-0 pr-3">
                      {status.reached ? (
                        <div className="flex items-center gap-1.5">
                          <Trophy size={12} className="text-success" />
                          <span className="text-[10px] font-semibold uppercase tracking-widest text-success">
                            {t("goals.goalReached")}
                          </span>
                        </div>
                      ) : goal.is_active ? (
                        <div className="flex items-center gap-1.5">
                          <div className="h-2 w-2 rounded-full bg-primary" />
                          <span className="text-[10px] font-semibold uppercase tracking-widest text-primary">
                            {t("goals.active")}
                          </span>
                        </div>
                      ) : null}
                      <h3 className="text-lg font-semibold text-card-foreground">
                        {goal.name}
                      </h3>
                    </div>
                    <button
                      onClick={() => onEditGoal(goal)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground active:bg-accent transition-colors"
                      aria-label={`Edit ${goal.name}`}
                    >
                      <Pencil size={14} />
                    </button>
                  </div>

                  {/* Goal details */}
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Target size={14} />
                      <span>{formatDistance(goal.target_distance_km)}</span>
                    </div>
                    {goal.target_time_seconds && (
                      <div className="flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                        <Timer size={12} />
                        <span>{formatTargetTime(goal.target_time_seconds)}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Calendar size={14} />
                      <span>{formatDate(goal.target_date)}</span>
                    </div>
                  </div>

                  {/* Progress toward goal */}
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className={`${status.reached ? "text-success font-medium" : "text-muted-foreground"}`}>
                        {goal.target_time_seconds
                          ? (status.bestActivity ? t("goals.bestTime") : t("goals.noQualifyingRuns"))
                          : (status.bestActivity ? t("goals.longestRun") : t("goals.noRuns"))}
                      </span>
                      {status.bestActivity && (
                        <span className={`font-semibold tabular-nums ${status.reached ? "text-success" : "text-foreground"}`}>
                          {goal.target_time_seconds
                            ? formatTargetTime(status.bestTimeSeconds!)
                            : formatDistance(status.bestActivity.distance_km)}
                        </span>
                      )}
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-secondary ring-1 ring-border/50">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${status.reached ? "bg-gradient-to-r from-success to-success/80 shadow-lg" : "bg-gradient-to-r from-primary to-primary/80"}`}
                        style={{ width: `${status.progress}%` }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">
                        {`${t("goals.target")}: `}
                        {goal.target_time_seconds
                          ? formatTargetTime(goal.target_time_seconds)
                          : formatDistance(goal.target_distance_km)}
                      </span>
                      {status.reached && status.bestActivity && (
                        <span className="font-semibold text-success animate-pulse">
                          ✓ {formatDateShort(status.bestActivity.date)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {days > 0 ? `${days} ${t("goals.daysRemaining")}` : t("goals.targetDatePassed")}
                    </span>
                    <button
                      onClick={() => onToggleActive(goal.id)}
                      className={`flex min-h-[36px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                        goal.is_active
                          ? "bg-primary/10 text-primary active:bg-primary/20"
                          : "bg-secondary text-secondary-foreground active:bg-accent"
                      }`}
                    >
                      <Check size={14} />
                      {goal.is_active ? t("goals.active") : t("goals.setActive")}
                    </button>
                  </div>
                </div>
              )
            })}
            </div>
          )}
        </div>
      )}

      {/* ── Events tab ───────────────────────────────────────────────────── */}
      {tab === "events" && (
        <div className="flex flex-col gap-4">
          {/* Add Event Goal button */}
          <button
            onClick={onAddEventGoal}
            className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground transition-colors active:bg-secondary"
          >
            <Plus size={18} />
            {t("plan.addEvent")}
          </button>

          {/* Event goal cards */}
          {eventGoals.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-secondary">
                <CalendarCheck size={24} className="text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground max-w-[240px]">
                {t("plan.emptyState")}
              </p>
            </div>
          ) : (
            eventGoals.map((goal) => {
              const days = daysUntil(goal.target_date)
              const isPast = isDatePast(goal.target_date)
              const phase = trainingPhaseKey(goal.start_date, goal.target_date)
              const logged = computeDistanceInRange(activities, goal.start_date, goal.target_date)
              const timeProgress = timeElapsedPercentage(goal.start_date, goal.target_date)
              const best = bestRelevantRun(activities, goal.target_distance_km, goal.start_date, goal.target_date)
              const longest = longestRun(activities, goal.start_date, goal.target_date)

              return (
                <button
                  key={goal.id}
                  onClick={() => onSelectGoal(goal)}
                  className={`relative overflow-hidden rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border text-left transition-all active:scale-[0.98] ${
                    goal.is_active ? "ring-2 ring-primary" : ""
                  } ${isPast ? "opacity-60" : ""}`}
                >
                  {/* Active badge */}
                  {goal.is_active && (
                    <div className="absolute top-3 right-3 flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5">
                      <Sparkles size={12} className="text-primary" />
                      <span className="text-[10px] font-semibold text-primary uppercase">
                        {t("plan.active")}
                      </span>
                    </div>
                  )}

                  {/* Goal name and phase */}
                  <div className="flex items-start gap-3 pr-16">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                      <Footprints size={20} className="text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground truncate">{goal.name}</h3>
                      <p className={`text-xs font-medium ${phase.color}`}>
                        {t(phase.labelKey)}
                      </p>
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Calendar size={14} />
                      <span>{isPast ? t("plan.completed") : `${days} ${t("common.daysLeft")}`}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <MapPin size={14} />
                      <span>{formatDistance(goal.target_distance_km)}</span>
                    </div>
                    {goal.target_time_seconds && (
                      <div className="flex items-center gap-1.5">
                        <Timer size={14} />
                        <span>{formatTargetTime(goal.target_time_seconds)}</span>
                      </div>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-muted-foreground">
                        {formatDistance(logged)} {t("common.logged")}
                      </span>
                      <span className={`font-medium ${timeProgress >= 95 ? "text-destructive" : timeProgress >= 85 ? "text-warning" : timeProgress >= 70 ? "text-primary" : "text-success"}`}>
                        {timeProgress}% {t("plan.timeElapsed")}
                      </span>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-secondary ring-1 ring-border/50">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          timeProgress >= 95 ? "bg-gradient-to-r from-destructive to-destructive/80 shadow-lg" :
                          timeProgress >= 85 ? "bg-gradient-to-r from-warning to-warning/80 shadow-lg" :
                          timeProgress >= 70 ? "bg-gradient-to-r from-primary to-primary/80 shadow-lg" :
                          "bg-gradient-to-r from-success to-success/80 shadow-lg"
                        }`}
                        style={{ width: `${timeProgress}%` }}
                      />
                    </div>
                  </div>

                  {/* Training stats */}
                  {(best || longest) && (
                    <div className="mt-3 pt-3 border-t border-border flex gap-4 text-xs">
                      {best && (
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Trophy size={12} className="text-amber-500" />
                          <span>{t("plan.bestRun")}: {formatDistance(best.distance_km)} in {formatDuration(best.duration_seconds)}</span>
                        </div>
                      )}
                      {longest && !best && (
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <TrendingUp size={12} className="text-emerald-500" />
                          <span>{t("plan.longestRun")}: {formatDistance(longest.distance_km)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
