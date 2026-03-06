"use client"

import { useState } from "react"
import { X } from "lucide-react"
import type { Activity, ActivityType } from "@/lib/types"

interface ManualActivityFormProps {
  open: boolean
  onClose: () => void
  onSave: (activity: Omit<Activity, "id" | "user_id" | "strava_id" | "created_at">) => Promise<boolean>
}

const ACTIVITY_TYPES: { value: ActivityType; label: string }[] = [
  { value: "Run", label: "Run" },
  { value: "Trail Run", label: "Trail Run" },
  { value: "Race", label: "Race" },
  { value: "Walk", label: "Walk" },
]

export function ManualActivityForm({ open, onClose, onSave }: ManualActivityFormProps) {
  const [name, setName] = useState("")
  const [type, setType] = useState<ActivityType>("Run")
  const [date, setDate] = useState(new Date().toISOString().split("T")[0])
  const [distanceKm, setDistanceKm] = useState("")
  const [durationMin, setDurationMin] = useState("")
  const [durationSec, setDurationSec] = useState("")
  const [elevationM, setElevationM] = useState("")
  const [avgHr, setAvgHr] = useState("")
  const [saving, setSaving] = useState(false)

  if (!open) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !distanceKm || !durationMin) return

    const distKm = parseFloat(distanceKm)
    const durSeconds = (parseInt(durationMin) || 0) * 60 + (parseInt(durationSec) || 0)
    const paceMinPerKm = durSeconds > 0 && distKm > 0 ? durSeconds / 60 / distKm : null
    const elevation = elevationM ? parseInt(elevationM) : null
    const hr = avgHr ? parseInt(avgHr) : null

    setSaving(true)
    const ok = await onSave({
      type,
      name: name.trim(),
      date: new Date(date + "T12:00:00").toISOString(),
      distance_km: distKm,
      duration_seconds: durSeconds,
      pace_min_per_km: paceMinPerKm,
      elevation_gain_m: elevation,
      avg_heart_rate: hr,
      calories: null,
      map_polyline: null,
    })
    setSaving(false)

    if (ok) {
      // Reset form
      setName("")
      setDistanceKm("")
      setDurationMin("")
      setDurationSec("")
      setElevationM("")
      setAvgHr("")
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50">
      <div className="w-full max-w-md animate-in slide-in-from-bottom rounded-t-3xl bg-card p-5 pb-8 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-card-foreground">Add Activity</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-muted-foreground active:bg-accent"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Activity type */}
          <div className="flex gap-2">
            {ACTIVITY_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setType(t.value)}
                className={`flex-1 rounded-xl py-2 text-xs font-semibold transition-colors ${
                  type === t.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground active:bg-accent"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Name */}
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Activity name"
            required
            className="w-full rounded-xl bg-secondary px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />

          {/* Date */}
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-xl bg-secondary px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />

          {/* Distance */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Distance (km)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={distanceKm}
              onChange={(e) => setDistanceKm(e.target.value)}
              placeholder="0.00"
              required
              className="w-full rounded-xl bg-secondary px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Duration */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Duration</label>
            <div className="flex gap-2">
              <div className="flex-1">
                <input
                  type="number"
                  min="0"
                  value={durationMin}
                  onChange={(e) => setDurationMin(e.target.value)}
                  placeholder="min"
                  required
                  className="w-full rounded-xl bg-secondary px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div className="flex-1">
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={durationSec}
                  onChange={(e) => setDurationSec(e.target.value)}
                  placeholder="sec"
                  className="w-full rounded-xl bg-secondary px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
          </div>

          {/* Optional fields */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Elevation (m)</label>
              <input
                type="number"
                min="0"
                value={elevationM}
                onChange={(e) => setElevationM(e.target.value)}
                placeholder="optional"
                className="w-full rounded-xl bg-secondary px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Avg HR (bpm)</label>
              <input
                type="number"
                min="0"
                value={avgHr}
                onChange={(e) => setAvgHr(e.target.value)}
                placeholder="optional"
                className="w-full rounded-xl bg-secondary px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={saving || !name.trim() || !distanceKm || !durationMin}
            className="flex min-h-[44px] items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity active:opacity-80 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Activity"}
          </button>
        </form>
      </div>
    </div>
  )
}
