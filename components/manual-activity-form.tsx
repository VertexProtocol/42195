"use client"

import { useState } from "react"
import type { Activity } from "@/lib/types"
import { useI18n } from "@/lib/i18n"
import { BottomSheet } from "@/components/ui/bottom-sheet"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/auth-shell"

interface ManualActivityFormProps {
  open: boolean
  onClose: () => void
  onSave: (
    activity: Omit<Activity, "id" | "user_id" | "strava_id" | "created_at">,
  ) => Promise<boolean>
}

const QUICK_TYPES = [
  { value: "Run", labelKey: "manualActivity.run" },
  { value: "Trail Run", labelKey: "manualActivity.trailRun" },
  { value: "Race", labelKey: "manualActivity.race" },
  { value: "Walk", labelKey: "manualActivity.walk" },
] as const

const OTHER_TYPES = [
  "Ride", "Swim", "Hike", "Nordic Ski", "Alpine Ski", "Snowboard",
  "Yoga", "Weight Training", "HIIT", "CrossFit", "Rowing",
  "Kayaking", "Elliptical", "Pilates", "Soccer", "Tennis",
  "Golf", "Skateboard", "Surfing", "Rock Climbing",
]

function TypeChip({
  active,
  onClick,
  children,
  className = "",
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`press h-9 rounded-full px-3.5 text-micro font-semibold ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-surface-sunken text-secondary-foreground hover:bg-accent"
      } ${className}`}
    >
      {children}
    </button>
  )
}

export function ManualActivityForm({ open, onClose, onSave }: ManualActivityFormProps) {
  const { t } = useI18n()
  const [name, setName] = useState("")
  const [type, setType] = useState("Run")
  const [showOtherTypes, setShowOtherTypes] = useState(false)
  const [date, setDate] = useState(new Date().toISOString().split("T")[0])
  const [distanceKm, setDistanceKm] = useState("")
  const [durationMin, setDurationMin] = useState("")
  const [durationSec, setDurationSec] = useState("")
  const [elevationM, setElevationM] = useState("")
  const [avgHr, setAvgHr] = useState("")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const isQuickType = QUICK_TYPES.some((qt) => qt.value === type)
  const canSave = Boolean(name.trim() && distanceKm && durationMin)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSave) return

    const distKm = parseFloat(distanceKm)
    const durSeconds = (parseInt(durationMin) || 0) * 60 + (parseInt(durationSec) || 0)
    const paceMinPerKm = durSeconds > 0 && distKm > 0 ? durSeconds / 60 / distKm : null

    setSaving(true)
    setSaveError(null)
    const ok = await onSave({
      type,
      name: name.trim(),
      date: new Date(date + "T12:00:00").toISOString(),
      distance_km: distKm,
      duration_seconds: durSeconds,
      pace_min_per_km: paceMinPerKm,
      elevation_gain_m: elevationM ? parseInt(elevationM) : null,
      avg_heart_rate: avgHr ? parseInt(avgHr) : null,
      avg_cadence: null,
      calories: null,
      map_polyline: null,
    })
    setSaving(false)

    if (!ok) {
      // The save failed and the form is the only place the runner can see
      // that; silently closing would look like it worked.
      setSaveError(t("manualActivity.saveFailed"))
      return
    }

    setName("")
    setDistanceKm("")
    setDurationMin("")
    setDurationSec("")
    setElevationM("")
    setAvgHr("")
    setShowOtherTypes(false)
    onClose()
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t("manualActivity.addActivity")}
      closeLabel={t("common.cancel")}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {saveError && (
          <p
            role="alert"
            className="rounded-md bg-destructive/12 px-3 py-2.5 text-label text-destructive"
          >
            {saveError}
          </p>
        )}

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-label font-medium text-foreground">
            {t("manualActivity.activityType")}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_TYPES.map((at) => (
              <TypeChip
                key={at.value}
                active={type === at.value}
                onClick={() => {
                  setType(at.value)
                  setShowOtherTypes(false)
                }}
              >
                {t(at.labelKey)}
              </TypeChip>
            ))}
            <TypeChip active={!isQuickType} onClick={() => setShowOtherTypes(!showOtherTypes)}>
              {isQuickType ? t("manualActivity.other") : type}
            </TypeChip>
          </div>

          {showOtherTypes && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {OTHER_TYPES.map((ot) => (
                <TypeChip
                  key={ot}
                  active={type === ot}
                  onClick={() => {
                    setType(ot)
                    setShowOtherTypes(false)
                  }}
                >
                  {ot}
                </TypeChip>
              ))}
            </div>
          )}
        </fieldset>

        <Field id="activity-name" label={t("manualActivity.activityName")}>
          <Input
            id="activity-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("manualActivity.namePlaceholder")}
            required
          />
        </Field>

        <Field id="activity-date" label={t("manualActivity.date")}>
          <Input
            id="activity-date"
            type="date"
            value={date}
            max={new Date().toISOString().split("T")[0]}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>

        <Field id="activity-distance" label={t("manualActivity.distance")}>
          <Input
            id="activity-distance"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={distanceKm}
            onChange={(e) => setDistanceKm(e.target.value)}
            placeholder="0.00"
            required
          />
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-label font-medium text-foreground">
            {t("manualActivity.duration")}
          </legend>
          <div className="flex gap-2">
            <Input
              type="number"
              inputMode="numeric"
              min="0"
              value={durationMin}
              onChange={(e) => setDurationMin(e.target.value)}
              placeholder={t("common.min")}
              aria-label={t("common.min")}
              required
            />
            <Input
              type="number"
              inputMode="numeric"
              min="0"
              max="59"
              value={durationSec}
              onChange={(e) => setDurationSec(e.target.value)}
              placeholder={t("common.s")}
              aria-label={t("common.s")}
            />
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-2">
          <Field id="activity-elevation" label={t("manualActivity.elevation")}>
            <Input
              id="activity-elevation"
              type="number"
              inputMode="numeric"
              min="0"
              value={elevationM}
              onChange={(e) => setElevationM(e.target.value)}
              placeholder={t("manualActivity.optional")}
            />
          </Field>
          <Field id="activity-hr" label={t("manualActivity.avgHr")}>
            <Input
              id="activity-hr"
              type="number"
              inputMode="numeric"
              min="0"
              value={avgHr}
              onChange={(e) => setAvgHr(e.target.value)}
              placeholder={t("manualActivity.optional")}
            />
          </Field>
        </div>

        <Button type="submit" block className="mt-1" loading={saving} disabled={!canSave}>
          {saving ? t("manualActivity.saving") : t("manualActivity.save")}
        </Button>
      </form>
    </BottomSheet>
  )
}
