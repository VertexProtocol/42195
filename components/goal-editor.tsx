"use client"

import { useState, useEffect } from "react"
import { Trash2, Timer, CalendarCheck } from "lucide-react"
import type { Goal, GoalCategory } from "@/lib/types"
import { useI18n } from "@/lib/i18n"
import { BottomSheet } from "@/components/ui/bottom-sheet"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

interface GoalEditorProps {
  goal: Goal | null
  isNew: boolean
  /** Pre-select category when opening from a specific context (e.g. Plan tab) */
  defaultCategory?: GoalCategory
  /**
   * Fields a new goal already knows.
   *
   * Opening this from an invite means the race, the date and the distance are
   * settled — the group holds them. Only the target time is the runner's to
   * decide, and it is the one thing a group never owns, so it is the one field
   * left blank.
   */
  prefill?: {
    name?: string
    target_date?: string
    target_distance_km?: number
  }
  open: boolean
  onSave: (goal: Goal) => void
  onDelete?: (goalId: string) => void
  onClose: () => void
}

export function GoalEditor({ goal, isNew, defaultCategory, prefill, open, onSave, onDelete, onClose }: GoalEditorProps) {
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
      setName(prefill?.name ?? "")
      setTargetDistance(
        prefill?.target_distance_km != null
          ? String(prefill.target_distance_km).replace(".", ",")
          : "",
      )
      setTargetTimeH("")
      setTargetTimeM("")
      setTargetTimeS("")
      setStartDate("")
      setTargetDate(prefill?.target_date ? prefill.target_date.split("T")[0] : "")
      setShowConfirmDelete(false)
      setTouched({ name: false, distance: false, date: false })
    }
  }, [open, goal, isNew, defaultCategory, prefill])

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
      // A new goal starts active. It used to start inactive, which reads as a
      // harmless default until you see what the flag gates: the coach's
      // get_goals tool filters on it, so a runner could create a goal, ask the
      // coach about it, and be told "No active goals found". Activity analysis
      // skips inactive goals too, and the Strava sync never recalculates their
      // logged distance. Nothing in the UI hinted that a goal was dormant.
      //
      // Turning it off stays available on the goal card, for narrowing what the
      // coach looks at when there are several goals in flight.
      is_active: isNew ? true : goal!.is_active,
      created_at: isNew ? new Date().toISOString() : goal!.created_at,
      // The editor does not own ordering or the Today pin, but it replaces the
      // goal object in local state — carrying them through stops an edit from
      // silently unpinning a goal or sending it to the bottom of the list.
      display_order: isNew ? undefined : goal!.display_order,
      is_starred: isNew ? false : goal!.is_starred,
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

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={isNew ? t("goalEditor.newGoal") : t("goalEditor.editGoal")}
      closeLabel={t("common.cancel")}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          handleSave()
        }}
        className="flex flex-col gap-5"
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-label font-medium text-foreground">
            {t("goalEditor.goalType")}
          </legend>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setCategory("performance")}
              aria-pressed={category === "performance"}
              className={`press flex min-h-[52px] items-center justify-center gap-2 rounded-md text-label font-semibold ${
                category === "performance"
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-sunken text-secondary-foreground hover:bg-accent"
              }`}
            >
              <Timer size={16} aria-hidden />
              {t("goalEditor.performance")}
            </button>
            <button
              type="button"
              onClick={() => setCategory("event_training")}
              aria-pressed={category === "event_training"}
              className={`press flex min-h-[52px] items-center justify-center gap-2 rounded-md text-label font-semibold ${
                category === "event_training"
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-sunken text-secondary-foreground hover:bg-accent"
              }`}
            >
              <CalendarCheck size={16} aria-hidden />
              {t("goalEditor.eventTraining")}
            </button>
          </div>
          <p className="text-micro leading-relaxed text-muted-foreground">
            {category === "performance" ? t("goalEditor.perfDesc") : t("goalEditor.eventDesc")}
          </p>
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="goal-name" className="text-label font-medium text-foreground">
            {category === "event_training" ? t("goalEditor.eventName") : t("goalEditor.goalName")}
          </label>
          <Input
            id="goal-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, name: true }))}
            aria-invalid={errors.name || undefined}
            aria-describedby={errors.name ? "goal-name-error" : undefined}
            placeholder={
              category === "event_training"
                ? t("goalEditor.eventPlaceholder")
                : t("goalEditor.goalPlaceholder")
            }
          />
          {errors.name && (
            <p id="goal-name-error" className="text-micro text-destructive">
              {t("validation.required")}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="goal-distance" className="text-label font-medium text-foreground">
            {category === "event_training"
              ? t("goalEditor.raceDistance")
              : t("goalEditor.targetDistance")}
          </label>
          <Input
            id="goal-distance"
            type="text"
            inputMode="decimal"
            value={targetDistance}
            onChange={(e) => setTargetDistance(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, distance: true }))}
            aria-invalid={errors.distance || undefined}
            aria-describedby={errors.distance ? "goal-distance-error" : undefined}
            placeholder="42,195"
          />
          {errors.distance && (
            <p id="goal-distance-error" className="text-micro text-destructive">
              {t("validation.validDistance")}
            </p>
          )}
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-label font-medium text-foreground">
            {category === "performance"
              ? t("goalEditor.targetTimeRequired")
              : t("goalEditor.targetTimeOptional")}
          </legend>
          <div className="flex items-center gap-2">
            {(
              [
                [targetTimeH, (v: string) => setTargetTimeH(clampTime(v, 99)), t("common.h"), "0", 2],
                [targetTimeM, (v: string) => setTargetTimeM(clampTime(v, 59)), t("common.m"), "00", 2],
                [targetTimeS, (v: string) => setTargetTimeS(clampTime(v, 59)), t("common.s"), "00", 2],
              ] as const
            ).map(([value, set, unit, placeholder, maxLength]) => (
              <div key={unit} className="flex flex-1 items-center gap-1.5">
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={maxLength}
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  aria-label={unit}
                  placeholder={placeholder}
                  className="measure text-center"
                />
                <span className="shrink-0 text-micro text-muted-foreground">{unit}</span>
              </div>
            ))}
          </div>
          <p className="text-micro leading-relaxed text-muted-foreground">
            {category === "performance"
              ? t("goalEditor.targetTimeHintPerf")
              : t("goalEditor.targetTimeHintEvent")}
          </p>
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="goal-start" className="text-label font-medium text-foreground">
            {category === "event_training"
              ? t("goalEditor.trainingStartDate")
              : t("goalEditor.startCountingFrom")}
          </label>
          <Input
            id="goal-start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <p className="text-micro leading-relaxed text-muted-foreground">
            {category === "event_training"
              ? t("goalEditor.startDateHintEvent")
              : t("goalEditor.startDateHintPerf")}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="goal-target-date" className="text-label font-medium text-foreground">
            {category === "event_training" ? t("goalEditor.raceDate") : t("goalEditor.targetDate")}
          </label>
          <Input
            id="goal-target-date"
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, date: true }))}
            aria-invalid={errors.date || undefined}
            aria-describedby={errors.date ? "goal-date-error" : undefined}
          />
          {errors.date && (
            <p id="goal-date-error" className="text-micro text-destructive">
              {t("validation.required")}
            </p>
          )}
        </div>

        <Button type="submit" block disabled={!canSave}>
          {t("goalEditor.save")}
        </Button>

        {!isNew && (
          <div className="border-t border-border pt-4">
            <Button
              type="button"
              variant={showConfirmDelete ? "danger" : "ghost"}
              block
              onClick={handleDelete}
              className={showConfirmDelete ? "" : "text-destructive"}
            >
              <Trash2 size={16} />
              {showConfirmDelete ? t("goalEditor.tapToConfirm") : t("goalEditor.deleteGoal")}
            </Button>
          </div>
        )}
      </form>
    </BottomSheet>
  )
}
