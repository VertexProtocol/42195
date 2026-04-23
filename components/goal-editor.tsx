"use client"

import { useState, useEffect } from "react"
import { X, Trash2, Timer, CalendarCheck } from "lucide-react"
import type { Goal, GoalCategory } from "@/lib/types"
import { useI18n } from "@/lib/i18n"

interface GoalEditorProps {
  goal: Goal | null
  isNew: boolean
  /** Pre-select category when opening from a specific context (e.g. Plan tab) */
  defaultCategory?: GoalCategory
  open: boolean
  onSave: (goal: Goal) => void
  onDelete?: (goalId: string) => void
  onClose: () => void
}

export function GoalEditor({ goal, isNew, defaultCategory, open, onSave, onDelete, onClose }: GoalEditorProps) {
  const { t } = useI18n()
  const [category, setCategory] = useState<GoalCategory>("performance")
  const [name, setName] = useState("")
  const [targetDistance, setTargetDistance] = useState("")
  const [targetTimeH, setTargetTimeH] = useState("")
  const [targetTimeM, setTargetTimeM] = useState("")
  const [targetTimeS, setTargetTimeS] = useState("")
  const [startDate, setStartDate] = useState("")
  const [targetDate, setTargetDate] = useState("")
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [touched, setTouched] = useState({ name: false, distance: false, date: false })

  useEffect(() => {
    if (open && goal && !isNew) {
      setCategory(goal.goal_category)
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
      setTouched({ name: false, distance: false, date: false })
    } else if (open && isNew) {
      setCategory(defaultCategory ?? "performance")
      setName("")
      setTargetDistance("")
      setTargetTimeH("")
      setTargetTimeM("")
      setTargetTimeS("")
      setStartDate("")
      setTargetDate("")
      setShowConfirmDelete(false)
      setTouched({ name: false, distance: false, date: false })
    }
  }, [open, goal, isNew, defaultCategory])

  /** Parse distance string accepting both , and . as decimal separator */
  const parseDistance = (value: string): number => {
    return parseFloat(value.replace(",", "."))
  }

  /** Clamp a time component string to [0, max], returns empty string for empty input */
  const clampTime = (raw: string, max: number): string => {
    const digits = raw.replace(/\D/g, "")
    if (digits === "") return ""
    return String(Math.min(max, Math.max(0, parseInt(digits, 10))))
  }

  // Validation
  const errors = {
    name: touched.name && name.trim().length === 0,
    distance: touched.distance && (targetDistance === "" || parseDistance(targetDistance) <= 0 || isNaN(parseDistance(targetDistance))),
    date: touched.date && targetDate.length === 0,
  }
  const canSave = name.trim().length > 0 && parseDistance(targetDistance) > 0 && targetDate.length > 0

  const handleSave = () => {
    if (!canSave) return

    const h = parseInt(targetTimeH) || 0
    const m = parseInt(targetTimeM) || 0
    const s = parseInt(targetTimeS) || 0
    const totalSeconds = h * 3600 + m * 60 + s

    const saved: Goal = {
      id: isNew ? crypto.randomUUID() : goal!.id,
      goal_category: category,
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
        className="fixed inset-0 z-[60] bg-foreground/30 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        className="fixed inset-x-0 bottom-0 z-[70] mx-auto max-w-md animate-in slide-in-from-bottom duration-300"
        role="dialog"
        aria-modal="true"
        aria-labelledby="goal-editor-title"
      >
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
            <h2 id="goal-editor-title" className="text-base font-semibold text-card-foreground">
              {isNew ? t("goalEditor.newGoal") : t("goalEditor.editGoal")}
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
              {t("goalEditor.save")}
            </button>
          </div>

          {/* Form - scrollable */}
          <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-5 px-5 pb-4">

            {/* Goal category */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("goalEditor.goalType")}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setCategory("performance")}
                  className={`flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                    category === "performance"
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground active:bg-accent"
                  }`}
                >
                  <Timer size={16} />
                  {t("goalEditor.performance")}
                </button>
                <button
                  onClick={() => setCategory("event_training")}
                  className={`flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                    category === "event_training"
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground active:bg-accent"
                  }`}
                >
                  <CalendarCheck size={16} />
                  {t("goalEditor.eventTraining")}
                </button>
              </div>
              <span className="text-xs text-muted-foreground">
                {category === "performance"
                  ? t("goalEditor.perfDesc")
                  : t("goalEditor.eventDesc")}
              </span>
            </div>

            {/* Name */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {category === "event_training" ? t("goalEditor.eventName") : t("goalEditor.goalName")}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                placeholder={
                  category === "event_training"
                    ? t("goalEditor.eventPlaceholder")
                    : t("goalEditor.goalPlaceholder")
                }
                className={`h-12 rounded-xl border-0 bg-secondary px-4 text-base text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 ${
                  errors.name ? "ring-2 ring-destructive" : "focus:ring-primary/40"
                }`}
              />
              {errors.name && (
                <span className="text-xs text-destructive">{t("validation.required")}</span>
              )}
            </div>

            {/* Target distance */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {category === "event_training" ? t("goalEditor.raceDistance") : t("goalEditor.targetDistance")}
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={targetDistance}
                onChange={(e) => setTargetDistance(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, distance: true }))}
                placeholder="42,195"
                className={`h-12 rounded-xl border-0 bg-secondary px-4 text-base text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 ${
                  errors.distance ? "ring-2 ring-destructive" : "focus:ring-primary/40"
                }`}
              />
              {errors.distance && (
                <span className="text-xs text-destructive">{t("validation.validDistance")}</span>
              )}
            </div>

            {/* Target time */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {category === "performance" ? t("goalEditor.targetTimeRequired") : t("goalEditor.targetTimeOptional")}
              </label>
              <div className="flex items-center gap-2">
                <div className="flex flex-1 items-center gap-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={targetTimeH}
                    onChange={(e) => setTargetTimeH(clampTime(e.target.value, 99))}
                    placeholder="0"
                    className="h-12 w-full rounded-xl border-0 bg-secondary px-3 text-center text-base text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <span className="text-xs text-muted-foreground shrink-0">{t("common.h")}</span>
                </div>
                <div className="flex flex-1 items-center gap-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={targetTimeM}
                    maxLength={2}
                    onChange={(e) => setTargetTimeM(clampTime(e.target.value, 59))}
                    placeholder="00"
                    className="h-12 w-full rounded-xl border-0 bg-secondary px-3 text-center text-base text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <span className="text-xs text-muted-foreground shrink-0">{t("common.m")}</span>
                </div>
                <div className="flex flex-1 items-center gap-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={targetTimeS}
                    maxLength={2}
                    onChange={(e) => setTargetTimeS(clampTime(e.target.value, 59))}
                    placeholder="00"
                    className="h-12 w-full rounded-xl border-0 bg-secondary px-3 text-center text-base text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <span className="text-xs text-muted-foreground shrink-0">{t("common.s")}</span>
                </div>
              </div>
              <span className="text-xs text-muted-foreground">
                {category === "performance"
                  ? t("goalEditor.targetTimeHintPerf")
                  : t("goalEditor.targetTimeHintEvent")}
              </span>
            </div>

            {/* Training start date */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {category === "event_training" ? t("goalEditor.trainingStartDate") : t("goalEditor.startCountingFrom")}
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-12 rounded-xl border-0 bg-secondary px-4 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <span className="text-xs text-muted-foreground">
                {category === "event_training"
                  ? t("goalEditor.startDateHintEvent")
                  : t("goalEditor.startDateHintPerf")}
              </span>
            </div>

            {/* Target / event date */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {category === "event_training" ? t("goalEditor.raceDate") : t("goalEditor.targetDate")}
              </label>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, date: true }))}
                className={`h-12 rounded-xl border-0 bg-secondary px-4 text-base text-foreground focus:outline-none focus:ring-2 ${
                  errors.date ? "ring-2 ring-destructive" : "focus:ring-primary/40"
                }`}
              />
              {errors.date && (
                <span className="text-xs text-destructive">{t("validation.required")}</span>
              )}
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
                {showConfirmDelete ? t("goalEditor.tapToConfirm") : t("goalEditor.deleteGoal")}
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
