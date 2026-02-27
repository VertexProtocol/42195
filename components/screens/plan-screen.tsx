"use client"

import { Plus, Pencil, CalendarCheck, TrendingUp, Footprints, Clock, MapPin, Check } from "lucide-react"
import {
  formatDistance,
  formatDate,
  formatDuration,
  daysUntil,
  timeElapsedPercentage,
  computeDistanceInRange,
} from "@/lib/format"
import type { Activity, Goal } from "@/lib/types"

interface PlanScreenProps {
  goals: Goal[]
  activities: Activity[]
  onEditGoal: (goal: Goal) => void
  onAddGoal: () => void
  onToggleActive: (goalId: string) => void
}

/**
 * Returns a training phase label based on how far through the preparation period we are.
 * 0–70%  → Building base
 * 70–85% → Peak training
 * 85–95% → Tapering
 * 95%+   → Race week
 */
function trainingPhase(startDate: string | null, targetDate: string): {
  label: string
  color: string
} {
  const pct = timeElapsedPercentage(startDate, targetDate)
  if (pct >= 95) return { label: "Race week", color: "text-destructive" }
  if (pct >= 85) return { label: "Tapering", color: "text-warning" }
  if (pct >= 70) return { label: "Peak training", color: "text-primary" }
  return { label: "Building base", color: "text-success" }
}

/** Best run at approximately the goal distance (±20%) */
function bestRelevantRun(
  activities: Activity[],
  targetDistanceKm: number,
): Activity | null {
  const lo = targetDistanceKm * 0.8
  const hi = targetDistanceKm * 1.2
  const candidates = activities.filter(
    (a) => a.distance_km >= lo && a.distance_km <= hi && a.duration_seconds > 0
  )
  if (candidates.length === 0) return null
  return candidates.reduce((best, a) => a.duration_seconds < best.duration_seconds ? a : best)
}

/** Longest single run since start_date */
function longestRun(activities: Activity[], startDate: string | null, created_at: string): Activity | null {
  const from = startDate ? new Date(startDate).getTime() : new Date(created_at).getTime()
  const relevant = activities.filter((a) => new Date(a.date).getTime() >= from)
  if (relevant.length === 0) return null
  return relevant.reduce((best, a) => a.distance_km > best.distance_km ? a : best)
}

export function PlanScreen({ goals, activities, onEditGoal, onAddGoal, onToggleActive }: PlanScreenProps) {
  const eventGoals = goals.filter((g) => g.goal_category === "event_training")

  // Sort: active first, then by target date ascending
  const sorted = [...eventGoals].sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1
    return new Date(a.target_date).getTime() - new Date(b.target_date).getTime()
  })

  return (
    <div className="flex flex-col gap-5 px-5 pb-6 pt-4">
      <header>
        <h1 className="text-2xl font-bold text-foreground">Plan</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Race preparation and long-term training
        </p>
      </header>

      {/* Add event goal */}
      <button
        onClick={onAddGoal}
        className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground active:bg-secondary transition-colors"
      >
        <Plus size={18} />
        Add event / race goal
      </button>

      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
            <CalendarCheck size={28} className="text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-muted-foreground">No events planned</p>
          <p className="text-xs text-muted-foreground text-center max-w-[220px]">
            Add a race or event goal to start tracking your training preparation
          </p>
        </div>
      ) : (
        sorted.map((goal) => {
          const days = daysUntil(goal.target_date)
          const effectiveStart = goal.start_date ?? goal.created_at
          const timeProgress = timeElapsedPercentage(effectiveStart, goal.target_date)
          const logged = computeDistanceInRange(
            activities,
            goal.start_date,
            goal.target_date,
            goal.created_at,
          )
          const phase = trainingPhase(goal.start_date, goal.target_date)
          const best = bestRelevantRun(activities, goal.target_distance_km)
          const longest = longestRun(activities, goal.start_date, goal.created_at)

          return (
            <div
              key={goal.id}
              className={`overflow-hidden rounded-2xl bg-card shadow-sm ring-1 transition-all ${
                goal.is_active ? "ring-primary/40 ring-2" : "ring-border"
              }`}
            >
              {/* Card header */}
              <div className="px-5 pt-5 pb-4">
                <div className="flex items-start justify-between">
                  <div className="flex flex-col gap-1 min-w-0 pr-3">
                    {goal.is_active && (
                      <div className="flex items-center gap-1.5">
                        <div className="h-2 w-2 rounded-full bg-primary" />
                        <span className="text-[10px] font-semibold uppercase tracking-widest text-primary">
                          Active plan
                        </span>
                      </div>
                    )}
                    <h3 className="text-xl font-bold text-card-foreground leading-tight">
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
                  {days > 0 && (
                    <div className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-foreground">
                      {days} days to go
                    </div>
                  )}
                  {days === 0 && (
                    <div className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                      Race day!
                    </div>
                  )}
                </div>

                {/* Training phase */}
                {goal.start_date && days > 0 && (
                  <div className={`mt-2 text-xs font-semibold ${phase.color}`}>
                    {phase.label}
                  </div>
                )}
              </div>

              {/* Training progress */}
              <div className="px-5 pb-4">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-muted-foreground">
                    {goal.start_date ? `Training from ${formatDate(goal.start_date)}` : "Training progress"}
                  </span>
                  <span className="font-medium text-foreground">{timeProgress}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
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
                  <span className="text-[10px] text-muted-foreground text-center">km logged</span>
                </div>
                <div className="flex flex-col items-center gap-1 px-3 py-3">
                  <Footprints size={14} className="text-muted-foreground" />
                  <span className="text-base font-bold font-mono text-foreground">
                    {longest ? `${longest.distance_km.toFixed(1)}` : "—"}
                  </span>
                  <span className="text-[10px] text-muted-foreground text-center">longest run</span>
                </div>
                <div className="flex flex-col items-center gap-1 px-3 py-3">
                  <Clock size={14} className="text-muted-foreground" />
                  <span className="text-base font-bold font-mono text-foreground">
                    {best ? formatDuration(best.duration_seconds) : "—"}
                  </span>
                  <span className="text-[10px] text-muted-foreground text-center">best sim. run</span>
                </div>
              </div>

              {/* Set active / done button */}
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
                  {goal.is_active ? "Active plan" : "Set as active"}
                </button>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
