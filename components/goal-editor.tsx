"use client"

import { useState, useEffect } from "react"
import { X, Trash2 } from "lucide-react"
import type { Goal } from "@/lib/types"

interface GoalEditorProps {
  goal: Goal | null
  isNew: boolean
  open: boolean
  onSave: (goal: Goal) => void
  onDelete?: (goalId: string) => void
  onClose: () => void
}

export function GoalEditor({ goal, isNew, open, onSave, onDelete, onClose }: GoalEditorProps) {
  const [name, setName] = useState("")
  const [targetDistance, setTargetDistance] = useState("")
  const [targetTimeH, setTargetTimeH] = useState("")
  const [targetTimeM, setTargetTimeM] = useState("")
  const [targetTimeS, setTargetTimeS] = useState("")
  const [startDate, setStartDate] = useState("")
  const [targetDate, setTargetDate] = useState("")
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)

  useEffect(() => {
    if (open && goal && !isNew) {
      setName(goal.name)
      setTargetDistance(goal.target_distance_km.toString().replace(".", ","))
      if (goal.target_time_seconds) {
        const h = Math.floor(goal.target_time_seconds / 3600)
        const m = Math.floor((goal.target_time_seconds % 3600) / 60)
        const s = goal.target_time_seconds % 60
        setTargetTimeH(h > 0 ? h.toString() : "")
        setTargetTimeM(m > 0 ? m.toString() : "")
        setTargetTimeS(s > 0 ? s.toString() : "")
      } else {
        setTargetTimeH("")
        setTargetTimeM("")
        setTargetTimeS("")
      }
      setStartDate(goal.start_date ? goal.start_date.split("T")[0] : "")
      setTargetDate(goal.target_date.split("T")[0])
      setShowConfirmDelete(false)
    } else if (open && isNew) {
      setName("")
      setTargetDistance("")
      setTargetTimeH("")
      setTargetTimeM("")
      setTargetTimeS("")
      setStartDate("")
      setTargetDate("")
      setShowConfirmDelete(false)
    }
  }, [open, goal, isNew])

  /** Parse distance string accepting both , and . as decimal separator */
  const parseDistance = (value: string): number => {
    return parseFloat(value.replace(",", "."))
  }

  const canSave = name.trim().length > 0 && parseDistance(targetDistance) > 0 && targetDate.length > 0

  const handleSave = () => {
    if (!canSave) return

    const h = parseInt(targetTimeH) || 0
    const m = parseInt(targetTimeM) || 0
    const s = parseInt(targetTimeS) || 0
    const totalSeconds = h * 3600 + m * 60 + s

    const saved: Goal = {
      id: isNew ? `goal-${Date.now()}` : goal!.id,
      name: name.trim(),
      target_distance_km: parseDistance(targetDistance),
      start_date: startDate ? startDate + "T00:00:00Z" : null,
      target_time_seconds: totalSeconds > 0 ? totalSeconds : null,
      target_date: targetDate + "T00:00:00Z",
      current_distance_km: isNew ? 0 : goal!.current_distance_km,
      is_active: isNew ? false : goal!.is_active,
      created_at: isNew ? new Date().toISOString() : goal!.created_at,
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
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-foreground/30 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
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
              {isNew ? "New Goal" : "Edit Goal"}
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

          {/* Form — scrollable so all fields are reachable on small screens */}
          <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-5 px-5 pb-4">
            {/* Name */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Goal name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Marathon - October"
                className="h-12 rounded-xl border-0 bg-secondary px-4 text-base text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>

            {/* Target distance */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Target distance (km)
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={targetDistance}
                onChange={(e) => setTargetDistance(e.target.value)}
                placeholder="42,195"
                className="h-12 rounded-xl border-0 bg-secondary px-4 text-base text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>

            {/* Target time */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Target time (optional)
              </label>
              <div className="flex items-center gap-2">
                <div className="flex flex-1 items-center gap-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={targetTimeH}
                    onChange={(e) => setTargetTimeH(e.target.value.replace(/\D/g, "").slice(0, 2))}
                    placeholder="0"
                    className="h-12 w-full rounded-xl border-0 bg-secondary px-3 text-center text-base text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <span className="text-xs text-muted-foreground shrink-0">h</span>
                </div>
                <div className="flex flex-1 items-center gap-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={targetTimeM}
                    onChange={(e) => setTargetTimeM(e.target.value.replace(/\D/g, "").slice(0, 2))}
                    placeholder="00"
                    className="h-12 w-full rounded-xl border-0 bg-secondary px-3 text-center text-base text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <span className="text-xs text-muted-foreground shrink-0">m</span>
                </div>
                <div className="flex flex-1 items-center gap-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={targetTimeS}
                    onChange={(e) => setTargetTimeS(e.target.value.replace(/\D/g, "").slice(0, 2))}
                    placeholder="00"
                    className="h-12 w-full rounded-xl border-0 bg-secondary px-3 text-center text-base text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <span className="text-xs text-muted-foreground shrink-0">s</span>
                </div>
              </div>
              <span className="text-xs text-muted-foreground">
                e.g. 3h 30m 00s for a marathon target
              </span>
            </div>

            {/* Start date */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Training start date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-12 rounded-xl border-0 bg-secondary px-4 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <span className="text-xs text-muted-foreground">
                Distance from this date counts towards your goal
              </span>
            </div>

            {/* Target date */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Target date
              </label>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="h-12 rounded-xl border-0 bg-secondary px-4 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
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

          {/* Safe area spacer */}
          <div className="h-8 shrink-0" />
        </div>
      </div>
    </>
  )
}
