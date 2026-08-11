"use client"

import { useEffect, useMemo, useState } from "react"
import { Calculator, Gauge, Target } from "lucide-react"
import type { Goal } from "@/lib/types"
import { useI18n } from "@/lib/i18n"
import { AppCard } from "@/components/ui/app-card"
import { formatPace, formatTargetTime } from "@/lib/format"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type Mode = "convert" | "target"

const MANUAL_OPTION = "__manual__"

interface PaceCalculatorCardProps {
  goals: Goal[]
}

const STANDARD_DISTANCES: { key: string; label: string; km: number }[] = [
  { key: "5k", label: "5K", km: 5 },
  { key: "10k", label: "10K", km: 10 },
  { key: "hm", label: "HM", km: 21.0975 },
  { key: "marathon", label: "Maraton", km: 42.195 },
]

const clampInt = (raw: string, max: number): string => {
  const digits = raw.replace(/\D/g, "")
  if (digits === "") return ""
  return String(Math.min(max, Math.max(0, parseInt(digits, 10))))
}

const parseDecimal = (raw: string): number => parseFloat(raw.replace(",", "."))

export function PaceCalculatorCard({ goals }: PaceCalculatorCardProps) {
  const { t } = useI18n()
  const [mode, setMode] = useState<Mode>("convert")

  // ---- Convert tab ----
  const [paceMin, setPaceMin] = useState("5")
  const [paceSec, setPaceSec] = useState("00")
  const [kmh, setKmh] = useState("12.0")
  const [lastConvertEdit, setLastConvertEdit] = useState<"pace" | "kmh">("pace")

  useEffect(() => {
    if (lastConvertEdit !== "pace") return
    const totalMin = (parseInt(paceMin) || 0) + (parseInt(paceSec) || 0) / 60
    if (totalMin > 0) setKmh((60 / totalMin).toFixed(1))
    else setKmh("")
  }, [paceMin, paceSec, lastConvertEdit])

  useEffect(() => {
    if (lastConvertEdit !== "kmh") return
    const v = parseDecimal(kmh)
    if (v > 0) {
      const totalMin = 60 / v
      const m = Math.floor(totalMin)
      const s = Math.round((totalMin - m) * 60)
      // Handle 60-sec rollover
      const finalM = s === 60 ? m + 1 : m
      const finalS = s === 60 ? 0 : s
      setPaceMin(String(finalM))
      setPaceSec(String(finalS).padStart(2, "0"))
    }
  }, [kmh, lastConvertEdit])

  // ---- Target tab ----
  const eligibleGoals = useMemo(
    () =>
      goals.filter(
        (g) =>
          (g.goal_category === "performance" || g.goal_category === "event_training") &&
          g.target_time_seconds !== null &&
          g.target_time_seconds > 0 &&
          g.target_distance_km > 0,
      ),
    [goals],
  )

  const [selectedGoalId, setSelectedGoalId] = useState<string>(MANUAL_OPTION)
  const [distanceKm, setDistanceKm] = useState("42,2")
  const [hours, setHours] = useState("3")
  const [mins, setMins] = useState("45")
  const [secs, setSecs] = useState("00")

  const applyGoal = (goalId: string) => {
    setSelectedGoalId(goalId)
    if (goalId === MANUAL_OPTION) return
    const g = eligibleGoals.find((x) => x.id === goalId)
    if (!g || g.target_time_seconds == null) return
    setDistanceKm(g.target_distance_km.toString().replace(".", ","))
    const h = Math.floor(g.target_time_seconds / 3600)
    const m = Math.floor((g.target_time_seconds % 3600) / 60)
    const s = g.target_time_seconds % 60
    setHours(String(h))
    setMins(String(m))
    setSecs(String(s).padStart(2, "0"))
  }

  // If user edits inputs while a goal is selected, drop back to manual
  const markManual = () => {
    if (selectedGoalId !== MANUAL_OPTION) setSelectedGoalId(MANUAL_OPTION)
  }

  const targetResult = useMemo(() => {
    const dist = parseDecimal(distanceKm)
    const totalSeconds =
      (parseInt(hours) || 0) * 3600 + (parseInt(mins) || 0) * 60 + (parseInt(secs) || 0)
    if (!dist || dist <= 0 || totalSeconds <= 0) return null
    const paceMinPerKm = totalSeconds / 60 / dist
    const speedKmh = (3600 * dist) / totalSeconds
    return { paceMinPerKm, speedKmh, dist, totalSeconds }
  }, [distanceKm, hours, mins, secs])

  const splits = useMemo(() => {
    if (!targetResult) return []
    return STANDARD_DISTANCES.filter((s) => s.km <= targetResult.dist + 0.001).map((s) => ({
      key: s.key,
      label: s.label,
      seconds: Math.round(s.km * targetResult.paceMinPerKm * 60),
    }))
  }, [targetResult])

  return (
    <AppCard className="space-y-4">
      {/* Header + tab switcher */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
            <Calculator size={16} className="text-primary" />
          </div>
          <h3 className="text-label font-semibold text-card-foreground">
            {t("paceCalc.title")}
          </h3>
        </div>
        <div className="flex rounded-full bg-secondary p-0.5">
          <button
            onClick={() => setMode("convert")}
            className={`press inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-micro font-semibold ${
              mode === "convert"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Gauge size={11} />
            {t("paceCalc.tabConvert")}
          </button>
          <button
            onClick={() => setMode("target")}
            className={`press inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-micro font-semibold ${
              mode === "target"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Target size={11} />
            {t("paceCalc.tabTarget")}
          </button>
        </div>
      </div>

      {mode === "convert" ? (
        <div className="space-y-3">
          {/* min/km row */}
          <div className="flex items-center justify-between gap-3">
            <label className="text-label font-medium text-foreground">
              {t("paceCalc.minPerKm")}
            </label>
            <div className="flex items-center gap-1">
              <input
                type="text"
                inputMode="numeric"
                value={paceMin}
                maxLength={2}
                onChange={(e) => {
                  setLastConvertEdit("pace")
                  setPaceMin(clampInt(e.target.value, 30))
                }}
                placeholder="0"
                className="measure h-11 w-14 rounded-md bg-surface-sunken px-2 text-center text-base text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
              <span className="text-label text-muted-foreground">:</span>
              <input
                type="text"
                inputMode="numeric"
                value={paceSec}
                maxLength={2}
                onChange={(e) => {
                  setLastConvertEdit("pace")
                  setPaceSec(clampInt(e.target.value, 59))
                }}
                placeholder="00"
                className="measure h-11 w-14 rounded-md bg-surface-sunken px-2 text-center text-base text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
              <span className="ml-1 text-micro text-muted-foreground">/km</span>
            </div>
          </div>

          {/* km/h row */}
          <div className="flex items-center justify-between gap-3">
            <label className="text-label font-medium text-foreground">
              {t("paceCalc.kmh")}
            </label>
            <div className="flex items-center gap-1">
              <input
                type="text"
                inputMode="decimal"
                value={kmh}
                onChange={(e) => {
                  setLastConvertEdit("kmh")
                  // allow digits, comma, dot
                  setKmh(e.target.value.replace(/[^\d.,]/g, ""))
                }}
                placeholder="0.0"
                className="measure h-11 w-20 rounded-md bg-surface-sunken px-2 text-center text-base text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
              <span className="ml-1 text-micro text-muted-foreground">km/t</span>
            </div>
          </div>

          <p className="text-micro text-muted-foreground">{t("paceCalc.convertHint")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Goal source selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-label font-medium text-foreground">
              {t("paceCalc.source")}
            </label>
            <Select value={selectedGoalId} onValueChange={applyGoal}>
              <SelectTrigger className="h-11 w-full rounded-md border-0 bg-surface-sunken text-label">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={MANUAL_OPTION}>{t("paceCalc.manual")}</SelectItem>
                {eligibleGoals.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name} · {g.target_distance_km}km ·{" "}
                    {formatTargetTime(g.target_time_seconds!)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Distance */}
          <div className="flex items-center justify-between gap-3">
            <label className="text-label font-medium text-foreground">
              {t("paceCalc.distance")}
            </label>
            <div className="flex items-center gap-1">
              <input
                type="text"
                inputMode="decimal"
                value={distanceKm}
                onChange={(e) => {
                  markManual()
                  setDistanceKm(e.target.value.replace(/[^\d.,]/g, ""))
                }}
                placeholder="0"
                className="measure h-11 w-20 rounded-md bg-surface-sunken px-2 text-center text-base text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
              <span className="ml-1 text-micro text-muted-foreground">km</span>
            </div>
          </div>

          {/* Target time */}
          <div className="flex items-center justify-between gap-3">
            <label className="text-label font-medium text-foreground">
              {t("paceCalc.targetTime")}
            </label>
            <div className="flex items-center gap-1">
              <input
                type="text"
                inputMode="numeric"
                value={hours}
                maxLength={2}
                onChange={(e) => {
                  markManual()
                  setHours(clampInt(e.target.value, 99))
                }}
                placeholder="0"
                className="measure h-11 w-12 rounded-md bg-surface-sunken px-1 text-center text-base text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
              <span className="text-label text-muted-foreground">:</span>
              <input
                type="text"
                inputMode="numeric"
                value={mins}
                maxLength={2}
                onChange={(e) => {
                  markManual()
                  setMins(clampInt(e.target.value, 59))
                }}
                placeholder="00"
                className="measure h-11 w-12 rounded-md bg-surface-sunken px-1 text-center text-base text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
              <span className="text-label text-muted-foreground">:</span>
              <input
                type="text"
                inputMode="numeric"
                value={secs}
                maxLength={2}
                onChange={(e) => {
                  markManual()
                  setSecs(clampInt(e.target.value, 59))
                }}
                placeholder="00"
                className="measure h-11 w-12 rounded-md bg-surface-sunken px-1 text-center text-base text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
            </div>
          </div>

          {/* Result */}
          {targetResult ? (
            <div className="rounded-md bg-surface-sunken p-3.5 space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-micro text-muted-foreground">
                  {t("paceCalc.requiredPace")}
                </span>
                <span className="text-lead font-bold measure text-foreground">
                  {formatPace(targetResult.paceMinPerKm)}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-micro text-muted-foreground">
                  {t("paceCalc.avgSpeed")}
                </span>
                <span className="text-label font-semibold measure text-muted-foreground">
                  {targetResult.speedKmh.toFixed(1)} km/t
                </span>
              </div>

              {splits.length > 0 && (
                <div className="border-t border-border pt-2 mt-2">
                  <p className="mb-1.5 text-micro text-muted-foreground">
                    {t("paceCalc.splits")}
                  </p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                    {splits.map((s) => (
                      <div key={s.key} className="flex items-baseline justify-between">
                        <span className="text-micro text-muted-foreground">{s.label}</span>
                        <span className="text-micro measure font-semibold text-foreground">
                          {formatTargetTime(s.seconds)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-micro text-muted-foreground">{t("paceCalc.targetHint")}</p>
          )}
        </div>
      )}
    </AppCard>
  )
}
