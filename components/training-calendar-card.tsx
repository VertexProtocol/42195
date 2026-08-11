"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Flag } from "lucide-react"
import type { Activity, Goal, TestRun } from "@/lib/types"
import { useI18n } from "@/lib/i18n"
import { AppCard } from "@/components/ui/app-card"
import { formatElapsed } from "@/lib/format"

interface TrainingCalendarCardProps {
  activities: Activity[]
  goals: Goal[]
  testRuns?: TestRun[]
  onViewGoal?: (goal: Goal) => void
  onSelectActivity?: (activity: Activity) => void
}

interface DayStats {
  km: number
  count: number
  seconds: number
  /** The runs behind the totals, so a tapped day can open one of them. */
  activities: Activity[]
}

interface DayCell {
  date: Date
  key: string
  inMonth: boolean
  stats: DayStats | null
  goals: Goal[]
  isTestRun: boolean
}

const localDateKey = (date: Date): string => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

// Monday-aligned start of the grid containing the 1st of the given month
const startOfMonthGrid = (year: number, month: number): Date => {
  const firstOfMonth = new Date(year, month, 1)
  const dow = firstOfMonth.getDay() // 0=Sun .. 6=Sat
  const mondayOffset = dow === 0 ? 6 : dow - 1
  const start = new Date(firstOfMonth)
  start.setDate(firstOfMonth.getDate() - mondayOffset)
  start.setHours(0, 0, 0, 0)
  return start
}

const intensityClass = (km: number, maxKm: number): string => {
  if (km <= 0 || maxKm <= 0) return ""
  const ratio = km / maxKm
  if (ratio >= 0.75) return "bg-primary/80"
  if (ratio >= 0.5) return "bg-primary/55"
  if (ratio >= 0.25) return "bg-primary/35"
  return "bg-primary/15"
}

export function TrainingCalendarCard({
  activities,
  goals,
  testRuns = [],
  onViewGoal,
  onSelectActivity,
}: TrainingCalendarCardProps) {
  const { t, locale } = useI18n()
  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])
  const [viewMonth, setViewMonth] = useState({
    year: today.getFullYear(),
    month: today.getMonth(),
  })
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  const byDay = useMemo(() => {
    const map = new Map<string, DayStats>()
    for (const a of activities) {
      const key = localDateKey(new Date(a.date))
      const cur = map.get(key) ?? { km: 0, count: 0, seconds: 0, activities: [] }
      cur.km += Number(a.distance_km)
      cur.count += 1
      cur.seconds += a.duration_seconds
      cur.activities.push(a)
      map.set(key, cur)
    }
    return map
  }, [activities])

  const goalsByDay = useMemo(() => {
    const map = new Map<string, Goal[]>()
    for (const g of goals) {
      const key = localDateKey(new Date(g.target_date))
      const list = map.get(key) ?? []
      list.push(g)
      map.set(key, list)
    }
    return map
  }, [goals])

  const testRunDays = useMemo(() => {
    const set = new Set<string>()
    for (const tr of testRuns) {
      const act = activities.find((a) => a.id === tr.activity_id)
      if (!act) continue
      set.add(localDateKey(new Date(act.date)))
    }
    return set
  }, [testRuns, activities])

  const { year, month } = viewMonth
  const gridStart = useMemo(() => startOfMonthGrid(year, month), [year, month])

  const allDays = useMemo<DayCell[]>(() => {
    const arr: DayCell[] = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart)
      d.setDate(gridStart.getDate() + i)
      const key = localDateKey(d)
      arr.push({
        date: d,
        key,
        inMonth: d.getFullYear() === year && d.getMonth() === month,
        stats: byDay.get(key) ?? null,
        goals: goalsByDay.get(key) ?? [],
        isTestRun: testRunDays.has(key),
      })
    }
    return arr
  }, [gridStart, year, month, byDay, goalsByDay, testRunDays])

  // Trim to 5 rows if the last row is entirely out-of-month (typical Feb)
  const visibleDays = useMemo(() => {
    const lastRow = allDays.slice(35, 42)
    const lastRowEmpty = lastRow.every((d) => !d.inMonth)
    return lastRowEmpty ? allDays.slice(0, 35) : allDays
  }, [allDays])

  // Intensity scale: base on max in-month km, floored so small totals don't look saturated
  const maxKm = useMemo(() => {
    const kms = visibleDays
      .filter((d) => d.inMonth && d.stats)
      .map((d) => d.stats!.km)
    if (kms.length === 0) return 0
    return Math.max(10, ...kms)
  }, [visibleDays])

  const monthTotals = useMemo(() => {
    let km = 0
    let count = 0
    let seconds = 0
    for (const d of visibleDays) {
      if (!d.inMonth || !d.stats) continue
      km += d.stats.km
      count += d.stats.count
      seconds += d.stats.seconds
    }
    return { km, count, seconds }
  }, [visibleDays])

  const isToday = (d: Date) =>
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()

  const monthLabel = new Date(year, month, 1).toLocaleDateString(
    locale === "no" ? "nb-NO" : "en-US",
    { month: "long", year: "numeric" },
  )

  const goPrev = () =>
    setViewMonth(
      month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 },
    )
  const goNext = () =>
    setViewMonth(
      month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 },
    )
  const goToday = () =>
    setViewMonth({ year: today.getFullYear(), month: today.getMonth() })

  const atCurrentMonth =
    year === today.getFullYear() && month === today.getMonth()

  // Clear selection when navigating months
  useEffect(() => {
    setSelectedDay(null)
  }, [year, month])

  const selectedGoals = useMemo(() => {
    if (!selectedDay) return []
    return goalsByDay.get(selectedDay) ?? []
  }, [selectedDay, goalsByDay])

  const selectedActivities = useMemo(() => {
    if (!selectedDay) return []
    return byDay.get(selectedDay)?.activities ?? []
  }, [selectedDay, byDay])

  const goalDateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "no" ? "nb-NO" : "en-US", {
        day: "numeric",
        month: "short",
      }),
    [locale],
  )

  const weekdayKeys = [
    "calendar.mon",
    "calendar.tue",
    "calendar.wed",
    "calendar.thu",
    "calendar.fri",
    "calendar.sat",
    "calendar.sun",
  ] as const

  return (
    <AppCard className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="text-label font-semibold capitalize text-card-foreground">
            {monthLabel}
          </h4>
          {!atCurrentMonth && (
            <button
              onClick={goToday}
              className="rounded-full border border-border px-2.5 py-0.5 text-micro font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("calendar.today")}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={goPrev}
            aria-label="Previous month"
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={goNext}
            aria-label="Next month"
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-1">
        {weekdayKeys.map((key) => (
          <div
            key={key}
            className="text-center text-micro font-medium uppercase tracking-wider text-muted-foreground"
          >
            {t(key)}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1">
        {visibleDays.map((d) => {
          const hasData = d.stats !== null && d.stats.km > 0
          const hasGoal = d.goals.length > 0
          const hasTestRun = d.isTestRun && !hasGoal
          const todayCell = isToday(d.date)
          const showFlag = hasGoal || hasTestRun
          const flagClass = hasGoal
            ? "fill-warning text-warning"
            : "fill-chart-5 text-chart-5"
          const isSelected = selectedDay === d.key
          const cellContent = (
            <>
              <span
                className={`text-micro leading-none pt-0.5 ${
                  hasData || todayCell
                    ? "text-foreground font-semibold"
                    : "text-muted-foreground"
                }`}
              >
                {d.date.getDate()}
              </span>
              <div className="flex-1 flex flex-col items-center justify-center gap-0.5">
                {showFlag && (
                  <Flag
                    aria-label={hasGoal ? "Goal target date" : "Test run"}
                    size={14}
                    className={flagClass}
                  />
                )}
                {hasData && (
                  <span className="text-micro measure font-semibold text-foreground leading-none">
                    {d.stats!.km < 10
                      ? d.stats!.km.toFixed(1)
                      : Math.round(d.stats!.km)}
                  </span>
                )}
              </div>
            </>
          )
          const cellClass = `aspect-square rounded-lg flex flex-col items-center p-1 ${
            hasData ? intensityClass(d.stats!.km, maxKm) : "bg-secondary/20"
          } ${!d.inMonth ? "opacity-40" : ""} ${
            todayCell ? "ring-2 ring-foreground/35" : ""
          } ${isSelected ? "ring-2 ring-warning" : ""}`
          // A day with anything on it opens. One run and nothing else goes
          // straight there, since that is the only thing the tap could have
          // meant; a day carrying several runs, or a run and a race date,
          // expands below instead of picking one of them on the runner's
          // behalf.
          const dayActivities = d.stats?.activities ?? []
          const opensDirectly = !hasGoal && dayActivities.length === 1 && Boolean(onSelectActivity)
          if (hasGoal || dayActivities.length > 0) {
            return (
              <button
                key={d.key}
                type="button"
                aria-expanded={opensDirectly ? undefined : isSelected}
                onClick={() =>
                  opensDirectly
                    ? onSelectActivity!(dayActivities[0])
                    : setSelectedDay((prev) => (prev === d.key ? null : d.key))
                }
                className={`${cellClass} active:scale-95 transition-transform`}
              >
                {cellContent}
              </button>
            )
          }
          return (
            <div key={d.key} className={cellClass}>
              {cellContent}
            </div>
          )
        })}
      </div>


      {/* What is on the selected day: its race dates, then its runs. */}
      {(selectedGoals.length > 0 || selectedActivities.length > 0) && (
        <div className="space-y-1 border-t border-border pt-2.5">
          {selectedGoals.map((g) => {
            const row = (
              <>
                <Flag
                  size={11}
                  className="fill-warning text-warning shrink-0"
                />
                <span className="measure text-muted-foreground shrink-0">
                  {goalDateFmt.format(new Date(g.target_date))}
                </span>
                <span className="flex-1 truncate text-left text-card-foreground">
                  {g.name}
                </span>
                {onViewGoal && (
                  <ChevronRight
                    size={14}
                    className="text-muted-foreground shrink-0"
                  />
                )}
              </>
            )
            if (onViewGoal) {
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => onViewGoal(g)}
                  className="flex w-full items-center gap-2 text-micro rounded-lg px-1.5 py-1 -mx-1.5 hover:bg-muted/50 active:scale-[0.99] transition-all"
                >
                  {row}
                </button>
              )
            }
            return (
              <div key={g.id} className="flex items-center gap-2 text-micro px-1.5">
                {row}
              </div>
            )
          })}

          {onSelectActivity &&
            selectedActivities.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onSelectActivity?.(a)}
                className="flex w-full items-center gap-2 text-micro rounded-lg px-1.5 py-1 -mx-1.5 hover:bg-muted/50 active:scale-[0.99] transition-all"
              >
                <span className="measure shrink-0 font-semibold text-foreground">
                  {Number(a.distance_km).toFixed(1)} km
                </span>
                <span className="flex-1 truncate text-left text-card-foreground">{a.name}</span>
                <ChevronRight size={14} className="text-muted-foreground shrink-0" />
              </button>
            ))}
        </div>
      )}

      {/* Footer totals */}
      <div className="flex items-center justify-center gap-3 border-t border-border pt-2.5 text-micro text-muted-foreground">
        <span>
          <span className="font-semibold text-foreground measure">
            {monthTotals.km.toFixed(0)}
          </span>{" "}
          km
        </span>
        <span className="text-border">·</span>
        <span>
          <span className="font-semibold text-foreground measure">
            {monthTotals.count}
          </span>{" "}
          {t("calendar.runs")}
        </span>
        <span className="text-border">·</span>
        <span className="font-semibold text-foreground measure">
          {formatElapsed(monthTotals.seconds)}
        </span>
      </div>
    </AppCard>
  )
}
