"use client"

import { useState, useMemo, useEffect } from "react"
import {
  Check,
  Plus,
  Pencil,
  Flame,
  TrendingUp,
  Clock,
  Mountain,
  ChevronLeft,
  ChevronRight,
  Repeat,
  Timer,
  Trophy,
  CalendarCheck,
  Footprints,
  ChevronDown,
  GripVertical,
  Star,
  Target,
} from "lucide-react"
import {
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
  TouchSensor,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  formatDistance,
  formatDateShort,
  formatDuration,
  daysUntil,
  isDatePast,
  progressPercentage,
  timeElapsedPercentage,
  formatWeeklyMetric,
  formatTargetTime,
  computeWeeklyProgress,
  evaluatePerformanceGoal,
  computeDistanceInRange,
  bestRelevantRun,
  longestRun,
} from "@/lib/format"
import type { Activity, Goal, WeeklyGoal, WeeklyGoalMetric } from "@/lib/types"
import { useI18n } from "@/lib/i18n"
import { AppCard } from "@/components/ui/app-card"
import { Meter } from "@/components/ui/meter"
import { Pill } from "@/components/ui/pill"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"

/**
 * Plan — the two horizons a runner keeps: the race on the calendar, and the
 * week in front of them. A segmented control switches horizon; everything
 * inside shares one card vocabulary so a weekly target and a race target are
 * visibly the same kind of object.
 */

type GoalTab = "weekly" | "race"

const METRIC_ICONS: Record<string, typeof Flame> = {
  distance_km: TrendingUp,
  sessions: Flame,
  duration_minutes: Clock,
  elevation_m: Mountain,
}

const METRIC_LABEL_KEYS: Record<
  WeeklyGoalMetric,
  "goals.weeklyDistance" | "goals.trainingSessions" | "goals.activeMinutes" | "goals.elevationGain"
> = {
  distance_km: "goals.weeklyDistance",
  sessions: "goals.trainingSessions",
  duration_minutes: "goals.activeMinutes",
  elevation_m: "goals.elevationGain",
}

interface GoalsScreenProps {
  goals: Goal[]
  activities: Activity[]
  weeklyGoals: WeeklyGoal[]
  onToggleActive: (goalId: string) => void
  onToggleStar: (goalId: string) => void
  onEditGoal: (goal: Goal) => void
  onAddGoal: () => void
  onAddEventGoal: () => void
  onEditWeeklyGoal: (goal: WeeklyGoal) => void
  onAddWeeklyGoal: () => void
  onSelectGoal: (goal: Goal) => void
  onReorderGoals: (orderedIds: string[]) => Promise<void>
  onReorderWeeklyGoals: (orderedIds: string[]) => Promise<void>
}

function SortableGoalItem({
  id,
  children,
}: {
  id: string
  children: (dragListeners: React.HTMLAttributes<HTMLElement> | undefined) => React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  }
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {children(listeners)}
    </div>
  )
}

// ---- date helpers ----

function localMondayStr(date: Date): string {
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const mon = new Date(date)
  mon.setDate(date.getDate() + diff)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${mon.getFullYear()}-${p(mon.getMonth() + 1)}-${p(mon.getDate())}`
}

function shiftWeek(weekStr: string, delta: number): string {
  const d = new Date(weekStr + "T12:00:00")
  d.setDate(d.getDate() + delta * 7)
  return localMondayStr(d)
}

function weekLabel(weekStr: string, currentStr: string, thisWeekLabel: string): string {
  if (weekStr === currentStr) return thisWeekLabel
  const start = new Date(weekStr + "T12:00:00")
  const end = new Date(weekStr + "T12:00:00")
  end.setDate(end.getDate() + 6)
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "short" })
  return `${fmt(start)} – ${fmt(end)}`
}

function trainingPhaseKey(
  startDate: string | null,
  targetDate: string,
): {
  labelKey: "plan.raceWeek" | "plan.tapering" | "plan.peakTraining" | "plan.buildingBase"
  tone: "negative" | "caution" | "action" | "positive"
} {
  const pct = timeElapsedPercentage(startDate, targetDate)
  if (pct >= 95) return { labelKey: "plan.raceWeek", tone: "negative" }
  if (pct >= 85) return { labelKey: "plan.tapering", tone: "caution" }
  if (pct >= 70) return { labelKey: "plan.peakTraining", tone: "action" }
  return { labelKey: "plan.buildingBase", tone: "positive" }
}

// ---- component ----

export function GoalsScreen({
  goals,
  activities,
  weeklyGoals,
  onToggleActive,
  onToggleStar,
  onEditGoal,
  onAddGoal,
  onAddEventGoal,
  onEditWeeklyGoal,
  onAddWeeklyGoal,
  onSelectGoal,
  onReorderGoals,
  onReorderWeeklyGoals,
}: GoalsScreenProps) {
  const { t } = useI18n()
  const [tab, setTab] = useState<GoalTab>("race")
  const [expandedGoalIds, setExpandedGoalIds] = useState<Set<string>>(new Set())
  const toggleExpanded = (id: string) => {
    setExpandedGoalIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const todayMondayStr = localMondayStr(new Date())
  const [selectedWeekStart, setSelectedWeekStart] = useState(todayMondayStr)

  const isCurrentWeek = selectedWeekStart === todayMondayStr
  const canGoForward = selectedWeekStart < todayMondayStr

  // Recurring goals apply to every week; one-off goals only to their own.
  const selectedWeekGoals = useMemo(
    () => weeklyGoals.filter((wg) => wg.is_recurring || wg.week_start === selectedWeekStart),
    [weeklyGoals, selectedWeekStart],
  )

  const performanceGoals = useMemo(
    () => goals.filter((g) => g.goal_category === "performance"),
    [goals],
  )

  const raceGoals = useMemo(
    () =>
      goals
        .filter((g) => g.goal_category === "performance" || g.goal_category === "event_training")
        .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0)),
    [goals],
  )

  const sensors = useSensors(useSensor(PointerSensor), useSensor(TouchSensor))

  const [orderedRaceGoals, setOrderedRaceGoals] = useState(raceGoals)
  useEffect(() => {
    setOrderedRaceGoals(raceGoals)
  }, [raceGoals])

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = orderedRaceGoals.findIndex((g) => g.id === active.id)
    const newIndex = orderedRaceGoals.findIndex((g) => g.id === over.id)
    const reordered = arrayMove(orderedRaceGoals, oldIndex, newIndex)
    setOrderedRaceGoals(reordered)
    onReorderGoals(reordered.map((g) => g.id))
  }

  const [orderedWeeklyGoals, setOrderedWeeklyGoals] = useState(selectedWeekGoals)
  useEffect(() => {
    setOrderedWeeklyGoals(selectedWeekGoals)
  }, [selectedWeekGoals])

  function handleWeeklyDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = orderedWeeklyGoals.findIndex((g) => g.id === active.id)
    const newIndex = orderedWeeklyGoals.findIndex((g) => g.id === over.id)
    const reordered = arrayMove(orderedWeeklyGoals, oldIndex, newIndex)
    setOrderedWeeklyGoals(reordered)
    onReorderWeeklyGoals(reordered.map((g) => g.id))
  }

  const perfGoalStatuses = useMemo(
    () =>
      new Map(
        performanceGoals.map((goal) => [
          goal.id,
          evaluatePerformanceGoal(activities, goal.target_distance_km, goal.target_time_seconds),
        ]),
      ),
    [performanceGoals, activities],
  )

  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-1">
      {/* Segmented control */}
      <div
        role="tablist"
        aria-label={t("goals.title")}
        className="flex rounded-md bg-surface-sunken p-1"
      >
        {(
          [
            ["race", t("goals.targets")],
            ["weekly", t("goals.weekly")],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`press flex-1 rounded-sm py-2.5 text-label font-semibold ${
              tab === key
                ? "bg-card text-foreground shadow-e1"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Weekly ─────────────────────────────────────────────────────── */}
      {tab === "weekly" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setSelectedWeekStart(shiftWeek(selectedWeekStart, -1))}
              aria-label={t("goals.previousWeek")}
            >
              <ChevronLeft size={18} />
            </Button>
            <span className="text-label font-semibold text-foreground" aria-live="polite">
              {weekLabel(selectedWeekStart, todayMondayStr, t("goals.thisWeek"))}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setSelectedWeekStart(shiftWeek(selectedWeekStart, 1))}
              disabled={!canGoForward}
              aria-label={t("goals.nextWeek")}
            >
              <ChevronRight size={18} />
            </Button>
          </div>

          {orderedWeeklyGoals.length === 0 ? (
            <EmptyState
              icon={<Flame size={18} />}
              title={isCurrentWeek ? t("goals.noWeeklyGoals") : t("goals.noGoalsThisWeek")}
              body={isCurrentWeek ? t("goals.setTargets") : t("goals.noGoalsSetThisWeek")}
              action={
                isCurrentWeek ? (
                  <Button size="sm" onClick={onAddWeeklyGoal}>
                    <Plus size={16} />
                    {t("goals.addWeeklyGoal")}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleWeeklyDragEnd}
            >
              <SortableContext
                items={orderedWeeklyGoals.map((g) => g.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="flex flex-col gap-3">
                  {orderedWeeklyGoals.map((wg) => {
                    const current = computeWeeklyProgress(
                      activities,
                      wg.metric,
                      selectedWeekStart,
                      wg.session_min_duration_minutes,
                      wg.session_min_distance_km,
                    )
                    const progress = progressPercentage(current, wg.target)
                    const Icon = METRIC_ICONS[wg.metric] || Target
                    const isComplete = current >= wg.target
                    const label = t(METRIC_LABEL_KEYS[wg.metric]) ?? wg.label
                    const valueText = `${formatWeeklyMetric(current, wg.metric)} / ${formatWeeklyMetric(wg.target, wg.metric)}`

                    return (
                      <SortableGoalItem key={wg.id} id={wg.id}>
                        {(dragListeners) => (
                          <AppCard tone={isComplete ? "done" : "neutral"} padding="sm">
                            <div className="flex items-start gap-2.5">
                              <button
                                {...dragListeners}
                                onClick={(e) => e.stopPropagation()}
                                className="press -ml-1 flex size-8 shrink-0 touch-none items-center justify-center rounded-sm text-muted-foreground/50 hover:text-muted-foreground"
                                aria-label={t("goals.dragToReorder")}
                              >
                                <GripVertical size={16} />
                              </button>

                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <Icon
                                    size={15}
                                    className={isComplete ? "text-success" : "text-muted-foreground"}
                                    aria-hidden
                                  />
                                  <h3 className="min-w-0 flex-1 truncate text-label font-semibold text-card-foreground">
                                    {label}
                                  </h3>
                                  {wg.is_recurring && (
                                    <Pill tone="neutral" icon={<Repeat size={10} />}>
                                      {t("goals.weekly")}
                                    </Pill>
                                  )}
                                </div>

                                <p className="measure mt-1.5 text-micro text-muted-foreground">
                                  <span
                                    className={`font-semibold ${
                                      isComplete ? "text-success" : "text-foreground"
                                    }`}
                                  >
                                    {formatWeeklyMetric(current, wg.metric)}
                                  </span>
                                  {" / "}
                                  {formatWeeklyMetric(wg.target, wg.metric)}
                                  {isComplete && (
                                    <span className="ml-2 font-semibold text-success">
                                      {t("goals.goalReached")}
                                    </span>
                                  )}
                                </p>

                                <Meter
                                  className="mt-2"
                                  value={progress}
                                  tone={isComplete ? "done" : "action"}
                                  label={label}
                                  valueText={valueText}
                                />

                                {wg.metric === "sessions" &&
                                  (wg.session_min_duration_minutes || wg.session_min_distance_km) && (
                                    <p className="mt-1.5 text-micro text-muted-foreground">
                                      {[
                                        wg.session_min_duration_minutes &&
                                          `≥ ${wg.session_min_duration_minutes} min`,
                                        wg.session_min_distance_km &&
                                          `≥ ${wg.session_min_distance_km} km`,
                                      ]
                                        .filter(Boolean)
                                        .join(" · ")}{" "}
                                      {t("goals.perSession")}
                                    </p>
                                  )}
                              </div>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onEditWeeklyGoal(wg)
                                }}
                                className="press -mr-1 flex size-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground/70 hover:text-foreground"
                                aria-label={`${t("common.edit")}: ${label}`}
                              >
                                <Pencil size={15} />
                              </button>
                            </div>
                          </AppCard>
                        )}
                      </SortableGoalItem>
                    )
                  })}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {isCurrentWeek && orderedWeeklyGoals.length > 0 && (
            <Button variant="outline" block onClick={onAddWeeklyGoal}>
              <Plus size={16} />
              {t("goals.addWeeklyGoal")}
            </Button>
          )}
        </div>
      )}

      {/* ── Race targets ───────────────────────────────────────────────── */}
      {tab === "race" && (
        <div className="flex flex-col gap-4">
          {orderedRaceGoals.length === 0 ? (
            <EmptyState
              icon={<Trophy size={18} />}
              title={t("goals.noTargets")}
              body={t("goals.setEventTargets")}
              action={
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={onAddGoal}>
                    <Timer size={15} />
                    {t("goals.addPerfGoal")}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={onAddEventGoal}>
                    <CalendarCheck size={15} />
                    {t("plan.addEvent")}
                  </Button>
                </div>
              }
            />
          ) : (
            <>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={orderedRaceGoals.map((g) => g.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="flex flex-col gap-3">
                    {orderedRaceGoals.map((goal) => {
                      const isPerformance = goal.goal_category === "performance"
                      const isExpanded = expandedGoalIds.has(goal.id)
                      const days = daysUntil(goal.target_date)
                      const isPast = isDatePast(goal.target_date)

                      const status = isPerformance
                        ? (perfGoalStatuses.get(goal.id) ?? {
                            reached: false,
                            bestActivity: null,
                            bestTimeSeconds: null,
                            progress: 0,
                          })
                        : null

                      const phase = !isPerformance
                        ? trainingPhaseKey(goal.start_date, goal.target_date)
                        : null
                      const logged = !isPerformance
                        ? computeDistanceInRange(activities, goal.start_date, goal.target_date)
                        : 0
                      const timeProgress = !isPerformance
                        ? timeElapsedPercentage(goal.start_date, goal.target_date)
                        : 0
                      const best = !isPerformance
                        ? bestRelevantRun(
                            activities,
                            goal.target_distance_km,
                            goal.start_date,
                            goal.target_date,
                          )
                        : null
                      const longest = !isPerformance
                        ? longestRun(activities, goal.start_date, goal.target_date)
                        : null

                      return (
                        <SortableGoalItem key={goal.id} id={goal.id}>
                          {(dragListeners) => (
                            <AppCard
                              padding="sm"
                              tone={
                                status?.reached ? "done" : goal.is_active ? "action" : "neutral"
                              }
                              className={isPast && !status?.reached ? "opacity-65" : ""}
                            >
                              <div className="flex items-center gap-1">
                                <button
                                  {...dragListeners}
                                  onClick={(e) => e.stopPropagation()}
                                  className="press -ml-1 flex size-9 shrink-0 touch-none items-center justify-center rounded-sm text-muted-foreground/50 hover:text-muted-foreground"
                                  aria-label={t("goals.dragToReorder")}
                                >
                                  <GripVertical size={16} />
                                </button>

                                <button
                                  type="button"
                                  onClick={() => toggleExpanded(goal.id)}
                                  aria-expanded={isExpanded}
                                  className="press flex min-w-0 flex-1 items-center gap-2.5 rounded-sm py-1.5 text-left"
                                >
                                  {isPerformance ? (
                                    <Timer size={16} className="shrink-0 text-muted-foreground" aria-hidden />
                                  ) : (
                                    <Footprints size={16} className="shrink-0 text-muted-foreground" aria-hidden />
                                  )}
                                  <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-1.5">
                                      <span className="truncate text-label font-semibold text-card-foreground">
                                        {goal.name}
                                      </span>
                                      {status?.reached && (
                                        <Trophy size={13} className="shrink-0 text-success" aria-hidden />
                                      )}
                                    </span>
                                    <span className="mt-0.5 block truncate text-micro text-muted-foreground">
                                      {formatDistance(goal.target_distance_km)}
                                      {goal.target_time_seconds && (
                                        <>
                                          {" · "}
                                          <span className="measure font-medium text-foreground">
                                            {formatTargetTime(goal.target_time_seconds)}
                                          </span>
                                        </>
                                      )}
                                      {" · "}
                                      {isPast
                                        ? t("plan.completed")
                                        : `${days} ${t("common.daysLeft")}`}
                                    </span>
                                  </span>
                                  <ChevronDown
                                    size={17}
                                    aria-hidden
                                    className="shrink-0 text-muted-foreground"
                                    style={{
                                      transform: isExpanded ? "rotate(180deg)" : "none",
                                      transition: "transform var(--dur-state) var(--ease-out)",
                                    }}
                                  />
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onToggleStar(goal.id)
                                  }}
                                  aria-pressed={goal.is_starred}
                                  className={`press -mr-1 flex size-9 shrink-0 items-center justify-center rounded-sm ${
                                    goal.is_starred
                                      ? "text-primary"
                                      : "text-muted-foreground/50 hover:text-muted-foreground"
                                  }`}
                                  aria-label={
                                    goal.is_starred ? t("goals.unpinFromHome") : t("goals.pinToHome")
                                  }
                                >
                                  <Star size={16} fill={goal.is_starred ? "currentColor" : "none"} />
                                </button>
                              </div>

                              {isExpanded && (
                                <div className="mt-3 border-t border-border pt-3.5">
                                  {isPerformance && status ? (
                                    <>
                                      <div className="flex items-baseline justify-between gap-3">
                                        <span className="text-micro text-muted-foreground">
                                          {goal.target_time_seconds
                                            ? status.bestActivity
                                              ? t("goals.bestTime")
                                              : t("goals.noQualifyingRuns")
                                            : status.bestActivity
                                              ? t("goals.longestRun")
                                              : t("goals.noRuns")}
                                        </span>
                                        {status.bestActivity && (
                                          <span
                                            className={`measure text-label font-semibold ${
                                              status.reached ? "text-success" : "text-foreground"
                                            }`}
                                          >
                                            {goal.target_time_seconds
                                              ? formatTargetTime(status.bestTimeSeconds!)
                                              : formatDistance(status.bestActivity.distance_km)}
                                          </span>
                                        )}
                                      </div>
                                      <Meter
                                        className="mt-2"
                                        value={status.progress}
                                        tone={status.reached ? "done" : "action"}
                                        label={goal.name}
                                      />
                                      <div className="mt-1.5 flex items-baseline justify-between gap-3 text-micro">
                                        <span className="text-muted-foreground">
                                          {t("goals.target")}:{" "}
                                          <span className="measure">
                                            {goal.target_time_seconds
                                              ? formatTargetTime(goal.target_time_seconds)
                                              : formatDistance(goal.target_distance_km)}
                                          </span>
                                        </span>
                                        {status.reached && status.bestActivity && (
                                          <span className="font-medium text-success">
                                            {formatDateShort(status.bestActivity.date)}
                                          </span>
                                        )}
                                      </div>

                                      <div className="mt-3.5 flex items-center justify-between gap-2">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            onEditGoal(goal)
                                          }}
                                        >
                                          <Pencil size={14} />
                                          {t("common.edit")}
                                        </Button>
                                        <Button
                                          variant={goal.is_active ? "outline" : "secondary"}
                                          size="sm"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            onToggleActive(goal.id)
                                          }}
                                        >
                                          <Check size={14} />
                                          {goal.is_active ? t("goals.active") : t("goals.setActive")}
                                        </Button>
                                      </div>
                                    </>
                                  ) : (
                                    <>
                                      {phase && (
                                        <Pill tone={phase.tone}>{t(phase.labelKey)}</Pill>
                                      )}

                                      <div className="mt-3 flex items-baseline justify-between gap-3 text-micro">
                                        <span className="text-muted-foreground">
                                          <span className="measure font-semibold text-foreground">
                                            {formatDistance(logged)}
                                          </span>{" "}
                                          {t("common.logged")}
                                        </span>
                                        <span className="text-muted-foreground">
                                          {timeProgress}% {t("plan.timeElapsed")}
                                        </span>
                                      </div>
                                      <Meter
                                        className="mt-2"
                                        value={timeProgress}
                                        label={`${goal.name} — ${t("plan.timeElapsed")}`}
                                      />

                                      {(best || longest) && (
                                        <div className="mt-3 flex flex-col gap-1 border-t border-border pt-3 text-micro text-muted-foreground">
                                          {best && (
                                            <p>
                                              {t("plan.bestRun")}:{" "}
                                              <span className="measure text-foreground">
                                                {formatDistance(best.distance_km)}
                                              </span>{" "}
                                              {t("plan.inTime")}{" "}
                                              <span className="measure text-foreground">
                                                {formatDuration(best.duration_seconds)}
                                              </span>
                                            </p>
                                          )}
                                          {longest && !best && (
                                            <p>
                                              {t("plan.longestRun")}:{" "}
                                              <span className="measure text-foreground">
                                                {formatDistance(longest.distance_km)}
                                              </span>
                                            </p>
                                          )}
                                        </div>
                                      )}

                                      <div className="mt-3.5 flex items-center justify-between gap-2">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            onEditGoal(goal)
                                          }}
                                        >
                                          <Pencil size={14} />
                                          {t("common.edit")}
                                        </Button>
                                        <Button
                                          variant="secondary"
                                          size="sm"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            onSelectGoal(goal)
                                          }}
                                        >
                                          {t("plan.viewPlan")}
                                          <ChevronRight size={14} />
                                        </Button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              )}
                            </AppCard>
                          )}
                        </SortableGoalItem>
                      )
                    })}
                  </div>
                </SortableContext>
              </DndContext>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={onAddGoal}>
                  <Timer size={15} />
                  {t("goals.addPerfGoal")}
                </Button>
                <Button variant="outline" size="sm" className="flex-1" onClick={onAddEventGoal}>
                  <CalendarCheck size={15} />
                  {t("plan.addEvent")}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
