"use client"

import {
  useMemo,
  lazy,
  Suspense,
  useState,
  useRef,
  useCallback,
  type ReactNode,
} from "react"
import { ChevronRight, Star, StarOff } from "lucide-react"
import { PoweredByStrava } from "@/components/strava-brand"
import { ProgressLap } from "@/components/progress-lap"
import {
  formatDistance,
  formatDuration,
  formatDateShort,
  daysUntil,
  timeElapsedPercentage,
  isDatePast,
  daysSince,
  formatTargetTime,
  computeDistanceInRange,
  computeWeeklyProgress,
  formatWeeklyMetric,
  progressPercentage,
  isRunActivity,
} from "@/lib/format"
import { LOAD_INDICATOR_MIN_RUNS } from "@/lib/training-constants"
import type {
  Goal,
  WeeklySummary,
  Activity,
  SyncStatus,
  WeeklyGoal,
} from "@/lib/types"
import { useI18n, type TranslationKey, type TranslationParams } from "@/lib/i18n"
import { WEEKLY_METRIC_ICONS, WEEKLY_METRIC_LABEL_KEYS } from "@/lib/weekly-metrics"
import { AppCard, CardRow } from "@/components/ui/app-card"
import { Section, SectionHeader, SectionAction } from "@/components/ui/section"
import { Stat, StatGroup } from "@/components/ui/stat"
import { Pill } from "@/components/ui/pill"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"

const TrainingLoadIndicator = lazy(() =>
  import("@/components/training-load-indicator").then((m) => ({ default: m.TrainingLoadIndicator })),
)
import type { Warning, WarningType } from "@/lib/training-warnings"
import type { PlanBadge } from "@/lib/plan-badges"

/**
 * Today.
 *
 * Reading order is the runner's order: the race that matters and how much of
 * the runway is gone, then whether the body is handling the load, then the
 * week so far, then what was run last. Everything below the first screenful is
 * reference; everything above it is decision.
 */

/**
 * How big a lane is, and how many share a row.
 *
 * The lanes divide the width between them, so their size has to come from how
 * many there are or a row of two would be two small marks with a screen of
 * nothing beside them. Sized to leave a margin inside its column at a 390px
 * screen, which is the narrowest this app is built for; past five they wrap
 * rather than shrinking to a dot.
 */
const LANE_SIZES = [64, 58, 50, 44, 36] as const
const MAX_LANE_COLUMNS = LANE_SIZES.length

function laneSize(count: number): number {
  return LANE_SIZES[Math.min(Math.max(count, 1), MAX_LANE_COLUMNS) - 1]
}

/**
 * A weekly goal, as a lane with its metric icon inside.
 *
 * The lane is the shape a pinned race carries, and the icon rides in it the
 * way the elapsed percentage does there — so the icon is the thing travelling
 * the track rather than a label stuck beside it.
 *
 * No text at all, deliberately. Today asks one question of a weekly goal —
 * how far along is it — and the fill answers it; the figures live a tap away
 * under Targets, and printing them here is what turned this card into a wall
 * of small numbers. The accessible name still carries the lot, because a fill
 * is not readable by ear.
 *
 * Nothing about it is bound to a column either. A runner adds and removes
 * these, and a lane that has to belong to one of three fixed slots means the
 * card changes shape every time they do.
 */
function WeeklyGoalLap({
  goal,
  current,
  size,
  onOpen,
  t,
}: {
  goal: WeeklyGoal
  current: number
  size: number
  onOpen: () => void
  t: (key: TranslationKey, params?: TranslationParams) => string
}) {
  const Icon = WEEKLY_METRIC_ICONS[goal.metric]
  const isComplete = current >= goal.target
  const label = goal.label || t(WEEKLY_METRIC_LABEL_KEYS[goal.metric])
  const valueText = `${formatWeeklyMetric(current, goal.metric)} / ${formatWeeklyMetric(
    goal.target,
    goal.metric,
  )}`
  return (
    <button
      onClick={onOpen}
      // The button fills its column and centres the lane, so the row stays
      // even however many lanes are in it and the tap target is the column
      // rather than the mark.
      className="press flex justify-center rounded-md py-1.5"
      title={`${label} — ${valueText}`}
    >
      <ProgressLap
        percentage={progressPercentage(current, goal.target)}
        size={size}
        strokeWidth={Math.max(3, Math.round(size / 16))}
        tone={isComplete ? "done" : "action"}
        // These sit on the page, not in a card.
        track="border"
        label={`${label} — ${valueText}`}
      >
        <Icon
          size={Math.round(size * 0.4)}
          className={isComplete ? "text-success" : "text-muted-foreground"}
          aria-hidden
        />
      </ProgressLap>
    </button>
  )
}

interface HomeScreenProps {
  /**
   * The "Get started" checklist, when the account still has first-run work
   * left. It leads the screen, and while it is up it also stands in for the
   * no-goals empty state — both would otherwise ask for the same goal.
   */
  guide?: ReactNode
  starredGoals: Goal[]
  currentWeekGoals: WeeklyGoal[]
  activities: Activity[]
  weeklySummary: WeeklySummary
  recentActivities: Activity[]
  /**
   * Both derived during the page render and owned by the app shell. This
   * screen unmounts on every tab change, so fetching them here made the
   * warning cards and goal badges arrive a round-trip late on each return.
   */
  warnings: Warning[]
  planBadges: Record<string, PlanBadge>
  syncStatus?: SyncStatus
  stravaConnected?: boolean
  onViewActivities: () => void
  onViewGoal: (goal: Goal) => void
  /** Unpins a goal from this screen. Offered only once its date has gone. */
  onUnpinGoal?: (goalId: string) => void
  onViewGoals: () => void
  onViewInsights: () => void
  onSelectActivity: (activity: Activity) => void
}

export function HomeScreen({
  guide,
  starredGoals,
  currentWeekGoals,
  activities,
  weeklySummary,
  recentActivities,
  warnings,
  planBadges,
  onViewActivities,
  onViewGoal,
  onViewGoals,
  onSelectActivity,
  onUnpinGoal,
}: HomeScreenProps) {
  const { t } = useI18n()

  // The load engine only ever looks at runs, so the gate counts runs. Counting
  // activities of any type meant seven bike rides both fetched warnings that
  // could not exist and mounted a load card that rendered nothing.
  const runCount = useMemo(
    () => activities.filter((a) => isRunActivity(a.type)).length,
    [activities],
  )
  const hasLoadHistory = runCount >= LOAD_INDICATOR_MIN_RUNS

  const handleDismissWarning = async (type: WarningType) => {
    try {
      await fetch("/api/warnings/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      })
    } catch {
      // Network error — the card still hides locally; the cooldown only
      // applies once the POST has actually landed.
    }
  }

  const currentMondayStr = useMemo(() => {
    const now = new Date()
    const day = now.getDay()
    const diff = day === 0 ? -6 : 1 - day
    const mon = new Date(now)
    mon.setDate(now.getDate() + diff)
    const p = (n: number) => String(n).padStart(2, "0")
    return `${mon.getFullYear()}-${p(mon.getMonth() + 1)}-${p(mon.getDate())}`
  }, [])

  // A race that has been run is not competing for attention with one that is
  // 32 days out, so it sorts behind it. Pinned still means pinned — the card
  // stays reachable, it just stops leading a screen whose whole job is "what
  // is next".
  const orderedGoals = useMemo(() => {
    const past = (g: Goal) => (isDatePast(g.target_date) ? 1 : 0)
    return [...starredGoals].sort((a, b) => past(a) - past(b))
  }, [starredGoals])

  // Precomputed outside JSX so we never run O(goals × activities) per render.
  const goalMetrics = useMemo(
    () =>
      orderedGoals.map((goal) => {
        const logged = computeDistanceInRange(
          activities,
          goal.start_date,
          goal.target_date,
          goal.created_at,
        )
        const effectiveStart = goal.start_date ?? goal.created_at
        const past = isDatePast(goal.target_date)
        return {
          id: goal.id,
          logged,
          past,
          timeProgress: timeElapsedPercentage(effectiveStart, goal.target_date),
          // daysUntil floors at zero, so a race last spring and one tomorrow
          // both read "0 days left". Past cards count the other way instead.
          days: past ? daysSince(goal.target_date) : daysUntil(goal.target_date),
        }
      }),
    [orderedGoals, activities],
  )

  // Pinned goals ride a snap rail once there is more than one of them: stacked
  // full-height cards pushed training load and the week below the fold, and the
  // runner pins a second goal to compare it with the first, not to scroll past
  // it. One goal keeps the plain card — a carousel of one is a lie.
  const isGoalRail = starredGoals.length > 1
  const railRef = useRef<HTMLDivElement>(null)
  const [railIndex, setRailIndex] = useState(0)

  const handleRailScroll = useCallback(() => {
    const rail = railRef.current
    if (!rail) return
    const left = rail.getBoundingClientRect().left
    let nearest = 0
    let best = Infinity
    Array.from(rail.children).forEach((child, i) => {
      const distance = Math.abs(child.getBoundingClientRect().left - left)
      if (distance < best) {
        best = distance
        nearest = i
      }
    })
    setRailIndex(nearest)
  }, [])

  // Every weekly goal is one lane, in one row, in the order the runner put
  // them in. There is no longer a split between goals that fit a stat column
  // and goals that do not — that split was invisible to whoever set the goals
  // and rearranged the card whenever they added or removed one.
  const weeklyLaps = useMemo(() => {
    // A goal counting only qualifying sessions has to be recounted; the rest
    // read the same summary the stat row shows, so a lane and the number above
    // it can never be measuring different things.
    const currentFor = (wg: WeeklyGoal): number => {
      const isQualified =
        wg.metric === "sessions" &&
        Boolean(wg.session_min_duration_minutes || wg.session_min_distance_km)
      if (!isQualified) {
        if (wg.metric === "distance_km") return weeklySummary.total_distance_km
        if (wg.metric === "duration_minutes") return weeklySummary.total_time_seconds / 60
        if (wg.metric === "sessions") return weeklySummary.run_count
      }
      return computeWeeklyProgress(
        activities,
        wg.metric,
        currentMondayStr,
        wg.session_min_duration_minutes,
        wg.session_min_distance_km,
      )
    }
    return currentWeekGoals.map((goal) => ({ goal, current: currentFor(goal) }))
  }, [currentWeekGoals, activities, currentMondayStr, weeklySummary])

  return (
    <div className="flex flex-col gap-7 px-4 pb-8 screen-body">
      {/* ── First run, while there is still first-run work ────────────── */}
      {guide}

      {/* ── The race, and how much runway is left ─────────────────────── */}
      {starredGoals.length > 0 ? (
        <Section>
          <SectionHeader
            title={t("home.activeGoals")}
            action={
              starredGoals.length > 1 ? (
                <span className="text-micro text-muted-foreground">
                  {starredGoals.length} {t("home.goals")}
                </span>
              ) : undefined
            }
          />
          <div
            ref={railRef}
            onScroll={isGoalRail ? handleRailScroll : undefined}
            role={isGoalRail ? "group" : undefined}
            aria-label={isGoalRail ? t("home.activeGoals") : undefined}
            className={
              isGoalRail
                ? "-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-1"
                : "flex flex-col gap-3"
            }
          >
            {orderedGoals.map((goal, i) => {
              const m = goalMetrics[i]
              const badge = planBadges[goal.id]
              return (
                <div
                  key={goal.id}
                  className={isGoalRail ? "w-[86%] shrink-0 snap-start" : undefined}
                >
                <button
                  onClick={() => onViewGoal(goal)}
                  // `flex flex-col` is load-bearing: a button taller than its
                  // content centres that content vertically, which on the rail
                  // floated the shorter card's text between two bands of white
                  // while its neighbour filled the card edge to edge.
                  className="press surface flex h-full w-full flex-col p-4 text-left"
                >
                  {/* Status line, full card width. The plan badges used to sit
                      at the foot of the card, where an extra row on one goal
                      pushed every line below it out of step with the card
                      beside it — up here they cost no height at all. */}
                  <div
                    className={`flex items-center gap-1.5 ${
                      m.past ? "text-muted-foreground" : "text-primary"
                    }`}
                  >
                    <Star size={12} fill="currentColor" aria-hidden />
                    <span className="truncate text-micro font-semibold">
                      {m.past ? t("home.finishedGoal") : t("home.activeGoal")}
                    </span>
                    {(badge?.checkpoint || badge?.blockCompleted) && (
                      <span className="ml-auto flex shrink-0 items-center gap-1.5">
                        {badge?.checkpoint && (
                          <Pill tone="action" className="px-1.5 py-0">
                            {t("plan.checkpointBadge")}
                          </Pill>
                        )}
                        {badge?.blockCompleted && (
                          <Pill tone="positive" className="px-1.5 py-0">
                            {t("plan.blockDoneBadge")}
                          </Pill>
                        )}
                      </span>
                    )}
                  </div>

                  <div className="mt-2 flex flex-1 gap-4">
                    <div className="flex min-w-0 flex-1 flex-col">
                      {/* The countdown leads. It is the one number the runner
                          opens this screen to check, so it is the only thing on
                          it set at display size. */}
                      <p className="flex items-baseline gap-1.5">
                        <span className="measure text-display font-semibold leading-none text-card-foreground">
                          {m.days}
                        </span>
                        <span className="text-label text-muted-foreground">
                          {m.past ? t("home.daysAgo") : t("home.daysLeft")}
                        </span>
                      </p>

                      <h3 className="mt-2 line-clamp-2 text-lead font-semibold text-card-foreground">
                        {goal.name}
                      </h3>

                      {/* The totals sit on the floor of the card rather than
                          under the name, so a two-line name on one card cannot
                          knock the line out of step with the card beside it.
                          `mt-auto` is inert on a card that stands alone. */}
                      <p className="mt-auto line-clamp-2 pt-1.5 text-label text-muted-foreground">
                        <span className="measure font-semibold text-foreground">
                          {formatDistance(m.logged)}
                        </span>{" "}
                        {t("home.logged")}
                        {goal.target_time_seconds ? (
                          <>
                            {" · "}
                            {t("home.target")}{" "}
                            <span className="measure font-semibold text-foreground">
                              {formatTargetTime(goal.target_time_seconds)}
                            </span>
                          </>
                        ) : null}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-col items-center gap-1.5">
                      <ProgressLap
                        percentage={m.timeProgress}
                        size={46}
                        strokeWidth={4}
                        label={`${goal.name} — ${t("home.elapsed")}`}
                      >
                        <span className="measure text-micro font-semibold leading-none text-foreground">
                          {m.timeProgress}%
                        </span>
                      </ProgressLap>
                      <span className="text-micro text-muted-foreground">{t("home.elapsed")}</span>
                    </div>
                  </div>
                </button>

                {/* A sibling of the card, not a child: the card is itself a
                    button, and a button inside a button is not a thing. Offered
                    only once the race is behind them, and only as an offer —
                    unpinning something the runner chose to pin is their call,
                    not a tidy-up the app does quietly overnight. */}
                {m.past && onUnpinGoal && (
                  <button
                    onClick={() => onUnpinGoal(goal.id)}
                    className="press mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-sm py-1.5 text-micro font-semibold text-muted-foreground hover:text-foreground"
                  >
                    <StarOff size={13} aria-hidden />
                    {t("home.unpinFinished")}
                  </button>
                )}
                </div>
              )
            })}
          </div>

          {isGoalRail && (
            // Position, not navigation: the cards peek past the edge, and the
            // count is already in the section header. Tapping a dot would be a
            // second way to do what the swipe already does.
            <div className="flex justify-center gap-1.5 pt-1" aria-hidden>
              {orderedGoals.map((goal, i) => (
                <span
                  key={goal.id}
                  className={`size-1.5 rounded-full ${
                    i === railIndex ? "bg-primary" : "bg-border"
                  }`}
                  style={{ transition: "background-color var(--dur-state) var(--ease-out)" }}
                />
              ))}
            </div>
          )}
        </Section>
      ) : guide ? null : (
        <EmptyState
          title={t("home.noActiveGoals")}
          body={t("home.noActiveGoalsBody")}
          action={
            <Button size="sm" onClick={onViewGoals}>
              {t("home.setGoal")}
            </Button>
          }
        />
      )}

      {/* ── Is the body handling it ───────────────────────────────────── */}
      {hasLoadHistory && (
        <Suspense fallback={null}>
          <TrainingLoadIndicator
            activities={activities}
            warnings={warnings}
            onDismissWarning={handleDismissWarning}
          />
        </Suspense>
      )}

      {/* ── The week so far ───────────────────────────────────────────── */}
      <Section>
        <SectionHeader title={t("home.thisWeek")} />
        <AppCard>
          <StatGroup>
            <Stat
              label={t("stats.distance")}
              value={weeklySummary.total_distance_km.toFixed(1)}
              unit="km"
            />
            <Stat
              label={t("activityDetail.duration")}
              value={formatDuration(weeklySummary.total_time_seconds)}
            />
            <Stat label={t("stats.runsLabel")} value={weeklySummary.run_count} />
          </StatGroup>
        </AppCard>
      </Section>

      {/* ── What the week was aiming at ───────────────────────────────── */}
      {/* Its own section, not the tail of the one above. The week's three
          numbers are a report and always the same three; the targets are a
          set the runner edits, and there may be none. Sharing a card made the
          card change shape as goals came and went, and left two unrelated
          readings stacked with nothing saying which was which. A heading says
          it in one word. */}
      {weeklyLaps.length > 0 && (
        <Section>
          <SectionHeader
            title={t("home.weeklyTargets")}
            action={<SectionAction onClick={onViewGoals}>{t("home.seeAll")}</SectionAction>}
          />
          {/* No card. A card is a surface for content that needs one, and a
              row of lanes is already its own shape — boxing it added an edge
              around four marks and nothing else. The lanes take the page's
              track colour to make up for the surface they lost. */}
          <div
            className="grid gap-1"
            style={{
              gridTemplateColumns: `repeat(${Math.min(
                weeklyLaps.length,
                MAX_LANE_COLUMNS,
              )}, minmax(0, 1fr))`,
            }}
          >
            {weeklyLaps.map(({ goal, current }) => (
              <WeeklyGoalLap
                key={goal.id}
                goal={goal}
                current={current}
                size={laneSize(weeklyLaps.length)}
                onOpen={onViewGoals}
                t={t}
              />
            ))}
          </div>
        </Section>
      )}

      {/* ── What was run ──────────────────────────────────────────────── */}
      {recentActivities.length > 0 && (
        <Section>
          <SectionHeader
            title={t("home.recentActivities")}
            action={<SectionAction onClick={onViewActivities}>{t("home.seeAll")}</SectionAction>}
          />
          <AppCard variant="rows">
            {recentActivities.map((activity) => (
              <CardRow key={activity.id} className="p-0">
                <button
                  onClick={() => onSelectActivity(activity)}
                  className="press flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-label font-semibold text-card-foreground">
                      {activity.name}
                    </p>
                    <p className="mt-0.5 text-micro text-muted-foreground">
                      {formatDateShort(activity.date)} · {activity.type}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="measure text-label font-semibold text-card-foreground">
                      {formatDistance(activity.distance_km)}
                    </p>
                    <p className="measure mt-0.5 text-micro text-muted-foreground">
                      {formatDuration(activity.duration_seconds)}
                    </p>
                  </div>
                  <ChevronRight size={16} className="shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </CardRow>
            ))}
          </AppCard>
        </Section>
      )}

      {activities.length > 0 && <PoweredByStrava className="pt-1" />}
    </div>
  )
}
