"use client"

import { useState, useEffect } from "react"
import { Trash2, Repeat, Calendar } from "lucide-react"
import type { WeeklyGoal, WeeklyGoalMetric } from "@/lib/types"
import { useI18n } from "@/lib/i18n"
import { weekStartStr } from "@/lib/week"
import type { WeeklySuggestion } from "@/lib/weekly-suggestions"
import { BottomSheet } from "@/components/ui/bottom-sheet"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

/**
 * `label` is the canonical English name stored on the row, not something the
 * runner reads — every screen renders `WEEKLY_METRIC_LABEL_KEYS` instead. It
 * used to be recovered by translating `labelKey` and comparing the result
 * against those same translations to work out which metric it was, a
 * round-trip that only held while no two metric labels ever translated alike.
 */
const METRIC_OPTIONS: { value: WeeklyGoalMetric; labelKey: "weeklyGoalEditor.distance" | "weeklyGoalEditor.sessions" | "weeklyGoalEditor.duration" | "weeklyGoalEditor.elevation"; label: string; placeholder: string; unit: string }[] = [
  { value: "distance_km", labelKey: "weeklyGoalEditor.distance", label: "Weekly Distance", placeholder: "40", unit: "km" },
  { value: "sessions", labelKey: "weeklyGoalEditor.sessions", label: "Training Sessions", placeholder: "5", unit: "runs" },
  { value: "duration_minutes", labelKey: "weeklyGoalEditor.duration", label: "Active Minutes", placeholder: "300", unit: "min" },
  { value: "elevation_m", labelKey: "weeklyGoalEditor.elevation", label: "Elevation Gain", placeholder: "500", unit: "m" },
]

interface WeeklyGoalEditorProps {
  goal: WeeklyGoal | null
  isNew: boolean
  open: boolean
  /**
   * The suggestion this editor was opened from, if any. It seeds the metric
   * and the number, and says where they came from — a prefilled figure with
   * no provenance is just a different guess.
   */
  suggestion?: WeeklySuggestion | null
  onSave: (goal: WeeklyGoal) => void
  onDelete?: (goalId: string) => void
  onClose: () => void
}

export function WeeklyGoalEditor({ goal, isNew, open, suggestion, onSave, onDelete, onClose }: WeeklyGoalEditorProps) {
  const [metric, setMetric] = useState<WeeklyGoalMetric>("distance_km")
  const [target, setTarget] = useState("")
  const [isRecurring, setIsRecurring] = useState(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [sessionMinDuration, setSessionMinDuration] = useState("")
  const [sessionMinDistance, setSessionMinDistance] = useState("")
  const { t } = useI18n()

  useEffect(() => {
    if (open && goal && !isNew) {
      setMetric(goal.metric)
      setTarget(goal.target.toString())
      setIsRecurring(goal.is_recurring)
      setShowConfirmDelete(false)
      setSessionMinDuration(goal.session_min_duration_minutes?.toString() ?? "")
      setSessionMinDistance(goal.session_min_distance_km?.toString() ?? "")
    } else if (open && isNew) {
      setMetric(suggestion?.metric ?? "distance_km")
      setTarget(suggestion ? String(suggestion.target) : "")
      // A suggestion is derived for one week from that week's plan and load;
      // next week's number is a different number. Making it recurring would
      // freeze one week's answer and keep showing it as though it were still
      // being worked out.
      setIsRecurring(false)
      setShowConfirmDelete(false)
      setSessionMinDuration("")
      setSessionMinDistance("")
    }
  }, [open, goal, isNew, suggestion])

  const selectedOption = METRIC_OPTIONS.find((o) => o.value === metric)!
  const canSave = parseFloat(target) > 0

  const handleSave = () => {
    if (!canSave) return

    const mondayStr = weekStartStr()

    const saved: WeeklyGoal = {
      id: isNew ? crypto.randomUUID() : goal!.id,
      metric,
      label: selectedOption.label,
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
      // Ordering belongs to the Plan screen, not this editor; carrying it
      // through stops an edit from jumping the goal to the top of the list.
      display_order: isNew ? undefined : goal!.display_order,
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
      title={isNew ? t("weeklyGoalEditor.newGoal") : t("weeklyGoalEditor.editGoal")}
      closeLabel={t("common.cancel")}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          handleSave()
        }}
        className="flex flex-col gap-5"
      >
        {isNew && suggestion && (
          <p className="measure text-micro leading-relaxed text-muted-foreground">
            {t(suggestion.reasonKey, suggestion.reasonValues)}
          </p>
        )}

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-label font-medium text-foreground">
            {t("weeklyGoalEditor.frequency")}
          </legend>
          <div className="flex rounded-md bg-surface-sunken p-1">
            {(
              [
                [false, Calendar, t("weeklyGoalEditor.thisWeekOnly")],
                [true, Repeat, t("weeklyGoalEditor.everyWeek")],
              ] as const
            ).map(([value, Icon, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => setIsRecurring(value)}
                aria-pressed={isRecurring === value}
                className={`press flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-sm text-label font-semibold ${
                  isRecurring === value
                    ? "bg-card text-foreground shadow-e1"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon size={14} aria-hidden />
                {label}
              </button>
            ))}
          </div>
          <p className="text-micro leading-relaxed text-muted-foreground">
            {isRecurring
              ? t("weeklyGoalEditor.recurringHint")
              : t("weeklyGoalEditor.oneOffHint")}
          </p>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-label font-medium text-foreground">
            {t("weeklyGoalEditor.metric")}
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {/* No metric icon here, deliberately. This is a setting being
                chosen, not a goal being read — the icon earns its place where
                the goal is looked at, which is Today. */}
            {METRIC_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setMetric(option.value)}
                aria-pressed={metric === option.value}
                className={`press flex min-h-[44px] items-center justify-center rounded-md px-3 text-label font-semibold ${
                  metric === option.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface-sunken text-secondary-foreground hover:bg-accent"
                }`}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="weekly-target" className="text-label font-medium text-foreground">
            {`${t("weeklyGoalEditor.weeklyTarget")} (${selectedOption.unit})`}
          </label>
          <Input
            id="weekly-target"
            type="number"
            inputMode="decimal"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={selectedOption.placeholder}
            step={metric === "sessions" ? "1" : "0.1"}
            min="0"
          />
        </div>

        {metric === "sessions" && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-label font-medium text-foreground">
              {t("weeklyGoalEditor.perSessionReq")}
            </legend>
            <p className="text-micro leading-relaxed text-muted-foreground">
              {t("weeklyGoalEditor.perSessionHint")}
            </p>
            <div className="mt-1 flex flex-col gap-2.5">
              <div className="flex items-center gap-3">
                <label
                  htmlFor="session-min-duration"
                  className="w-28 shrink-0 text-label text-foreground"
                >
                  {t("weeklyGoalEditor.minDuration")}
                </label>
                <Input
                  id="session-min-duration"
                  type="number"
                  inputMode="numeric"
                  value={sessionMinDuration}
                  onChange={(e) => setSessionMinDuration(e.target.value)}
                  placeholder="30"
                  min="0"
                  step="1"
                />
                <span className="shrink-0 text-label text-muted-foreground">
                  {t("common.min")}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <label
                  htmlFor="session-min-distance"
                  className="w-28 shrink-0 text-label text-foreground"
                >
                  {t("weeklyGoalEditor.minDistance")}
                </label>
                <Input
                  id="session-min-distance"
                  type="number"
                  inputMode="decimal"
                  value={sessionMinDistance}
                  onChange={(e) => setSessionMinDistance(e.target.value)}
                  placeholder="10"
                  min="0"
                  step="0.1"
                />
                <span className="shrink-0 text-label text-muted-foreground">
                  {t("common.km")}
                </span>
              </div>
            </div>
          </fieldset>
        )}

        <Button type="submit" block disabled={!canSave}>
          {t("weeklyGoalEditor.save")}
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
              {showConfirmDelete
                ? t("weeklyGoalEditor.tapToConfirm")
                : t("weeklyGoalEditor.deleteGoal")}
            </Button>
          </div>
        )}
      </form>
    </BottomSheet>
  )
}
