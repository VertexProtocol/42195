"use client"

import { useState, useEffect } from "react"
import { X, Trash2 } from "lucide-react"
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
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)

  useEffect(() => {
    if (open && goal && !isNew) {
      setMetric(goal.metric)
      setTarget(goal.target.toString())
      setShowConfirmDelete(false)
    } else if (open && isNew) {
      setMetric("distance_km")
      setTarget("")
      setShowConfirmDelete(false)
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
    monday.setHours(0, 0, 0, 0)

    const saved: WeeklyGoal = {
      id: isNew ? `wg-${Date.now()}` : goal!.id,
      metric,
      label: selectedOption.label === "Distance" ? "Weekly Distance" :
             selectedOption.label === "Sessions" ? "Training Sessions" :
             selectedOption.label === "Duration" ? "Active Minutes" :
             "Elevation Gain",
      target: parseFloat(target),
      current: isNew ? 0 : goal!.current,
      week_start: isNew ? monday.toISOString() : goal!.week_start,
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
