"use client"

import { Check, Calendar, Target } from "lucide-react"
import { formatDistance, formatDate, daysUntil, progressPercentage } from "@/lib/format"
import type { Goal } from "@/lib/types"

interface GoalsScreenProps {
  goals: Goal[]
  onSetActive: (goalId: string) => void
}

export function GoalsScreen({ goals, onSetActive }: GoalsScreenProps) {
  return (
    <div className="flex flex-col gap-6 px-5 pb-28 pt-4">
      <header>
        <h1 className="text-2xl font-bold text-foreground">Goals</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Track your training targets
        </p>
      </header>

      {goals.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
            <Target size={28} className="text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-muted-foreground">No goals yet</p>
          <p className="text-xs text-muted-foreground">Add a goal to track your progress</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {goals.map((goal) => {
            const days = daysUntil(goal.target_date)
            // Use a training volume target based on weeks remaining
            const weeksTotal = Math.ceil(
              (new Date(goal.target_date).getTime() - new Date(goal.created_at).getTime()) /
                (1000 * 60 * 60 * 24 * 7)
            )
            const targetVolume = weeksTotal * 40 // ~40km/week target
            const progress = progressPercentage(goal.current_distance_km, targetVolume)

            return (
              <div
                key={goal.id}
                className={`relative overflow-hidden rounded-2xl bg-card p-5 shadow-sm ring-1 transition-all ${
                  goal.is_active
                    ? "ring-primary/40 ring-2"
                    : "ring-border"
                }`}
              >
                {/* Active badge */}
                {goal.is_active && (
                  <div className="mb-3 flex items-center gap-1.5">
                    <div className="h-2 w-2 rounded-full bg-primary" />
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-primary">
                      Active
                    </span>
                  </div>
                )}

                <h3 className="text-lg font-semibold text-card-foreground">
                  {goal.name}
                </h3>

                <div className="mt-3 flex items-center gap-4">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Target size={14} />
                    <span>{formatDistance(goal.target_distance_km)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Calendar size={14} />
                    <span>{formatDate(goal.target_date)}</span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {formatDistance(goal.current_distance_km)} logged
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

                {/* Days remaining */}
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {days} days remaining
                  </span>
                  {!goal.is_active && (
                    <button
                      onClick={() => onSetActive(goal.id)}
                      className="flex min-h-[36px] items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground active:bg-accent transition-colors"
                    >
                      <Check size={14} />
                      Set active
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
