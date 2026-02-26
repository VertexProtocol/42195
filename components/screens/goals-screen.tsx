"use client"

import { useState } from "react"
import { Check, Calendar, Target, Plus, Pencil, Flame, TrendingUp, Clock, Mountain } from "lucide-react"
import { formatDistance, formatDate, daysUntil, progressPercentage, formatWeeklyMetric } from "@/lib/format"
import type { Activity, Goal, WeeklyGoal } from "@/lib/types"

type GoalTab = "long-term" | "weekly"

const METRIC_ICONS: Record<string, typeof Flame> = {
  distance_km: TrendingUp,
  sessions: Flame,
  duration_minutes: Clock,
  elevation_m: Mountain,
}

/** Compute total distance from activities within a date range */
function computeDistanceInRange(activities: Activity[], startDate: string | null, endDate: string): number {
  const start = startDate ? new Date(startDate).getTime() : 0
  const end = new Date(endDate).getTime()
  return activities
    .filter((a) => {
      const d = new Date(a.date).getTime()
      return d >= start && d <= end
    })
    .reduce((sum, a) => sum + a.distance_km, 0)
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
  const [tab, setTab] = useState<GoalTab>("long-term")

  return (
    <div className="flex flex-col gap-5 px-5 pb-28 pt-4">
      <header>
        <h1 className="text-2xl font-bold text-foreground">Goals</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Track your training targets
        </p>
      </header>

      {/* Segmented control */}
      <div className="flex rounded-xl bg-secondary p-1">
        <button
          onClick={() => setTab("long-term")}
          className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition-all ${
            tab === "long-term"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground active:text-foreground"
          }`}
        >
          Long Term
        </button>
        <button
          onClick={() => setTab("weekly")}
          className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition-all ${
            tab === "weekly"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground active:text-foreground"
          }`}
        >
          This Week
        </button>
      </div>

      {/* Long-term goals tab */}
      {tab === "long-term" && (
        <div className="flex flex-col gap-4">
          {/* Add button */}
          <button
            onClick={onAddGoal}
            className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground active:bg-secondary transition-colors"
          >
            <Plus size={18} />
            Add long-term goal
          </button>

          {goals.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
                <Target size={28} className="text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">No goals yet</p>
              <p className="text-xs text-muted-foreground">
                Set a race or distance goal to work toward
              </p>
            </div>
          ) : (
            goals.map((goal) => {
              const days = daysUntil(goal.target_date)
              const logged = computeDistanceInRange(activities, goal.start_date, goal.target_date)
              const progress = progressPercentage(logged, goal.target_distance_km)

              return (
                <div
                  key={goal.id}
                  className={`relative overflow-hidden rounded-2xl bg-card p-5 shadow-sm ring-1 transition-all ${
                    goal.is_active ? "ring-primary/40 ring-2" : "ring-border"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      {goal.is_active && (
                        <div className="flex items-center gap-1.5">
                          <div className="h-2 w-2 rounded-full bg-primary" />
                          <span className="text-[10px] font-semibold uppercase tracking-widest text-primary">
                            Active
                          </span>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => onEditGoal(goal)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-muted-foreground active:bg-accent transition-colors"
                      aria-label={`Edit ${goal.name}`}
                    >
                      <Pencil size={14} />
                    </button>
                  </div>

                  <h3 className="mt-1 text-lg font-semibold text-card-foreground">
                    {goal.name}
                  </h3>

                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Target size={14} />
                      <span>{formatDistance(goal.target_distance_km)}</span>
                    </div>
                    {goal.start_date && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Calendar size={14} />
                        <span>From {formatDate(goal.start_date)}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Calendar size={14} />
                      <span>{formatDate(goal.target_date)}</span>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {formatDistance(logged)} logged
                      </span>
                      <span className="font-medium text-foreground">{progress}%</span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {days} days remaining
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

      {/* Weekly goals tab */}
      {tab === "weekly" && (
        <div className="flex flex-col gap-4">
          {/* Week label */}
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Week of {formatDate(getWeekStart())}
          </p>

          {/* Add button */}
          <button
            onClick={onAddWeeklyGoal}
            className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground active:bg-secondary transition-colors"
          >
            <Plus size={18} />
            Add weekly goal
          </button>

          {weeklyGoals.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
                <Flame size={28} className="text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">No weekly goals</p>
              <p className="text-xs text-muted-foreground">
                Set targets for distance, sessions, or more
              </p>
            </div>
          ) : (
            weeklyGoals.map((wg) => {
              const progress = progressPercentage(wg.current, wg.target)
              const Icon = METRIC_ICONS[wg.metric] || Target
              const isComplete = wg.current >= wg.target

              return (
                <div
                  key={wg.id}
                  className={`rounded-2xl bg-card p-4 shadow-sm ring-1 transition-all ${
                    isComplete ? "ring-success/40 ring-2" : "ring-border"
                  }`}
                >
                  <div className="flex items-start gap-3.5">
                    {/* Icon */}
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                      isComplete ? "bg-success/15" : "bg-secondary"
                    }`}>
                      <Icon size={18} className={isComplete ? "text-success" : "text-muted-foreground"} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-card-foreground">
                          {wg.label}
                        </h4>
                        <button
                          onClick={() => onEditWeeklyGoal(wg)}
                          className="flex h-7 w-7 items-center justify-center rounded-lg bg-secondary text-muted-foreground active:bg-accent transition-colors"
                          aria-label={`Edit ${wg.label}`}
                        >
                          <Pencil size={12} />
                        </button>
                      </div>

                      {/* Value display */}
                      <div className="mt-1 flex items-baseline gap-1">
                        <span className="text-xl font-bold font-mono text-foreground">
                          {formatWeeklyMetric(wg.current, wg.metric)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          / {formatWeeklyMetric(wg.target, wg.metric)}
                        </span>
                      </div>

                      {/* Progress bar */}
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
    </div>
  )
}

function getWeekStart(): string {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + diff)
  monday.setHours(0, 0, 0, 0)
  return monday.toISOString()
}
