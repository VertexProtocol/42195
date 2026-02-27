"use client"

import { useState } from "react"
import {
  Check, Calendar, Target, Plus, Pencil,
  Flame, TrendingUp, Clock, Mountain,
  ChevronLeft, ChevronRight, RefreshCw, Timer,
} from "lucide-react"
import {
  formatDistance,
  formatDate,
  daysUntil,
  progressPercentage,
  timeElapsedPercentage,
  formatWeeklyMetric,
  formatTargetTime,
  computeDistanceInRange,
  computeWeeklyProgress,
} from "@/lib/format"
import type { Activity, Goal, WeeklyGoal, WeeklyGoalMetric } from "@/lib/types"

type GoalTab = "weekly" | "performance"

const METRIC_ICONS: Record<string, typeof Flame> = {
  distance_km: TrendingUp,
  sessions: Flame,
  duration_minutes: Clock,
  elevation_m: Mountain,
}

const METRIC_LABELS: Record<WeeklyGoalMetric, string> = {
  distance_km: "Weekly Distance",
  sessions: "Training Sessions",
  duration_minutes: "Active Minutes",
  elevation_m: "Elevation Gain",
}

interface GoalsScreenProps {
  goals: Goal[]
  activities: Activity[]
  weeklyGoals: WeeklyGoal[]
  onToggleActive: (goalId: string) => void
  onEditGoal: (goal: Goal) => void
  onAddGoal: () => void
  onEditWeeklyGoal: (goal: WeeklyGoal) => void
  onAddWeeklyGoal: () => void
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

function weekLabel(weekStr: string, currentStr: string): string {
  if (weekStr === currentStr) return "Denne uken"
  const start = new Date(weekStr + "T12:00:00")
  const end = new Date(weekStr + "T12:00:00")
  end.setDate(end.getDate() + 6)
  const fmt = (d: Date) =>
    d.toLocaleDateString("nb-NO", { day: "numeric", month: "short" })
  return `${fmt(start)} – ${fmt(end)}`
}

// ---- component ----

export function GoalsScreen({
  goals,
  activities,
  weeklyGoals,
  onToggleActive,
  onEditGoal,
  onAddGoal,
  onEditWeeklyGoal,
  onAddWeeklyGoal,
}: GoalsScreenProps) {
  const [tab, setTab] = useState<GoalTab>("weekly")

  const todayMondayStr = localMondayStr(new Date())
  const [selectedWeekStart, setSelectedWeekStart] = useState(todayMondayStr)

  const isCurrentWeek = selectedWeekStart === todayMondayStr
  const canGoForward = selectedWeekStart < todayMondayStr

  // Recurring goals show in every week; one-off goals only in their own week
  const selectedWeekGoals = weeklyGoals.filter((wg) =>
    wg.is_recurring || wg.week_start === selectedWeekStart
  )

  // Performance goals only (event_training goals live in Plan tab)
  const performanceGoals = goals.filter((g) => g.goal_category === "performance")

  return (
    <div className="flex flex-col gap-5 px-5 pb-6 pt-4">
      <header>
        <h1 className="text-2xl font-bold text-foreground">Goals</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Weekly targets and performance benchmarks
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
          Weekly
        </button>
        <button
          onClick={() => setTab("performance")}
          className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition-all ${
            tab === "performance"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground active:text-foreground"
          }`}
        >
          Performance
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
              {weekLabel(selectedWeekStart, todayMondayStr)}
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
              Add weekly goal
            </button>
          )}

          {selectedWeekGoals.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
                <Flame size={28} className="text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">
                {isCurrentWeek ? "No weekly goals" : "No goals this week"}
              </p>
              <p className="text-xs text-muted-foreground">
                {isCurrentWeek
                  ? "Set targets for distance, sessions, or more"
                  : "No goals were set for this week"}
              </p>
            </div>
          ) : (
            selectedWeekGoals.map((wg) => {
              const current = computeWeeklyProgress(activities, wg.metric, selectedWeekStart)
              const progress = progressPercentage(current, wg.target)
              const Icon = METRIC_ICONS[wg.metric] || Target
              const isComplete = current >= wg.target
              const label = METRIC_LABELS[wg.metric] ?? wg.label

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
                              Weekly
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
                            {isComplete ? "Completed" : `${progress}%`}
                          </span>
                          {isComplete && (
                            <span className="text-[11px] font-medium text-success">
                              Goal reached
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

      {/* ── Performance tab ── */}
      {tab === "performance" && (
        <div className="flex flex-col gap-4">
          <button
            onClick={onAddGoal}
            className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground active:bg-secondary transition-colors"
          >
            <Plus size={18} />
            Add performance goal
          </button>

          {performanceGoals.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
                <Timer size={28} className="text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">No performance goals</p>
              <p className="text-xs text-muted-foreground">
                Set a timed benchmark to chase, e.g. sub-50 10 km
              </p>
            </div>
          ) : (
            performanceGoals.map((goal) => {
              const logged = computeDistanceInRange(
                activities,
                goal.start_date,
                goal.target_date,
                goal.created_at,
              )
              const effectiveStart = goal.start_date ?? goal.created_at
              const timeProgress = timeElapsedPercentage(effectiveStart, goal.target_date)
              const days = daysUntil(goal.target_date)

              return (
                <div
                  key={goal.id}
                  className={`relative overflow-hidden rounded-2xl bg-card p-5 shadow-sm ring-1 transition-all ${
                    goal.is_active ? "ring-primary/40 ring-2" : "ring-border"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex flex-col gap-1">
                      {goal.is_active && (
                        <div className="flex items-center gap-1.5">
                          <div className="h-2 w-2 rounded-full bg-primary" />
                          <span className="text-[10px] font-semibold uppercase tracking-widest text-primary">
                            Active
                          </span>
                        </div>
                      )}
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

                  {/* Metrics row */}
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

                  {/* Training logged */}
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {formatDistance(logged)} logged
                      </span>
                      <span className="font-medium text-foreground">{timeProgress}% elapsed</span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${timeProgress}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {days > 0 ? `${days} days remaining` : "Date passed"}
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
                      {goal.is_active ? "Active" : "Set active"}
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
