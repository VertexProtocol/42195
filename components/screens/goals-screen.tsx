"use client"

import { useState, useMemo, useEffect } from "react"
import {
  Check, Calendar, Target, Plus, Pencil,
  Flame, TrendingUp, Clock, Mountain,
  ChevronLeft, ChevronRight, RefreshCw, Timer, Trophy,
  CalendarCheck, MapPin, Footprints, Sparkles, ChevronDown, GripVertical, Star,
} from "lucide-react"
// [DND] @dnd-kit drag-and-drop for goal reordering
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
  formatDate,
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
import { AppCard } from '@/components/ui/app-card'

type GoalTab = "weekly" | "race"

const METRIC_ICONS: Record<string, typeof Flame> = {
  distance_km: TrendingUp,
  sessions: Flame,
  duration_minutes: Clock,
  elevation_m: Mountain,
}

const METRIC_LABEL_KEYS: Record<WeeklyGoalMetric, "goals.weeklyDistance" | "goals.trainingSessions" | "goals.activeMinutes" | "goals.elevationGain"> = {
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
  onToggleStar: (goalId: string) => void // [STAR]
  onEditGoal: (goal: Goal) => void
  onAddGoal: () => void
  onAddEventGoal: () => void
  onEditWeeklyGoal: (goal: WeeklyGoal) => void
  onAddWeeklyGoal: () => void
  onSelectGoal: (goal: Goal) => void
  onReorderGoals: (orderedIds: string[]) => Promise<void> // [DND]
  onReorderWeeklyGoals: (orderedIds: string[]) => Promise<void> // [DND]
}

// [DND] Wrapper that makes a goal card sortable and provides drag listeners to children
function SortableGoalItem({
  id,
  children,
}: {
  id: string
  children: (dragListeners: React.HTMLAttributes<HTMLElement> | undefined) => React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
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
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { day: "numeric", month: "short" })
  return `${fmt(start)} – ${fmt(end)}`
}

// ---- training phase helper ----
function trainingPhaseKey(startDate: string | null, targetDate: string): {
  labelKey: "plan.raceWeek" | "plan.tapering" | "plan.peakTraining" | "plan.buildingBase"
  color: string
} {
  const pct = timeElapsedPercentage(startDate, targetDate)
  if (pct >= 95) return { labelKey: "plan.raceWeek", color: "text-destructive" }
  if (pct >= 85) return { labelKey: "plan.tapering", color: "text-warning" }
  if (pct >= 70) return { labelKey: "plan.peakTraining", color: "text-primary" }
  return { labelKey: "plan.buildingBase", color: "text-success" }
}

// ---- component ----

export function GoalsScreen({
  goals,
  activities,
  weeklyGoals,
  onToggleActive,
  onToggleStar, // [STAR]
  onEditGoal,
  onAddGoal,
  onAddEventGoal,
  onEditWeeklyGoal,
  onAddWeeklyGoal,
  onSelectGoal,
  onReorderGoals, // [DND]
  onReorderWeeklyGoals, // [DND]
}: GoalsScreenProps) {
  const { t } = useI18n()
  const [tab, setTab] = useState<GoalTab>("race")
  const [expandedGoalIds, setExpandedGoalIds] = useState<Set<string>>(new Set())
  const toggleExpanded = (id: string) => {
    setExpandedGoalIds(prev => {
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

  // Recurring goals show in every week; one-off goals only in their own week
  const selectedWeekGoals = weeklyGoals.filter((wg) =>
    wg.is_recurring || wg.week_start === selectedWeekStart
  )

  // Performance goals (still needed for perfGoalStatuses below)
  const performanceGoals = goals.filter((g) => g.goal_category === "performance")

  // [DND] All race goals sorted by user-defined display_order
  const raceGoals = useMemo(
    () =>
      goals
        .filter((g) => g.goal_category === "performance" || g.goal_category === "event_training")
        .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0)),
    [goals]
  )

  // [DND] Sensors: PointerSensor for mouse/stylus, TouchSensor for Safari iOS
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(TouchSensor),
  )

  // [DND] Local ordered list for optimistic drag-and-drop reordering
  const [orderedRaceGoals, setOrderedRaceGoals] = useState(raceGoals)
  useEffect(() => { setOrderedRaceGoals(raceGoals) }, [goals]) // sync when server state changes

  // [DND] Handle drag end: reorder locally and persist
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = orderedRaceGoals.findIndex((g) => g.id === active.id)
    const newIndex = orderedRaceGoals.findIndex((g) => g.id === over.id)
    const reordered = arrayMove(orderedRaceGoals, oldIndex, newIndex)
    setOrderedRaceGoals(reordered)
    onReorderGoals(reordered.map((g) => g.id))
  }

  // [DND] Ordered weekly goals for the selected week
  const [orderedWeeklyGoals, setOrderedWeeklyGoals] = useState(selectedWeekGoals)
  useEffect(() => { setOrderedWeeklyGoals(selectedWeekGoals) }, [weeklyGoals, selectedWeekStart])

  // [DND] Handle drag end for weekly goals
  function handleWeeklyDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = orderedWeeklyGoals.findIndex((g) => g.id === active.id)
    const newIndex = orderedWeeklyGoals.findIndex((g) => g.id === over.id)
    const reordered = arrayMove(orderedWeeklyGoals, oldIndex, newIndex)
    setOrderedWeeklyGoals(reordered)
    onReorderWeeklyGoals(reordered.map((g) => g.id))
  }

  // Pre-compute performance goal evaluations (avoids O(goals * activities) inside JSX)
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
    <div className="flex flex-col gap-5 px-5 pb-6 pt-4">
      <header>
        <h1 className="text-2xl font-bold text-foreground">{t("goals.title")}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {t("goals.subtitle")}
        </p>
      </header>

      {/* Segmented control */}
      <div className="flex rounded-xl bg-secondary p-1">
        <button
          onClick={() => setTab("race")}
          className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition-all ${
            tab === "race"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground active:text-foreground"
          }`}
        >
          {t("goals.targets")}
        </button>
        <button
          onClick={() => setTab("weekly")}
          className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition-all ${
            tab === "weekly"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground active:text-foreground"
          }`}
        >
          {t("goals.weekly")}
        </button>
      </div>

      {/* ── Weekly tab ── */}
      {tab === "weekly" && (
        <div className="flex flex-col gap-4">

          {/* Week navigator */}
          <div className="flex items-center justify-between rounded-xl bg-secondary px-2 py-1">
            <button
              onClick={() => setSelectedWeekStart(shiftWeek(selectedWeekStart, -1))}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground active:bg-accent transition-colors"
              aria-label="Previous week"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="text-sm font-semibold text-foreground">
              {weekLabel(selectedWeekStart, todayMondayStr, t("goals.thisWeek"))}
            </span>
            <button
              onClick={() => setSelectedWeekStart(shiftWeek(selectedWeekStart, 1))}
              disabled={!canGoForward}
              className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                canGoForward ? "text-muted-foreground active:bg-accent" : "text-border"
              }`}
              aria-label="Next week"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Add button — current week only */}
          {isCurrentWeek && (
            <button
              onClick={onAddWeeklyGoal}
              className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground active:bg-secondary transition-colors"
            >
              <Plus size={18} />
              {t("goals.addWeeklyGoal")}
            </button>
          )}

          {selectedWeekGoals.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
                <Flame size={28} className="text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">
                {isCurrentWeek ? t("goals.noWeeklyGoals") : t("goals.noGoalsThisWeek")}
              </p>
              <p className="text-xs text-muted-foreground">
                {isCurrentWeek
                  ? t("goals.setTargets")
                  : t("goals.noGoalsSetThisWeek")}
              </p>
            </div>
          ) : (
            // [DND] DnD context wraps the sortable weekly goal list
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleWeeklyDragEnd}>
              <SortableContext items={orderedWeeklyGoals.map((g) => g.id)} strategy={verticalListSortingStrategy}>
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

                  // [DND] wrap each card in SortableGoalItem
                  return (
                    <SortableGoalItem key={wg.id} id={wg.id}>
                      {(dragListeners) => (
                        <AppCard variant="flush" state={isComplete ? 'complete' : 'idle'}>
                          {/* Header — matches performance/event card structure */}
                          <div className="flex">
                            {/* [DND] Drag handle */}
                            <button
                              {...dragListeners}
                              onClick={(e) => e.stopPropagation()}
                              className="touch-none flex shrink-0 items-center px-3 text-muted-foreground/25 active:text-muted-foreground/60"
                              aria-label="Drag to reorder"
                            >
                              <GripVertical size={16} />
                            </button>

                            {/* Main content */}
                            <div className="flex flex-1 items-start gap-3 py-3 pr-2">
                              <div className={`mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl ${
                                isComplete ? "bg-success/15" : "bg-secondary"
                              }`}>
                                <Icon size={20} className={isComplete ? "text-success" : "text-muted-foreground"} />
                              </div>

                              <div className="flex-1 min-w-0">
                                <h4 className="font-semibold text-foreground truncate">{label}</h4>
                                <div className="mt-0.5 flex items-center justify-between gap-2">
                                  <p className="text-xs text-muted-foreground tabular-nums">
                                    <span className={`font-medium ${isComplete ? "text-success" : "text-foreground"}`}>
                                      {formatWeeklyMetric(current, wg.metric)}
                                    </span>
                                    {" / "}{formatWeeklyMetric(wg.target, wg.metric)}
                                    {isComplete && (
                                      <span className="ml-1.5 font-medium text-success">{t("goals.goalReached")}</span>
                                    )}
                                  </p>
                                  {wg.is_recurring && (
                                    <span className="shrink-0 inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                                      <RefreshCw size={9} />
                                      {t("goals.weekly")}
                                    </span>
                                  )}
                                </div>
                                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
                                  <div
                                    className={`h-full rounded-full transition-all duration-500 ${isComplete ? "bg-success" : "bg-primary"}`}
                                    style={{ width: `${progress}%` }}
                                  />
                                </div>
                                {wg.metric === "sessions" && (wg.session_min_duration_minutes || wg.session_min_distance_km) && (
                                  <p className="mt-1 text-[11px] text-muted-foreground">
                                    {[
                                      wg.session_min_duration_minutes && `≥ ${wg.session_min_duration_minutes} min`,
                                      wg.session_min_distance_km && `≥ ${wg.session_min_distance_km} km`,
                                    ].filter(Boolean).join(" · ")} {t("goals.perSession")}
                                  </p>
                                )}
                              </div>
                            </div>

                            {/* Edit button — top-aligned alongside title */}
                            <button
                              onClick={(e) => { e.stopPropagation(); onEditWeeklyGoal(wg) }}
                              className="shrink-0 px-3 pt-3 pb-3 text-muted-foreground/40 active:text-muted-foreground transition-colors"
                              aria-label={`Edit ${label}`}
                            >
                              <Pencil size={15} />
                            </button>
                          </div>
                        </AppCard>
                      )}
                    </SortableGoalItem>
                  )
                })}
              </SortableContext>
            </DndContext>
          )}
        </div>
      )}

      {/* ── Race Goals tab (merged Performance + Events) ── */}
      {tab === "race" && (
        <div className="flex flex-col gap-3">
          {/* Add buttons */}
          <div className="flex gap-2">
            <button
              onClick={onAddGoal}
              className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground active:bg-secondary transition-colors"
            >
              <Timer size={16} />
              {t("goals.addPerfGoal")}
            </button>
            <button
              onClick={onAddEventGoal}
              className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground active:bg-secondary transition-colors"
            >
              <CalendarCheck size={16} />
              {t("plan.addEvent")}
            </button>
          </div>

          {/* Empty state */}
          {orderedRaceGoals.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
                <Trophy size={28} className="text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">{t("goals.noTargets")}</p>
              <p className="text-xs text-muted-foreground text-center max-w-[240px]">
                {t("goals.setEventTargets")}
              </p>
            </div>
          ) : (
            // [DND] DnD context wraps the sortable goal list
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={orderedRaceGoals.map((g) => g.id)} strategy={verticalListSortingStrategy}>
                {orderedRaceGoals.map((goal) => {
              const isPerformance = goal.goal_category === "performance"
              const isExpanded = expandedGoalIds.has(goal.id)
              const days = daysUntil(goal.target_date)
              const isPast = isDatePast(goal.target_date)
              
              // Performance goal specific
              const status = isPerformance 
                ? (perfGoalStatuses.get(goal.id) ?? { reached: false, bestActivity: null, bestTimeSeconds: null, progress: 0 })
                : null
              
              // Event goal specific
              const phase = !isPerformance ? trainingPhaseKey(goal.start_date, goal.target_date) : null
              const logged = !isPerformance ? computeDistanceInRange(activities, goal.start_date, goal.target_date) : 0
              const timeProgress = !isPerformance ? timeElapsedPercentage(goal.start_date, goal.target_date) : 0
              const best = !isPerformance ? bestRelevantRun(activities, goal.target_distance_km, goal.start_date, goal.target_date) : null
              const longest = !isPerformance ? longestRun(activities, goal.start_date, goal.target_date) : null

              // [DND] wrap each card in SortableGoalItem
              return (
                <SortableGoalItem key={goal.id} id={goal.id}>
                  {(dragListeners) => (
                  <AppCard
                    variant="flush"
                    state={status?.reached ? 'complete' : goal.is_active ? 'active' : 'idle'}
                    className={isPast && !status?.reached ? 'opacity-60' : ''}
                  >
                    {/* Collapsed header: [drag handle] [expand button] */}
                    <div className="flex items-center">
                      {/* [DND] Drag handle — separate from the expand tap target */}
                      <button
                        {...dragListeners}
                        onClick={(e) => e.stopPropagation()}
                        className="touch-none flex shrink-0 items-center self-stretch px-3 text-muted-foreground/25 active:text-muted-foreground/60"
                        aria-label="Drag to reorder"
                      >
                        <GripVertical size={16} />
                      </button>
                      {/* Expand / collapse */}
                      <button
                        type="button"
                        onClick={() => toggleExpanded(goal.id)}
                        className="flex flex-1 min-w-0 items-center gap-3 py-4 pr-2 text-left active:bg-secondary/50 transition-colors"
                      >
                        {/* Icon */}
                        <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${
                          isPerformance ? "bg-amber-500/10" : "bg-primary/10"
                        }`}>
                          {isPerformance ? (
                            <Timer size={20} className="text-amber-500" />
                          ) : (
                            <Footprints size={20} className="text-primary" />
                          )}
                        </div>

                        {/* Title and summary */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <h3 className="font-semibold text-foreground truncate">{goal.name}</h3>
                            {goal.is_active && (
                              <div className="h-2 w-2 rounded-full bg-primary shrink-0" />
                            )}
                            {status?.reached && (
                              <Trophy size={14} className="text-success shrink-0" />
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {formatDistance(goal.target_distance_km)}
                            {goal.target_time_seconds && (
                              <> · <span className="text-primary font-medium">{formatTargetTime(goal.target_time_seconds)}</span></>
                            )}
                            {" · "}
                            {isPast ? t("plan.completed") : `${days} ${t("common.daysLeft")}`}
                          </p>
                        </div>

                        {/* Chevron */}
                        <ChevronDown
                          size={18}
                          className={`text-muted-foreground shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                        />
                      </button>
                      {/* [STAR] Star button — always visible in collapsed header */}
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleStar(goal.id); }}
                        className={`flex shrink-0 items-center self-stretch px-3 transition-colors ${
                          goal.is_starred
                            ? "text-amber-500 active:text-amber-600"
                            : "text-muted-foreground/40 active:text-muted-foreground"
                        }`}
                        aria-label={goal.is_starred ? "Unpin from home" : "Pin to home"}
                      >
                        <Star size={16} fill={goal.is_starred ? "currentColor" : "none"} />
                      </button>
                    </div>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-border">
                      {isPerformance && status ? (
                        /* Performance goal expanded content */
                        <>
                          <div className="mt-4">
                            <div className="flex items-center justify-between text-xs mb-1.5">
                              <span className="text-muted-foreground">
                                {goal.target_time_seconds
                                  ? (status.bestActivity ? t("goals.bestTime") : t("goals.noQualifyingRuns"))
                                  : (status.bestActivity ? t("goals.longestRun") : t("goals.noRuns"))}
                              </span>
                              {status.bestActivity && (
                                <span className={`font-semibold tabular-nums ${status.reached ? "text-success" : "text-foreground"}`}>
                                  {goal.target_time_seconds
                                    ? formatTargetTime(status.bestTimeSeconds!)
                                    : formatDistance(status.bestActivity.distance_km)}
                                </span>
                              )}
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-secondary">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${status.reached ? "bg-success" : "bg-primary"}`}
                                style={{ width: `${status.progress}%` }}
                              />
                            </div>
                            <div className="mt-1 flex items-center justify-between text-[11px]">
                              <span className="text-muted-foreground">
                                {`${t("goals.target")}: `}
                                {goal.target_time_seconds
                                  ? formatTargetTime(goal.target_time_seconds)
                                  : formatDistance(goal.target_distance_km)}
                              </span>
                              {status.reached && status.bestActivity && (
                                <span className="font-medium text-success">
                                  {formatDateShort(status.bestActivity.date)}
                                </span>
                              )}
                            </div>
                          </div>
                          
                          {/* Actions */}
                          <div className="mt-4 flex items-center justify-between">
                            <button
                              onClick={(e) => { e.stopPropagation(); onEditGoal(goal); }}
                              className="flex items-center gap-1.5 text-xs text-muted-foreground active:text-foreground transition-colors"
                            >
                              <Pencil size={14} />
                              Edit
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); onToggleActive(goal.id); }}
                              className={`flex min-h-[36px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                                goal.is_active
                                  ? "bg-primary/10 text-primary active:bg-primary/20"
                                  : "bg-secondary text-secondary-foreground active:bg-accent"
                              }`}
                            >
                              <Check size={14} />
                              {goal.is_active ? t("goals.active") : t("goals.setActive")}
                            </button>
                          </div>
                        </>
                      ) : (
                        /* Event goal expanded content */
                        <>
                          {phase && (
                            <p className={`mt-3 text-xs font-medium ${phase.color}`}>
                              {t(phase.labelKey)}
                            </p>
                          )}
                          
                          {/* Progress bar */}
                          <div className="mt-3">
                            <div className="flex items-center justify-between text-xs mb-1.5">
                              <span className="text-muted-foreground">
                                {formatDistance(logged)} {t("common.logged")}
                              </span>
                              <span className="font-medium text-foreground">{timeProgress}% {t("plan.timeElapsed")}</span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-secondary">
                              <div
                                className="h-full rounded-full bg-primary transition-all duration-500"
                                style={{ width: `${timeProgress}%` }}
                              />
                            </div>
                          </div>

                          {/* Training stats */}
                          {(best || longest) && (
                            <div className="mt-3 pt-3 border-t border-border flex flex-wrap gap-3 text-xs">
                              {best && (
                                <div className="flex items-center gap-1.5 text-muted-foreground">
                                  <Trophy size={12} className="text-amber-500" />
                                  <span>{t("plan.bestRun")}: {formatDistance(best.distance_km)} in {formatDuration(best.duration_seconds)}</span>
                                </div>
                              )}
                              {longest && !best && (
                                <div className="flex items-center gap-1.5 text-muted-foreground">
                                  <TrendingUp size={12} className="text-emerald-500" />
                                  <span>{t("plan.longestRun")}: {formatDistance(longest.distance_km)}</span>
                                </div>
                              )}
                            </div>
                          )}
                          
                          {/* Actions */}
                          <div className="mt-4 flex items-center justify-between">
                            <button
                              onClick={(e) => { e.stopPropagation(); onEditGoal(goal); }}
                              className="flex items-center gap-1.5 text-xs text-muted-foreground active:text-foreground transition-colors"
                            >
                              <Pencil size={14} />
                              Edit
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); onSelectGoal(goal); }}
                              className="flex min-h-[36px] items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary active:bg-primary/20 transition-colors"
                            >
                              View Plan
                            </button>
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
              </SortableContext>
            </DndContext>
          )}
        </div>
      )}
    </div>
  )
}
