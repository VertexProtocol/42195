"use client"

import { useState, useEffect } from "react"
import { X, Trash2, RefreshCw, Calendar } from "lucide-react"
import type { WeeklyGoal, WeeklyGoalMetric } from "@/lib/types"

const METRIC_OPTIONS: { value: WeeklyGoalMetric; label: string; placeholder: string; unit: string }[] = [
  { value: "distance_km", label: "Distance", placeholder: "40", unit: "km" },
  { value: "sessions", label: "Sessions", placeholder: "5", unit: "runs" },
  { value: "duration_minutes", label: "Duration", placeholder: "300", unit: "min" },
  { value: "elevation_m", label: "Elevation", placeholder: "500", unit: "m" },
]

interface WeeklyGoalEditorProps {
  goal: WeeklyGoal | null
  isNew: boolean
  open: boolean
  onSave: (goal: WeeklyGoal) => void
  onDelete?: (goalId: string) => void
  onClose: () => void
}

export function WeeklyGoalEditor({ goal, isNew, open, onSave, onDelete, onClose }: WeeklyGoalEditorProps) {
  const [metric, setMetric] = useState<WeeklyGoalMetric>("distance_km")
  const [target, setTarget] = useState("")
  const [isRecurring, setIsRecurring] = useState(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [sessionMinDuration, setSessionMinDuration] = useState("")
  const [sessionMinDistance, setSessionMinDistance] = useState("")

  useEffect(() => {
    if (open && goal && !isNew) {
      setMetric(goal.metric)
      setTarget(goal.target.toString())
      setIsRecurring(goal.is_recurring)
      setShowConfirmDelete(false)
      setSessionMinDuration(goal.session_min_duration_minutes?.toString() ?? "")
      setSessionMinDistance(goal.session_min_distance_km?.toString() ?? "")
    } else if (open && isNew) {
      setMetric("distance_km")
      setTarget("")
      setIsRecurring(false)
      setShowConfirmDelete(false)
      setSessionMinDuration("")
      setSessionMinDistance("")
    }
  }, [open, goal, isNew])

  const selectedOption = METRIC_OPTIONS.find((o) => o.value === metric)!
  const canSave = parseFloat(target) > 0

  const handleSave = () => {
    if (!canSave) return

    const now = new Date()
    const dayOfWeek = now.getDay()
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
    const monday = new Date(now)
    monday.setDate(now.getDate() + mondayOffset)
    // Build a local YYYY-MM-DD string — toISOString() converts to UTC and can
    // shift the date by a day for users east of UTC (e.g. Norway UTC+1).
    const pad = (n: number) => String(n).padStart(2, "0")
    const mondayStr = `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`

    const saved: WeeklyGoal = {
      id: isNew ? crypto.randomUUID() : goal!.id,
      metric,
      label: selectedOption.label === "Distance" ? "Weekly Distance" :
             selectedOption.label === "Sessions" ? "Training Sessions" :
             selectedOption.label === "Duration" ? "Active Minutes" :
             "Elevation Gain",
      target: parseFloat(target),
      current: isNew ? 0 : goal!.current,
      week_start: isNew ? mondayStr : goal!.week_start,
      is_recurring: isRecurring,
      session_min_duration_minutes: metric === "sessions" && sessionMinDuration
        ? parseInt(sessionMinDuration, 10)
        : null,
      session_min_distance_km: metric === "sessions" && sessionMinDistance
        ? parseFloat(sessionMinDistance)
        : null,
    }
    onSave(saved)
  }

  const handleDelete = () => {
    if (!goal || isNew) return
    if (showConfirmDelete) {
      onDelete?.(goal.id)
      onClose()
    } else {
      setShowConfirmDelete(true)
    }
  }

  if (!open) return null

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-foreground/30 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md animate-in slide-in-from-bottom duration-300">
        <div className="flex max-h-[92dvh] flex-col rounded-t-3xl bg-card shadow-2xl ring-1 ring-border">
          {/* Handle */}
          <div className="flex shrink-0 justify-center pt-3 pb-1">
            <div className="h-1 w-10 rounded-full bg-border" />
          </div>

          {/* Header */}
          <div className="flex shrink-0 items-center justify-between px-5 pb-4 pt-2">
            <button
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary active:bg-accent transition-colors"
              aria-label="Close"
            >
              <X size={18} className="text-muted-foreground" />
            </button>
            <h2 className="text-base font-semibold text-card-foreground">
              {isNew ? "New Weekly Goal" : "Edit Weekly Goal"}
            </h2>
            <button
              onClick={handleSave}
              disabled={!canSave}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                canSave
                  ? "bg-primary text-primary-foreground active:opacity-80"
                  : "bg-secondary text-muted-foreground"
              }`}
            >
              Save
            </button>
          </div>

          {/* Form — scrollable */}
          <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-5 px-5 pb-4">

            {/* Recurring / One-off toggle */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Frequency
              </label>
              <div className="flex rounded-xl bg-secondary p-1">
                <button
                  onClick={() => setIsRecurring(false)}
                  className={`flex flex-1 min-h-[40px] items-center justify-center gap-2 rounded-lg text-sm font-medium transition-all ${
                    !isRecurring
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground active:text-foreground"
                  }`}
                >
                  <Calendar size={14} />
                  This week only
                </button>
                <button
                  onClick={() => setIsRecurring(true)}
                  className={`flex flex-1 min-h-[40px] items-center justify-center gap-2 rounded-lg text-sm font-medium transition-all ${
                    isRecurring
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground active:text-foreground"
                  }`}
                >
                  <RefreshCw size={14} />
                  Every week
                </button>
              </div>
              <span className="text-xs text-muted-foreground">
                {isRecurring
                  ? "This goal will appear every week as a standing target"
                  : "This goal is set for this week only"}
              </span>
            </div>

            {/* Metric selector */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Metric
              </label>
              <div className="grid grid-cols-2 gap-2">
                {METRIC_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setMetric(option.value)}
                    className={`flex min-h-[48px] items-center justify-center rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                      metric === option.value
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-secondary-foreground active:bg-accent"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Target value */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Weekly target ({selectedOption.unit})
              </label>
              <input
                type="number"
                inputMode="decimal"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder={selectedOption.placeholder}
                step={metric === "sessions" ? "1" : "0.1"}
                min="0"
                className="h-12 rounded-xl border-0 bg-secondary px-4 text-base text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>

            {/* Per-session requirements (sessions metric only) */}
            {metric === "sessions" && (
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Per-session requirement (optional)
                </label>
                <p className="text-xs text-muted-foreground">
                  Only count sessions that meet these thresholds. Leave blank to count all sessions.
                </p>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <span className="w-28 text-sm text-foreground">Min. duration</span>
                    <div className="flex flex-1 items-center gap-2">
                      <input
                        type="number"
                        inputMode="numeric"
                        value={sessionMinDuration}
                        onChange={(e) => setSessionMinDuration(e.target.value)}
                        placeholder="e.g. 30"
                        min="0"
                        step="1"
                        className="h-10 w-full rounded-xl border-0 bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                      <span className="shrink-0 text-sm text-muted-foreground">min</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-28 text-sm text-foreground">Min. distance</span>
                    <div className="flex flex-1 items-center gap-2">
                      <input
                        type="number"
                        inputMode="decimal"
                        value={sessionMinDistance}
                        onChange={(e) => setSessionMinDistance(e.target.value)}
                        placeholder="e.g. 10"
                        min="0"
                        step="0.1"
                        className="h-10 w-full rounded-xl border-0 bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                      <span className="shrink-0 text-sm text-muted-foreground">km</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
          </div>{/* end scrollable form */}

          {/* Delete button */}
          {!isNew && (
            <div className="shrink-0 border-t border-border px-5 py-4">
              <button
                onClick={handleDelete}
                className={`flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl text-sm font-medium transition-colors ${
                  showConfirmDelete
                    ? "bg-destructive/10 text-destructive active:bg-destructive/20"
                    : "bg-secondary text-destructive active:bg-accent"
                }`}
              >
                <Trash2 size={16} />
                {showConfirmDelete ? "Tap again to confirm" : "Delete goal"}
              </button>
            </div>
          )}

          <div className="h-8 shrink-0" />
        </div>
      </div>
    </>
  )
}
