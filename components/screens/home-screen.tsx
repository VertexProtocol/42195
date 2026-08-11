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
import { ChevronRight, Star } from "lucide-react"
import { PoweredByStrava } from "@/components/strava-brand"
import { ProgressLap } from "@/components/progress-lap"
import {
  formatDistance,
  formatDuration,
  formatDateShort,
  daysUntil,
  timeElapsedPercentage,
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
  WeeklyGoalMetric,
} from "@/lib/types"
import { useI18n, type TranslationKey, type TranslationParams } from "@/lib/i18n"
import { AppCard, CardRow } from "@/components/ui/app-card"
import { Section, SectionHeader, SectionAction } from "@/components/ui/section"
import { Stat, StatGroup } from "@/components/ui/stat"
import { Meter } from "@/components/ui/meter"
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

/** Weekly-goal metrics that the "This week" stat row already reports. */
const STAT_METRICS: WeeklyGoalMetric[] = ["distance_km", "duration_minutes", "sessions"]

const WEEKLY_LABELS: Record<WeeklyGoalMetric, TranslationKey> = {
  distance_km: "goals.weeklyDistance",
  sessions: "goals.trainingSessions",
  duration_minutes: "goals.activeMinutes",
  elevation_m: "goals.elevationGain",
}

/**
 * A weekly target, set under the number that is already tracking it.
 *
 * Deliberately quiet: a weekly goal is something the runner set once and lets
 * tick along, so it earns a hairline and a target — not a headline. The value
 * it is measured against is the stat above, which is why nothing here repeats
 * the current figure.
 */
function WeeklyTarget({
  goal,
  current,
  t,
}: {
  goal: WeeklyGoal | undefined
  current: number
  t: (key: TranslationKey, params?: TranslationParams) => string
}) {
  if (!goal) return null
  const isComplete = current >= goal.target
  const label = t(WEEKLY_LABELS[goal.metric])
  const target = formatWeeklyMetric(goal.target, goal.metric)
  return (
    <>
      <Meter
        size="sm"
        value={progressPercentage(current, goal.target)}
        tone={isComplete ? "done" : "action"}
        label={label}
        valueText={`${formatWeeklyMetric(current, goal.metric)} / ${target}`}
      />
      <p
        className={`measure mt-1 truncate text-micro ${
          isComplete ? "text-success" : "text-muted-foreground"
        }`}
      >
        {t("home.ofTarget", { target })}
      </p>
    </>
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

  // Precomputed outside JSX so we never run O(goals × activities) per render.
  const goalMetrics = useMemo(
    () =>
      starredGoals.map((goal) => {
        const logged = computeDistanceInRange(
          activities,
          goal.start_date,
          goal.target_date,
          goal.created_at,
        )
        const effectiveStart = goal.start_date ?? goal.created_at
        return {
          id: goal.id,
          logged,
          timeProgress: timeElapsedPercentage(effectiveStart, goal.target_date),
          days: daysUntil(goal.target_date),
        }
      }),
    [starredGoals, activities],
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

  // Each measurement appears once. The card used to print Distance, Duration
  // and Runs as stats and then the same three again as weekly targets, so
  // every number on it was stated twice — once bare, once with a target.
  //
  // A target now annotates the stat it belongs to, unless it measures
  // something narrower: a sessions goal with a minimum length counts only
  // qualifying sessions, and elevation has no stat at all.
  const { statGoals, standaloneGoals } = useMemo(() => {
    const byMetric: Partial<Record<WeeklyGoalMetric, WeeklyGoal>> = {}
    const standalone: WeeklyGoal[] = []
    for (const wg of currentWeekGoals) {
      const isQualified =
        wg.metric === "sessions" &&
        Boolean(wg.session_min_duration_minutes || wg.session_min_distance_km)
      const fitsAStat = STAT_METRICS.includes(wg.metric) && !isQualified
      // Only the first goal per metric can annotate its stat; a second one for
      // the same measurement still deserves to be visible.
      if (fitsAStat && !byMetric[wg.metric]) byMetric[wg.metric] = wg
      else standalone.push(wg)
    }
    return { statGoals: byMetric, standaloneGoals: standalone.slice(0, 3) }
  }, [currentWeekGoals])

  // Read from the same summary the stat above shows, so an annotation can
  // never disagree with the number it sits under.
  const weeklyDistanceKm = weeklySummary.total_distance_km
  const weeklyMinutes = weeklySummary.total_time_seconds / 60

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
            {starredGoals.map((goal, i) => {
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
                  <div className="flex items-center gap-1.5 text-primary">
                    <Star size={12} fill="currentColor" aria-hidden />
                    <span className="truncate text-micro font-semibold">
                      {t("home.activeGoal")}
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
                          {t("home.daysLeft")}
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
                </div>
              )
            })}
          </div>

          {isGoalRail && (
            // Position, not navigation: the cards peek past the edge, and the
            // count is already in the section header. Tapping a dot would be a
            // second way to do what the swipe already does.
            <div className="flex justify-center gap-1.5 pt-1" aria-hidden>
              {starredGoals.map((goal, i) => (
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
        <SectionHeader
          title={t("home.thisWeek")}
          action={
            currentWeekGoals.length > 0 ? (
              <SectionAction onClick={onViewGoals}>{t("home.weeklyTargets")}</SectionAction>
            ) : undefined
          }
        />
        <AppCard>
          <StatGroup>
            <Stat
              label={t("stats.distance")}
              value={weeklySummary.total_distance_km.toFixed(1)}
              unit="km"
            >
              <WeeklyTarget goal={statGoals.distance_km} current={weeklyDistanceKm} t={t} />
            </Stat>
            <Stat
              label={t("activityDetail.duration")}
              value={formatDuration(weeklySummary.total_time_seconds)}
            >
              <WeeklyTarget goal={statGoals.duration_minutes} current={weeklyMinutes} t={t} />
            </Stat>
            <Stat label={t("stats.runsLabel")} value={weeklySummary.run_count}>
              <WeeklyTarget goal={statGoals.sessions} current={weeklySummary.run_count} t={t} />
            </Stat>
          </StatGroup>

          {/* Targets that measure something the row above does not: elevation,
              which has no stat, and session goals with a minimum length, whose
              qualifying count is narrower than the plain run count. Merging
              either into a column would put two different numbers on one
              measurement. */}
          {standaloneGoals.length > 0 && (
            <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
              {standaloneGoals.map((wg) => {
                const current = computeWeeklyProgress(
                  activities,
                  wg.metric,
                  currentMondayStr,
                  wg.session_min_duration_minutes,
                  wg.session_min_distance_km,
                )
                const progress = progressPercentage(current, wg.target)
                const isComplete = current >= wg.target
                const label = wg.label || t(WEEKLY_LABELS[wg.metric])
                const valueText = `${formatWeeklyMetric(current, wg.metric)} / ${formatWeeklyMetric(
                  wg.target,
                  wg.metric,
                )}`
                return (
                  <button
                    key={wg.id}
                    onClick={onViewGoals}
                    className="press w-full rounded-sm text-left"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-label font-medium text-card-foreground">
                        {label}
                      </span>
                      <span
                        className={`measure shrink-0 text-micro ${
                          isComplete ? "text-success" : "text-muted-foreground"
                        }`}
                      >
                        {valueText}
                      </span>
                    </div>
                    <Meter
                      className="mt-1.5"
                      size="sm"
                      value={progress}
                      tone={isComplete ? "done" : "action"}
                      label={label}
                      valueText={valueText}
                    />
                  </button>
                )
              })}
            </div>
          )}
        </AppCard>
      </Section>

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
