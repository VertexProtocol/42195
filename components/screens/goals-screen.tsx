"use client"

import { useState, useMemo, useEffect } from "react"
import {
  Check,
  Plus,
  Pencil,
  Flame,
  ChevronLeft,
  ChevronRight,
  Repeat,
  Timer,
  Trophy,
  Footprints,
  ChevronDown,
  GripVertical,
  Star,
  Sparkles,
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
import type {
  Activity,
  Goal,
  WeeklyGoal,
  WeeklyGoalMetric,
  WeeklySuggestionDismissal,
} from "@/lib/types"
import { useI18n } from "@/lib/i18n"
import { WEEKLY_METRIC_ICONS, WEEKLY_METRIC_LABEL_KEYS } from "@/lib/weekly-metrics"
import { parseWeekStart, shiftWeekStr, weekStartStr, weeksBetweenStarts } from "@/lib/week"
import { recordTargetChange, targetForWeek } from "@/lib/weekly-goal-history"
import {
  detectSuggestionDrift,
  selectPacesetter,
  suggestWeeklyGoals,
  type GoalPlanningPrefs,
  type PlanDigest,
  type WeeklySuggestion,
} from "@/lib/weekly-suggestions"
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

export type GoalTab = "weekly" | "race"

interface GoalsScreenProps {
  goals: Goal[]
  activities: Activity[]
  weeklyGoals: WeeklyGoal[]
  onToggleActive: (goalId: string) => void
  onToggleStar: (goalId: string) => void
  onEditGoal: (goal: Goal) => void
  onAddGoal: () => void
  onEditWeeklyGoal: (goal: WeeklyGoal) => void
  /** Opens the editor, prefilled when a suggestion is being taken up. */
  onAddWeeklyGoal: (suggestion?: WeeklySuggestion) => void
  onSelectGoal: (goal: Goal) => void
  onReorderGoals: (orderedIds: string[]) => Promise<void>
  onReorderWeeklyGoals: (orderedIds: string[]) => Promise<void>
  /** Stripped block weeks per goal, for the suggested weekly targets. */
  planDigests?: PlanDigest[]
  /** Planning settings by goal id, for the same. */
  goalPrefs?: Record<string, GoalPlanningPrefs>
  /** Suggestions already turned down; they are not offered again. */
  dismissals?: WeeklySuggestionDismissal[]
  /** Turn one down for good — by metric and source race, not by week. */
  onDismissSuggestion?: (metric: WeeklyGoalMetric, sourceGoalId: string | null) => void
  /**
   * Save an existing weekly target in place. Used by the one-tap actions on a
   * card — taking the plan's number, or settling a plan that has moved — which
   * change one field and have no reason to open the editor over the list.
   */
  onSaveWeeklyGoal?: (goal: WeeklyGoal) => void
  /**
   * Which horizon to open on. Races unless the caller says otherwise — coming
   * here from a weekly goal on Today and landing on the race list is landing
   * on the wrong screen.
   */
  initialTab?: GoalTab
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

function weekLabel(weekStr: string, currentStr: string, thisWeekLabel: string): string {
  if (weekStr === currentStr) return thisWeekLabel
  const start = parseWeekStart(weekStr)
  const end = parseWeekStart(weekStr)
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

/**
 * A line of the app's own voice inside a card the runner owns.
 *
 * Used where a suggestion has something to say about a target that already
 * exists — the plan's number beside a standing one, or a plan that has moved
 * since a target was accepted. It is a note, not a card: nesting a surface
 * inside a surface would read as a second goal rather than a remark about
 * this one.
 */
function SuggestionNote({
  text,
  actions,
  tone = "quiet",
}: {
  text: string
  actions: ({ label: string; onClick: () => void } | null)[]
  tone?: "quiet" | "attention"
}) {
  return (
    <div
      className={`mt-2 rounded-sm px-2 py-1.5 ${
        tone === "attention" ? "bg-caution/10" : "bg-surface-sunken"
      }`}
    >
      <p className="measure text-micro leading-relaxed text-muted-foreground">{text}</p>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-3">
        {actions.filter(Boolean).map((action) => (
          <button
            key={action!.label}
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              action!.onClick()
            }}
            className="press -ml-1 min-h-[32px] rounded-sm px-1 text-micro font-semibold text-foreground hover:underline"
          >
            {action!.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * A weekly target the app is offering rather than one the runner has set.
 *
 * Deliberately quieter than a real weekly goal card: a sunken well instead of
 * an elevated surface, no meter, no drag handle. It is a proposal, and a
 * proposal that looks identical to a commitment reads as one the runner has
 * forgotten making.
 */
function SuggestionCard({
  suggestion,
  goalName,
  onUse,
  onDismiss,
}: {
  suggestion: WeeklySuggestion
  goalName: string | null
  onUse: () => void
  onDismiss?: () => void
}) {
  const { t } = useI18n()
  const Icon = WEEKLY_METRIC_ICONS[suggestion.metric]
  const label = t(WEEKLY_METRIC_LABEL_KEYS[suggestion.metric])

  return (
    <AppCard variant="quiet" padding="sm">
      <div className="flex items-start gap-2.5">
        <Icon size={15} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="min-w-0 flex-1 truncate text-label font-semibold text-foreground">
              {label}
            </h3>
            <span className="measure shrink-0 text-body font-semibold text-foreground">
              {formatWeeklyMetric(suggestion.target, suggestion.metric)}
            </span>
          </div>

          <p className="measure mt-1 text-micro leading-relaxed text-muted-foreground">
            {t(suggestion.reasonKey, suggestion.reasonValues)}
          </p>

          {goalName && (
            <p className="mt-1 text-micro text-muted-foreground">
              {t("weeklySuggestion.easedFor", { goal: goalName })}
            </p>
          )}

          {/* Accepting and refusing are not the same weight of decision, so
              they are not the same weight of control. Dismissal is quiet and
              sits under the reason it is refusing, rather than beside the
              button it would otherwise compete with. */}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="press mt-1.5 -ml-1 min-h-[32px] rounded-sm px-1 text-micro text-muted-foreground/70 hover:text-foreground"
            >
              {t("weeklySuggestion.dismiss")}
            </button>
          )}
        </div>

        <Button size="sm" variant="secondary" onClick={onUse} className="shrink-0">
          {t("weeklySuggestion.use")}
        </Button>
      </div>
    </AppCard>
  )
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
  onEditWeeklyGoal,
  onAddWeeklyGoal,
  onSelectGoal,
  onReorderGoals,
  onReorderWeeklyGoals,
  planDigests,
  goalPrefs,
  dismissals,
  onDismissSuggestion,
  onSaveWeeklyGoal,
  initialTab = "race",
}: GoalsScreenProps) {
  const { t } = useI18n()
  const [tab, setTab] = useState<GoalTab>(initialTab)
  const [expandedGoalIds, setExpandedGoalIds] = useState<Set<string>>(new Set())
  const toggleExpanded = (id: string) => {
    setExpandedGoalIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const todayMondayStr = weekStartStr()
  const [selectedWeekStart, setSelectedWeekStart] = useState(todayMondayStr)

  const isCurrentWeek = selectedWeekStart === todayMondayStr
  const nextMondayStr = shiftWeekStr(todayMondayStr, 1)

  /**
   * Next week is reachable only when a block actually prescribes it.
   *
   * The navigator was capped at today, which is right for a record of what has
   * been run and wrong the moment the app can say what is coming. It is not
   * opened up any further than that: without a plan, next week's number would
   * be this week's arithmetic run a second time, and a forward arrow that
   * leads to a guess is worse than no forward arrow.
   */
  const planCoversNextWeek = useMemo(
    () =>
      (planDigests ?? []).some((d) => {
        const index = weeksBetweenStarts(
          parseWeekStart(d.blockStartDate),
          parseWeekStart(nextMondayStr),
        )
        return index >= 0 && index < d.weeks.length
      }),
    [planDigests, nextMondayStr],
  )

  const isNextWeek = selectedWeekStart === nextMondayStr
  const canGoForward =
    selectedWeekStart < todayMondayStr || (isCurrentWeek && planCoversNextWeek)

  /** The weeks a suggestion is worth deriving for: this one, and a planned next. */
  const isSuggestibleWeek = isCurrentWeek || (isNextWeek && planCoversNextWeek)

  /**
   * The targets that apply to the week being looked at.
   *
   * A recurring goal applies to every week from the one it was set in
   * onwards, not to every week there has ever been. It used to render into
   * the whole archive, so a runner who set "40 km every week" today found
   * last spring marked as a run of missed weeks against a target that did
   * not exist then — the app inventing a commitment and then judging them
   * for it.
   *
   * What this does not fix: a recurring target the runner *changes* still
   * shows its new value in the weeks before the change. Holding those still
   * means writing a row per week, which needs the materialisation decision
   * in WEEKLY_GOALS_PLAN.md. This is the half that needs no schema.
   */
  const selectedWeekGoals = useMemo(
    () =>
      weeklyGoals.filter((wg) =>
        wg.is_recurring ? wg.week_start <= selectedWeekStart : wg.week_start === selectedWeekStart,
      ),
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

  /**
   * What the app would set for this week, minus whatever the runner already
   * has. Recomputed here rather than fetched, so it follows a Strava sync and
   * a regenerated block without a round trip.
   *
   * Only the current week is offered a suggestion. Backfilling a week that has
   * been and gone with a target nobody was working to would turn the week
   * navigator from a record into a hypothetical.
   */
  const allSuggestions = useMemo(() => {
    if (!isSuggestibleWeek) return []
    return suggestWeeklyGoals({
      goals,
      plans: planDigests,
      preferences: goalPrefs,
      activities,
      weekStart: selectedWeekStart,
      dismissals,
    })
  }, [isSuggestibleWeek, goals, planDigests, goalPrefs, activities, selectedWeekStart, dismissals])

  /**
   * The same set of suggestions in the two roles they can play: an offer for a
   * metric with nothing set, or a hint against a target that already exists.
   *
   * A recurring goal the runner wrote by hand is a standing instruction, and
   * it wins — but it would otherwise silence this metric permanently, since a
   * recurring goal is in every week there will ever be. So the suggestion
   * stays, quietly, on that goal's own card with one tap to take it.
   *
   * A one-off target for this week silences the metric outright. The runner
   * answered this week's question this week; asking again underneath their
   * answer is not offering, it is arguing.
   */
  const { offers, hintByGoalId } = useMemo(() => {
    const existingByMetric = new Map(selectedWeekGoals.map((wg) => [wg.metric, wg]))
    const offers: WeeklySuggestion[] = []
    const hintByGoalId = new Map<string, WeeklySuggestion>()

    for (const suggestion of allSuggestions) {
      const existing = existingByMetric.get(suggestion.metric)
      if (!existing) {
        offers.push(suggestion)
      } else if ((existing.source ?? "manual") === "manual" && existing.is_recurring) {
        hintByGoalId.set(existing.id, suggestion)
      }
    }

    return { offers, hintByGoalId }
  }, [allSuggestions, selectedWeekGoals])

  /**
   * Accepted targets whose plan has since changed its mind. Shown on the card,
   * never applied to it — see `detectSuggestionDrift`.
   */
  const driftByGoalId = useMemo(
    () =>
      new Map(
        detectSuggestionDrift(selectedWeekGoals, allSuggestions).map((d) => [d.goal.id, d.suggestion]),
      ),
    [selectedWeekGoals, allSuggestions],
  )

  const goalNameById = useMemo(
    () => new Map(goals.map((g) => [g.id, g.name])),
    [goals],
  )

  /**
   * The race whose volume sets this week, asked of the engine rather than
   * worked out again here — two answers to "which race is the pacesetter"
   * would eventually differ, and the difference would be the screen naming
   * the wrong race.
   */
  const pacesetterName = useMemo(
    () => selectPacesetter(goals, todayMondayStr)?.name ?? null,
    [goals, todayMondayStr],
  )

  /** Take the offered number, and record that it was offered. */
  function takeSuggestion(goal: WeeklyGoal, suggestion: WeeklySuggestion) {
    onSaveWeeklyGoal?.({
      ...goal,
      target: suggestion.target,
      source: suggestion.source,
      source_goal_id: suggestion.sourceGoalId,
      suggested_target: suggestion.target,
      // This path changes a target without going through the editor, so it
      // has to close the outgoing number's run itself. A standing goal taking
      // the plan's figure is exactly the case the history exists for.
      target_history: recordTargetChange(goal, suggestion.target, todayMondayStr),
    })
  }

  /**
   * Settle a plan that has moved without changing the target.
   *
   * The runner's number stays; what is recorded is that they have seen the new
   * one. Without this the disagreement would be raised on every visit, which
   * is the app declining to accept an answer it asked for.
   */
  function keepTarget(goal: WeeklyGoal, suggestion: WeeklySuggestion) {
    onSaveWeeklyGoal?.({ ...goal, suggested_target: suggestion.target })
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
    <div className="flex flex-col gap-5 px-4 pb-8 screen-body">
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
              onClick={() => setSelectedWeekStart(shiftWeekStr(selectedWeekStart, -1))}
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
              onClick={() => setSelectedWeekStart(shiftWeekStr(selectedWeekStart, 1))}
              disabled={!canGoForward}
              aria-label={t("goals.nextWeek")}
            >
              <ChevronRight size={18} />
            </Button>
          </div>

          {orderedWeeklyGoals.length === 0 ? (
            <EmptyState
              icon={<Flame size={18} />}
              title={
                isNextWeek && offers.length > 0
                  ? t("weeklySuggestion.nextWeekTitle")
                  : !isCurrentWeek
                    ? t("goals.noGoalsThisWeek")
                    : offers.length > 0
                      ? t("weeklySuggestion.emptyTitle")
                      : t("goals.noWeeklyGoals")
              }
              body={
                isNextWeek && offers.length > 0
                  ? t("weeklySuggestion.nextWeekBody")
                  : !isCurrentWeek
                    ? t("goals.noGoalsSetThisWeek")
                    : offers.length > 0
                      ? t("weeklySuggestion.emptyBody")
                      : t("goals.setTargets")
              }
              action={
                isCurrentWeek ? (
                  <Button size="sm" variant={offers.length > 0 ? "outline" : "default"} onClick={() => onAddWeeklyGoal()}>
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
                    // The number this goal held in the week on screen, which is
                    // not always the number it holds now: a recurring target
                    // that has been raised since must not re-judge the weeks
                    // that were run against the old one.
                    const target = targetForWeek(wg, selectedWeekStart)
                    const progress = progressPercentage(current, target)
                    const Icon = WEEKLY_METRIC_ICONS[wg.metric]
                    const isComplete = current >= target
                    const label = t(WEEKLY_METRIC_LABEL_KEYS[wg.metric]) ?? wg.label
                    const valueText = `${formatWeeklyMetric(current, wg.metric)} / ${formatWeeklyMetric(target, wg.metric)}`
                    const hint = hintByGoalId.get(wg.id)
                    const drift = driftByGoalId.get(wg.id)
                    // Only worth saying when the two differ. A target taken as
                    // offered has nothing to have been adjusted from.
                    const adjustedFrom =
                      wg.suggested_target != null && Number(wg.suggested_target) !== target
                        ? Number(wg.suggested_target)
                        : null

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
                                  {formatWeeklyMetric(target, wg.metric)}
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

                                {adjustedFrom !== null && (
                                  <p className="mt-1.5 text-micro text-muted-foreground">
                                    {t("weeklySuggestion.adjustedFrom", {
                                      value: formatWeeklyMetric(adjustedFrom, wg.metric),
                                    })}
                                  </p>
                                )}

                                {/* A standing manual target keeps its number;
                                    the plan's is offered beside it rather than
                                    being suppressed for every week to come. */}
                                {hint && (
                                  <SuggestionNote
                                    text={t("weeklySuggestion.planSays", {
                                      value: formatWeeklyMetric(hint.target, hint.metric),
                                    })}
                                    actions={[
                                      { label: t("weeklySuggestion.useNumber"), onClick: () => takeSuggestion(wg, hint) },
                                      onDismissSuggestion
                                        ? {
                                            label: t("weeklySuggestion.dismiss"),
                                            onClick: () => onDismissSuggestion(hint.metric, hint.sourceGoalId),
                                          }
                                        : null,
                                    ]}
                                  />
                                )}

                                {/* The plan changed after this target was
                                    accepted. Asked, never applied: a number
                                    that moves on its own is one the runner
                                    goes out against without being told. */}
                                {drift && (
                                  <SuggestionNote
                                    tone="attention"
                                    text={t("weeklySuggestion.planMoved", {
                                      value: formatWeeklyMetric(drift.target, drift.metric),
                                    })}
                                    actions={[
                                      { label: t("weeklySuggestion.update"), onClick: () => takeSuggestion(wg, drift) },
                                      { label: t("weeklySuggestion.keepMine"), onClick: () => keepTarget(wg, drift) },
                                    ]}
                                  />
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

          {offers.length > 0 && (
            <section className="flex flex-col gap-2.5" aria-label={t("weeklySuggestion.heading")}>
              {/* The heading only appears once there is something above it to
                  distinguish these from. On an empty week the cards are the
                  only thing on screen and the empty state has already said
                  what they are. */}
              {orderedWeeklyGoals.length > 0 && (
                <div className="flex items-center gap-2">
                  <Sparkles size={14} className="shrink-0 text-muted-foreground" aria-hidden />
                  <h2 className="text-label font-semibold text-muted-foreground">
                    {t("weeklySuggestion.heading")}
                  </h2>
                </div>
              )}
              {offers.map((s) => (
                <SuggestionCard
                  key={s.metric}
                  suggestion={s}
                  goalName={
                    s.clampedByGoalId ? (goalNameById.get(s.clampedByGoalId) ?? null) : null
                  }
                  onUse={() => onAddWeeklyGoal(s)}
                  onDismiss={
                    onDismissSuggestion
                      ? () => onDismissSuggestion(s.metric, s.sourceGoalId)
                      : undefined
                  }
                />
              ))}
            </section>
          )}

          {isCurrentWeek && orderedWeeklyGoals.length > 0 && (
            <Button variant="outline" block onClick={() => onAddWeeklyGoal()}>
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
                <Button size="sm" onClick={onAddGoal}>
                  <Plus size={16} />
                  {t("goals.addGoal")}
                </Button>
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
                                      {/* A date that has passed is not an
                                          achievement. This said "Completed" for
                                          any goal whose day had been and gone —
                                          including a 20 km target whose longest
                                          run, shown one tap below, was 10.5 km.
                                          The engine already knows whether the
                                          mark was hit; only goals with a
                                          measurable target can be judged, so an
                                          event goal simply ends. */}
                                      {!isPast
                                        ? `${days} ${t("common.daysLeft")}`
                                        : status?.reached
                                          ? t("plan.achieved")
                                          : t("plan.ended")}
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

              {/* Says out loud what the drag order has been doing. The order
                  was reused as priority rather than adding a fourth flag to a
                  row that already carries is_active, is_starred and
                  display_order — but that redefinition has to be seen, or a
                  runner who ordered the list by taste has set a priority
                  without being told the list had one.

                  Said in a sentence rather than stamped on the card. A badge
                  reading "A" is jargon shortened until it is a single letter,
                  and it landed in a row that already carries the goal's name,
                  its trophy and its training phase. Naming the race in the
                  explanation says the same thing and needs no key. */}
              {pacesetterName !== null && orderedRaceGoals.length > 1 && (
                <p className="measure text-micro leading-relaxed text-muted-foreground">
                  {t("goals.orderIsPriority", { goal: pacesetterName })}
                </p>
              )}

              {/* One entry point, not one per category. The sheet opens on its
                  own goal-type selector, so a pair of buttons here asked the
                  same question twice in a row and made the first tap read as
                  though it had not registered. That selector cannot move up
                  here either: it is how an existing goal's type is changed, and
                  editing has no button to arrive through. */}
              <Button variant="outline" size="sm" block onClick={onAddGoal}>
                <Plus size={16} />
                {t("goals.addGoal")}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
