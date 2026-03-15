"use client"

import { useState, useMemo } from "react"
import {
  Check, Calendar, Target, Plus, Pencil,
  Flame, TrendingUp, Clock, Mountain,
  ChevronLeft, ChevronRight, RefreshCw, Timer, Trophy,
  CalendarCheck, MapPin, Footprints, Sparkles, ChevronDown,
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

type GoalTab = "weekly" | "race"

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
  const [expandedGoalIds, setExpandedGoalIds] = useState<Set<string>>(new Set())

  const toggleExpanded = (id: string) => {
    setExpandedGoalIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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

  // All race goals: performance + events, sorted by active first, then by date
  const raceGoals = useMemo(() => {
    const all = [...performanceGoals, ...eventGoals]
    return all.sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1
      return new Date(a.target_date).getTime() - new Date(b.target_date).getTime()
    })
  }, [performanceGoals, eventGoals])

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
    <div className="flex flex-col gap-5 px-5 pb-6 pt-4">
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
          onClick={() => setTab("race")}
          className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition-all ${
            tab === "race"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground active:text-foreground"
          }`}
        >
          {t("goals.raceGoals")}
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
            selectedWeekGoals.map((wg) => {
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
                        <div className="h-2 overflow-hidden rounded-full bg-secondary">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              isComplete ? "bg-success" : "bg-primary"
                            }`}
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-[11px] text-muted-foreground">
                            {isComplete ? t("goals.completed") : `${progress}%`}
                          </span>
                          {isComplete && (
                            <span className="text-[11px] font-medium text-success">
                              {t("goals.goalReached")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {/* ── Race Goals tab (merged Performance + Events) ── */}
      {tab === "race" && (
        <div className="flex flex-col gap-3">
          {/* Add buttons */}
          <div className="flex gap-2">
            <button
              onClick={onAddGoal}
              className="flex flex-1 min-h-[44px] items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-2.5 text-sm font-medium text-muted-foreground active:bg-secondary transition-colors"
            >
              <Timer size={16} />
              {t("goals.addPerfGoal")}
            </button>
            <button
              onClick={onAddEventGoal}
              className="flex flex-1 min-h-[44px] items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-2.5 text-sm font-medium text-muted-foreground active:bg-secondary transition-colors"
            >
              <CalendarCheck size={16} />
              {t("plan.addEvent")}
            </button>
          </div>

          {/* Empty state */}
          {raceGoals.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
                <Trophy size={28} className="text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">{t("goals.noRaceGoals")}</p>
              <p className="text-xs text-muted-foreground text-center max-w-[240px]">
                {t("goals.setRaceGoals")}
              </p>
            </div>
          ) : (
            raceGoals.map((goal) => {
              const isPerformance = goal.goal_category === "performance"
              const isExpanded = expandedGoalIds.has(goal.id)
              const days = daysUntil(goal.target_date)
              const isPast = isDatePast(goal.target_date)
              
              // Performance goal specific
              const status = isPerformance 
                ? (perfGoalStatuses.get(goal.id) ?? { reached: false, bestActivity: null, bestTimeSeconds: null, progress: 0 })
                : null
              
              // Event goal specific
              const phase = !isPerformance ? trainingPhaseKey(goal.start_date, goal.target_date) : null
              const logged = !isPerformance ? computeDistanceInRange(activities, goal.start_date, goal.target_date) : 0
              const timeProgress = !isPerformance ? timeElapsedPercentage(goal.start_date, goal.target_date) : 0
              const best = !isPerformance ? bestRelevantRun(activities, goal.target_distance_km, goal.start_date, goal.target_date) : null
              const longest = !isPerformance ? longestRun(activities, goal.start_date, goal.target_date) : null

              return (
                <div
                  key={goal.id}
                  className={`overflow-hidden rounded-2xl bg-card shadow-sm ring-1 transition-all ${
                    status?.reached
                      ? "ring-success/40 ring-2"
                      : goal.is_active
                        ? "ring-primary/40 ring-2"
                        : "ring-border"
                  } ${isPast && !status?.reached ? "opacity-60" : ""}`}
                >
                  {/* Collapsed header - always visible */}
                  <button
                    type="button"
                    onClick={() => toggleExpanded(goal.id)}
                    className="flex w-full items-center gap-3 p-4 text-left active:bg-secondary/50 transition-colors"
                  >
                    {/* Icon */}
                    <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${
                      isPerformance ? "bg-amber-500/10" : "bg-primary/10"
                    }`}>
                      {isPerformance ? (
                        <Timer size={20} className="text-amber-500" />
                      ) : (
                        <Footprints size={20} className="text-primary" />
                      )}
                    </div>
                    
                    {/* Title and summary */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-foreground truncate">{goal.name}</h3>
                        {goal.is_active && (
                          <div className="h-2 w-2 rounded-full bg-primary shrink-0" />
                        )}
                        {status?.reached && (
                          <Trophy size={14} className="text-success shrink-0" />
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        <span>{formatDistance(goal.target_distance_km)}</span>
                        {goal.target_time_seconds && (
                          <>
                            <span>·</span>
                            <span className="text-primary font-medium">{formatTargetTime(goal.target_time_seconds)}</span>
                          </>
                        )}
                        <span>·</span>
                        <span>{isPast ? t("plan.completed") : `${days} ${t("common.daysLeft")}`}</span>
                      </div>
                    </div>
                    
                    {/* Chevron */}
                    <ChevronDown 
                      size={18} 
                      className={`text-muted-foreground shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`} 
                    />
                  </button>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-border">
                      {isPerformance && status ? (
                        /* Performance goal expanded content */
                        <>
                          <div className="mt-4">
                            <div className="flex items-center justify-between text-xs mb-1.5">
                              <span className="text-muted-foreground">
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
                            <div className="h-2 overflow-hidden rounded-full bg-secondary">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${status.reached ? "bg-success" : "bg-primary"}`}
                                style={{ width: `${status.progress}%` }}
                              />
                            </div>
                            <div className="mt-1 flex items-center justify-between text-[11px]">
                              <span className="text-muted-foreground">
                                {`${t("goals.target")}: `}
                                {goal.target_time_seconds
                                  ? formatTargetTime(goal.target_time_seconds)
                                  : formatDistance(goal.target_distance_km)}
                              </span>
                              {status.reached && status.bestActivity && (
                                <span className="font-medium text-success">
                                  {formatDateShort(status.bestActivity.date)}
                                </span>
                              )}
                            </div>
                          </div>
                          
                          {/* Actions */}
                          <div className="mt-4 flex items-center justify-between">
                            <button
                              onClick={(e) => { e.stopPropagation(); onEditGoal(goal); }}
                              className="flex items-center gap-1.5 text-xs text-muted-foreground active:text-foreground transition-colors"
                            >
                              <Pencil size={14} />
                              Edit
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); onToggleActive(goal.id); }}
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
                        </>
                      ) : (
                        /* Event goal expanded content */
                        <>
                          {phase && (
                            <p className={`mt-3 text-xs font-medium ${phase.color}`}>
                              {t(phase.labelKey)}
                            </p>
                          )}
                          
                          {/* Progress bar */}
                          <div className="mt-3">
                            <div className="flex items-center justify-between text-xs mb-1.5">
                              <span className="text-muted-foreground">
                                {formatDistance(logged)} {t("common.logged")}
                              </span>
                              <span className="font-medium text-foreground">{timeProgress}% {t("plan.timeElapsed")}</span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-secondary">
                              <div
                                className="h-full rounded-full bg-primary transition-all duration-500"
                                style={{ width: `${timeProgress}%` }}
                              />
                            </div>
                          </div>

                          {/* Training stats */}
                          {(best || longest) && (
                            <div className="mt-3 pt-3 border-t border-border flex flex-wrap gap-3 text-xs">
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
                          
                          {/* Actions */}
                          <div className="mt-4 flex items-center justify-between">
                            <button
                              onClick={(e) => { e.stopPropagation(); onEditGoal(goal); }}
                              className="flex items-center gap-1.5 text-xs text-muted-foreground active:text-foreground transition-colors"
                            >
                              <Pencil size={14} />
                              Edit
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); onSelectGoal(goal); }}
                              className="flex min-h-[36px] items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary active:bg-primary/20 transition-colors"
                            >
                              View Plan
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
