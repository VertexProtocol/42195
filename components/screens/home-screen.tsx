"use client"

import { useMemo, lazy, Suspense, useEffect, useState } from "react"
import { AlertCircle, CheckCircle2, RefreshCw, Star, ChevronRight } from "lucide-react"
import { PoweredByStrava } from "@/components/strava-brand"
import { ProgressRing } from "@/components/progress-ring"
import { Carousel, CarouselContent, CarouselItem } from "@/components/ui/carousel"
import { AppCard } from "@/components/ui/app-card"
import { Metric, MetricRow } from "@/components/ui/metric"
import { SectionHeader } from "@/components/ui/section-header"
import { Sparkline } from "@/components/ui/sparkline"
import {
  formatDuration,
  formatTargetTime,
  computeDistanceInRange,
  computeWeeklyProgress,
  timeElapsedPercentage,
  daysUntil,
  progressPercentage,
} from "@/lib/format"
import {
  relativeDayLabel,
  weekdayInitials,
  greetingKey,
  fullDateLabel,
} from "@/lib/date-labels"
import type { Goal, WeeklySummary, Activity, SyncStatus, WeeklyGoal } from "@/lib/types"
import { useI18n, type TranslationKey } from "@/lib/i18n"
import { createClient } from "@/lib/supabase/client"

const TrainingLoadIndicator = lazy(() =>
  import("@/components/training-load-indicator").then((m) => ({ default: m.TrainingLoadIndicator })),
)
import type { Warning, WarningType } from "@/lib/training-warnings"

/**
 * HomeScreen
 *
 * Reads top to bottom as an answer to three questions, in the order a runner
 * actually asks them:
 *
 *   1. Am I training safely?   → load indicator and warnings
 *   2. What am I working toward, and how much time is left?  → goal cards
 *   3. What have I actually done?  → this week, then the log
 *
 * Composition notes
 * ─────────────────
 * · The week used to be three separate stat cards — three borders, three
 *   shadows and three fills to state one week. It is now a single card with
 *   hairline dividers and a bar per day, which costs a quarter of the ink
 *   and gains a trend.
 * · The goal card leads with days remaining. It is the number that changes
 *   how you train tomorrow; kilometres logged is history.
 * · Every figure is tabular, so nothing shifts as values tick up.
 */

const GREETING_KEYS: Record<ReturnType<typeof greetingKey>, TranslationKey> = {
  morning: "home.goodMorning",
  afternoon: "home.goodAfternoon",
  evening: "home.goodEvening",
}

const WEEKLY_METRIC_KEYS: Record<string, TranslationKey> = {
  distance_km: "goals.weeklyDistance",
  sessions: "goals.trainingSessions",
  duration_minutes: "goals.activeMinutes",
  elevation_m: "goals.elevationGain",
}

/** Local midnight on the Monday of the week containing `d`. */
function mondayOf(d: Date): Date {
  const day = d.getDay()
  const monday = new Date(d)
  monday.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  monday.setHours(0, 0, 0, 0)
  return monday
}

function toDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

interface HomeScreenProps {
  starredGoals: Goal[] // [STAR] goals pinned to home screen
  currentWeekGoals: WeeklyGoal[]
  activities: Activity[]
  weeklySummary: WeeklySummary
  recentActivities: Activity[]
  syncStatus?: SyncStatus
  stravaConnected?: boolean
  onViewActivities: () => void
  onViewGoal: (goal: Goal) => void
  onViewGoals: () => void
  onViewInsights: () => void
  onSelectActivity: (activity: Activity) => void
}

export function HomeScreen({
  starredGoals,
  currentWeekGoals,
  activities,
  weeklySummary,
  recentActivities,
  syncStatus,
  stravaConnected,
  onViewActivities,
  onViewGoal,
  onViewGoals,
  onSelectActivity,
}: HomeScreenProps) {
  const { t, locale } = useI18n()

  const [planBadges, setPlanBadges] = useState<Record<string, { checkpoint: boolean; blockCompleted: boolean }>>({})
  const [warnings, setWarnings] = useState<Warning[]>([])

  // Load proactive training warnings once on mount. Guard against running
  // before the user has logged any activities — the engine needs history.
  useEffect(() => {
    if (activities.length < 7) return
    let cancelled = false
    fetch("/api/warnings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.warnings) return
        setWarnings(data.warnings as Warning[])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [activities.length])

  const handleDismissWarning = async (type: WarningType) => {
    try {
      await fetch("/api/warnings/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      })
    } catch {
      // Network error — the card will still hide locally; next load will
      // re-check and the cooldown only applies if the POST succeeded.
    }
  }

  useEffect(() => {
    if (starredGoals.length === 0) return
    const supabase = createClient()
    supabase
      .from("ai_training_plans")
      .select("goal_id, block_start_date, plan, mid_block_checkpoint")
      .in("goal_id", starredGoals.map((g) => g.id))
      .then(({ data }) => {
        if (!data) return
        const now = new Date()
        const badges: Record<string, { checkpoint: boolean; blockCompleted: boolean }> = {}
        for (const row of data) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const weeks = (row.plan as any)?.weeks
          // Snap to Monday (same as goal-detail-screen) so blockEnd matches the week boundary
          const blockStart = new Date(row.block_start_date)
          blockStart.setHours(0, 0, 0, 0)
          const dow = blockStart.getDay()
          blockStart.setDate(blockStart.getDate() + (dow === 0 ? -6 : 1 - dow))
          const blockEnd = new Date(blockStart)
          blockEnd.setDate(blockEnd.getDate() + (Array.isArray(weeks) ? weeks.length : 0) * 7)
          badges[row.goal_id] = {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            checkpoint: !!(row.mid_block_checkpoint as any)?.adjustmentApplied,
            blockCompleted: Array.isArray(weeks) && weeks.length > 0 && now > blockEnd,
          }
        }
        setPlanBadges(badges)
      })
  }, [starredGoals])

  const today = useMemo(() => new Date(), [])
  const currentMondayStr = useMemo(() => toDateKey(mondayOf(today)), [today])

  /**
   * Distance per day for the current Monday–Sunday week, plus last week's
   * total for the trend. Aligning to the calendar week rather than a
   * trailing 7-day window is what lets the bars sit under M T W T F S S
   * and match the totals printed above them.
   */
  const week = useMemo(() => {
    const monday = mondayOf(today)
    const lastMonday = new Date(monday)
    lastMonday.setDate(monday.getDate() - 7)

    const byDay = new Array<number>(7).fill(0)
    let lastWeekDistance = 0

    for (const a of activities) {
      const d = new Date(a.date)
      if (d >= monday) {
        const index = Math.floor((d.getTime() - monday.getTime()) / 86_400_000)
        if (index >= 0 && index < 7) byDay[index] += a.distance_km
      } else if (d >= lastMonday) {
        lastWeekDistance += a.distance_km
      }
    }

    const thisWeekDistance = weeklySummary.total_distance_km
    // Percentage change is meaningless against a zero baseline, so a week
    // that follows a rest week simply shows no delta rather than "+∞%".
    const deltaPct =
      lastWeekDistance > 0
        ? Math.round(((thisWeekDistance - lastWeekDistance) / lastWeekDistance) * 100)
        : null

    return { byDay, deltaPct }
  }, [activities, today, weeklySummary.total_distance_km])

  // Pre-compute goal metrics outside JSX so we don't run O(goals * activities) on every render
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

  const initials = weekdayInitials(locale)
  const hasWeek = weeklySummary.run_count > 0

  return (
    <div className="flex flex-col gap-6 px-4 pb-8 pt-5">
      {/* ── Masthead ─────────────────────────────────────────────────────
          The wordmark stays as a quiet eyebrow; the greeting and today's
          date carry the line. The old tagline said nothing the screen below
          it did not already say better. */}
      <header>
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-subtle-foreground">
            42195
          </span>
          {syncStatus && stravaConnected && syncStatus.state !== "never" && (
            <div
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                syncStatus.state === "syncing"
                  ? "bg-accent text-primary"
                  : syncStatus.state === "error"
                    ? "bg-destructive-subtle text-destructive"
                    : "bg-success-subtle text-success"
              }`}
            >
              {syncStatus.state === "syncing" && <RefreshCw size={10} className="animate-spin" />}
              {syncStatus.state === "error" && <AlertCircle size={10} />}
              {syncStatus.state === "success" && <CheckCircle2 size={10} />}
              <span>
                {syncStatus.state === "syncing"
                  ? t("profile.syncing")
                  : syncStatus.state === "error"
                    ? t("home.syncFailed")
                    : t("profile.synced")}
              </span>
            </div>
          )}
        </div>
        <h1 className="mt-2 text-2xl font-bold tracking-display text-foreground">
          {t(GREETING_KEYS[greetingKey(today)])}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{fullDateLabel(today, locale)}</p>
      </header>

      {/* Training Load Indicator (Optimal / High Load / Overtraining Risk)
          with embedded proactive warnings rendered as dismissible rows. */}
      {activities.length >= 7 && (
        <Suspense fallback={null}>
          <TrainingLoadIndicator
            activities={activities}
            warnings={warnings}
            onDismissWarning={handleDismissWarning}
          />
        </Suspense>
      )}

      {/* ── Pinned goals ──────────────────────────────────────────────── */}
      {starredGoals.length > 0 ? (
        <section>
          <SectionHeader
            title={t("home.activeGoals")}
            icon={<Star size={11} className="shrink-0 text-warning" fill="currentColor" />}
            meta={starredGoals.length > 1 ? `${starredGoals.length} ${t("home.goals")}` : undefined}
          />
          <Carousel opts={{ align: "start", dragFree: false }}>
            <CarouselContent className="-ml-3">
              {starredGoals.map((goal, i) => {
                const m = goalMetrics[i]
                const badges = planBadges[goal.id]
                const isRaceDay = m.days === 0

                return (
                  <CarouselItem
                    key={goal.id}
                    className={`pl-3 ${starredGoals.length > 1 ? "basis-[90%]" : "basis-full"}`}
                  >
                    <AppCard
                      role="button"
                      tabIndex={0}
                      interactive
                      elevation="lifted"
                      padding="lg"
                      onClick={() => onViewGoal(goal)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          onViewGoal(goal)
                        }
                      }}
                      className="flex h-full flex-col text-left"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-primary">
                          {isRaceDay ? t("home.raceDay") : t("home.activeGoal")}
                        </p>
                        <ChevronRight size={15} className="-mr-1 shrink-0 text-subtle-foreground" />
                      </div>

                      <h3 className="mt-1 text-lg font-semibold leading-tight tracking-display text-balance text-card-foreground">
                        {goal.name}
                      </h3>

                      {(badges?.checkpoint || badges?.blockCompleted) && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {badges.checkpoint && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground">
                              <CheckCircle2 size={9} />
                              {t("home.checkpoint")}
                            </span>
                          )}
                          {badges.blockCompleted && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-success-subtle px-2 py-0.5 text-[10px] font-medium text-success">
                              <CheckCircle2 size={9} />
                              {t("home.blockDone")}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Instrument panel: three figures at equal weight. Days
                          remaining is the one that changes tomorrow's session,
                          so it leads and carries the brand colour. */}
                      <MetricRow className="mt-4 justify-start">
                        <Metric
                          size="lg"
                          emphasis
                          align="center"
                          value={m.days}
                          label={t("home.daysLeft")}
                        />
                        <Metric
                          size="lg"
                          align="center"
                          value={m.logged.toFixed(0)}
                          unit="km"
                          label={t("home.logged")}
                        />
                        <Metric
                          size="lg"
                          align="center"
                          value={goal.target_time_seconds ? formatTargetTime(goal.target_time_seconds) : "—"}
                          label={t("home.target")}
                        />
                      </MetricRow>

                      {/* Block progress. A bar beats a 64px ring here: the
                          same information, legible without a caption inside it. */}
                      <div className="mt-4">
                        <div
                          className="h-1.5 overflow-hidden rounded-full bg-foreground/10"
                          role="progressbar"
                          aria-valuenow={m.timeProgress}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={t("home.ofBlock")}
                        >
                          <div
                            className="h-full rounded-full bg-primary transition-[width] duration-[var(--dur-slow)] ease-[var(--ease-out-quint)]"
                            style={{ width: `${m.timeProgress}%` }}
                          />
                        </div>
                        <p className="mt-1.5 text-[11px] text-subtle-foreground">
                          <span className="tnum font-medium text-muted-foreground">{m.timeProgress}%</span>{" "}
                          {t("home.ofBlock")}
                        </p>
                      </div>
                    </AppCard>
                  </CarouselItem>
                )
              })}
            </CarouselContent>
          </Carousel>
        </section>
      ) : (
        <AppCard padding="lg">
          <p className="text-sm text-muted-foreground">{t("home.noActiveGoals")}</p>
          <button
            onClick={onViewGoals}
            className="press mt-2 rounded-lg text-sm font-semibold text-primary"
          >
            {t("home.setGoal")}
          </button>
        </AppCard>
      )}

      {/* ── This week ─────────────────────────────────────────────────── */}
      <section>
        {/* No "see all" here: the section below already carries one, and two
            identical links a few hundred pixels apart read as a mistake. */}
        <SectionHeader title={t("home.thisWeek")} />
        <AppCard padding="md">
          <MetricRow>
            <Metric
              size="lg"
              align="center"
              value={weeklySummary.total_distance_km.toFixed(1)}
              unit="km"
              label={t("home.km")}
            />
            <Metric
              size="lg"
              align="center"
              value={formatDuration(weeklySummary.total_time_seconds)}
              label={t("home.time")}
            />
            <Metric
              size="lg"
              align="center"
              value={weeklySummary.run_count}
              label={t("home.sessions")}
            />
          </MetricRow>

          <div className="mt-4 border-t border-border pt-3">
            {hasWeek ? (
              <>
                <div className="flex items-end justify-between gap-4">
                  <Sparkline
                    values={week.byDay}
                    height={30}
                    className="min-w-0 flex-1"
                    label={`${t("home.thisWeek")} — ${t("home.km")}`}
                  />
                  {week.deltaPct !== null && (
                    <span
                      className={`tnum shrink-0 text-xs font-semibold ${
                        week.deltaPct >= 0 ? "text-success" : "text-muted-foreground"
                      }`}
                    >
                      {week.deltaPct >= 0 ? "+" : ""}
                      {week.deltaPct}%
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-4">
                  <div aria-hidden className="flex min-w-0 flex-1 gap-[3px]">
                    {initials.map((d, i) => (
                      <span
                        key={i}
                        className="flex-1 text-center text-[9px] font-medium text-subtle-foreground"
                      >
                        {d}
                      </span>
                    ))}
                  </div>
                  {week.deltaPct !== null && (
                    <span className="shrink-0 text-[9px] text-subtle-foreground">
                      {t("home.vsLastWeek")}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <p className="py-1 text-center text-xs text-subtle-foreground">
                {t("home.noRunsThisWeek")}
              </p>
            )}
          </div>
        </AppCard>

        {/* Weekly targets */}
        {currentWeekGoals.length > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-3">
            {currentWeekGoals.slice(0, 3).map((wg) => {
              const current = computeWeeklyProgress(
                activities,
                wg.metric,
                currentMondayStr,
                wg.session_min_duration_minutes,
                wg.session_min_distance_km,
              )
              const progress = progressPercentage(current, wg.target)
              const isComplete = current >= wg.target
              const label = t(WEEKLY_METRIC_KEYS[wg.metric]) || wg.label

              return (
                <button
                  key={wg.id}
                  onClick={onViewGoals}
                  className="press flex flex-col items-center gap-1.5 rounded-xl py-1"
                >
                  <ProgressRing
                    percentage={progress}
                    size={62}
                    strokeWidth={5}
                    tone={isComplete ? "success" : "primary"}
                    valueText={`${label}: ${progress}%`}
                  >
                    <span
                      className={`tnum text-[11px] font-bold leading-none ${
                        isComplete ? "text-success" : "text-foreground"
                      }`}
                    >
                      {progress}%
                    </span>
                  </ProgressRing>
                  <span className="line-clamp-2 px-0.5 text-center text-[10px] leading-tight text-muted-foreground">
                    {label}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Recent activities ─────────────────────────────────────────── */}
      {recentActivities.length > 0 && (
        <section>
          <SectionHeader
            title={t("home.recentActivities")}
            action={{ label: t("home.seeAll"), onClick: onViewActivities }}
          />
          <Carousel opts={{ align: "start", dragFree: true }}>
            <CarouselContent className="-ml-3">
              {recentActivities.map((activity) => (
                <CarouselItem key={activity.id} className="basis-[62%] pl-3">
                  <AppCard
                    role="button"
                    tabIndex={0}
                    interactive
                    padding="md"
                    onClick={() => onSelectActivity(activity)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        onSelectActivity(activity)
                      }
                    }}
                    className="h-full text-left"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-subtle-foreground">
                      {relativeDayLabel(activity.date, locale)}
                    </p>
                    <h3 className="mt-1 truncate text-sm font-semibold text-card-foreground">
                      {activity.name}
                    </h3>
                    <div className="mt-3 flex items-baseline gap-1.5">
                      <span data-metric className="text-xl font-semibold tracking-display text-card-foreground">
                        {activity.distance_km.toFixed(1)}
                      </span>
                      <span className="text-xs font-medium text-subtle-foreground">km</span>
                    </div>
                    <p className="tnum mt-0.5 text-xs text-muted-foreground">
                      {formatDuration(activity.duration_seconds)}
                    </p>
                  </AppCard>
                </CarouselItem>
              ))}
            </CarouselContent>
          </Carousel>
        </section>
      )}

      {activities.length > 0 && <PoweredByStrava className="mt-1" />}
    </div>
  )
}
