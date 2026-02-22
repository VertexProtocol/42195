"use client"

import { ChevronRight, TrendingUp, Clock, Footprints } from "lucide-react"
import { ProgressRing } from "@/components/progress-ring"
import { formatDistance, formatDuration, daysUntil, progressPercentage } from "@/lib/format"
import type { Goal, WeeklySummary } from "@/lib/types"

interface HomeScreenProps {
  activeGoal: Goal | null
  weeklySummary: WeeklySummary
  onViewActivities: () => void
  onViewGoal: () => void
}

export function HomeScreen({
  activeGoal,
  weeklySummary,
  onViewActivities,
  onViewGoal,
}: HomeScreenProps) {
  const progress = activeGoal
    ? progressPercentage(activeGoal.current_distance_km, 800)
    : 0
  const days = activeGoal ? daysUntil(activeGoal.target_date) : 0

  return (
    <div className="flex flex-col gap-6 px-5 pb-28 pt-4">
      {/* Header */}
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="font-mono text-3xl font-bold tracking-tight text-foreground">
            42195
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Your training, at a glance</p>
        </div>
      </header>

      {/* Active Goal Card */}
      {activeGoal ? (
        <button
          onClick={onViewGoal}
          className="relative overflow-hidden rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border text-left active:scale-[0.98] transition-transform"
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="text-xs font-medium uppercase tracking-wider text-primary">
                Active Goal
              </p>
              <h2 className="mt-1 text-xl font-semibold text-card-foreground">
                {activeGoal.name}
              </h2>
              <div className="mt-3 flex items-center gap-4">
                <span className="text-sm text-muted-foreground">
                  {days} days left
                </span>
                <span className="text-sm font-medium text-primary">
                  {formatDistance(activeGoal.current_distance_km)} logged
                </span>
              </div>
            </div>
            <div className="relative flex items-center justify-center">
              <ProgressRing
                percentage={progress}
                size={80}
                strokeWidth={6}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-sm font-bold text-foreground">{progress}%</span>
              </div>
            </div>
          </div>
          <ChevronRight size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
        </button>
      ) : (
        <div className="rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border">
          <p className="text-sm text-muted-foreground">No active goal set</p>
          <button
            onClick={onViewGoal}
            className="mt-2 text-sm font-medium text-primary active:opacity-70"
          >
            Set a goal
          </button>
        </div>
      )}

      {/* Weekly Summary */}
      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          This Week
        </h3>
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <TrendingUp size={20} className="text-primary" />
            </div>
            <span className="text-lg font-bold text-card-foreground">
              {weeklySummary.total_distance_km.toFixed(1)}
            </span>
            <span className="text-xs text-muted-foreground">km</span>
          </div>
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <Clock size={20} className="text-primary" />
            </div>
            <span className="text-lg font-bold text-card-foreground">
              {formatDuration(weeklySummary.total_time_seconds)}
            </span>
            <span className="text-xs text-muted-foreground">time</span>
          </div>
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <Footprints size={20} className="text-primary" />
            </div>
            <span className="text-lg font-bold text-card-foreground">
              {weeklySummary.run_count}
            </span>
            <span className="text-xs text-muted-foreground">runs</span>
          </div>
        </div>
      </section>

      {/* CTA Buttons */}
      <div className="flex flex-col gap-3">
        <button
          onClick={onViewActivities}
          className="flex min-h-[48px] items-center justify-center rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm active:opacity-90 transition-opacity"
        >
          View Activities
        </button>
        <button
          onClick={onViewGoal}
          className="flex min-h-[48px] items-center justify-center rounded-xl bg-secondary px-6 py-3 text-sm font-semibold text-secondary-foreground ring-1 ring-border active:bg-accent transition-colors"
        >
          View Goals
        </button>
      </div>
    </div>
  )
}
