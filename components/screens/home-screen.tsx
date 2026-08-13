"use client"

import {
  useMemo,
  lazy,
  Suspense,
  useState,
  useRef,
  useCallback,
  useEffect,
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
  PlanSessionStatus,
  TrainingSession,
} from "@/lib/types"
import {
  activitiesInPlanWeek,
  summarisePlanWeek,
  type CurrentPlanWeek,
} from "@/lib/plan-today"
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

/**
 * Which card of a horizontal snap rail is under the left edge.
 *
 * Two rails on this screen now — the pinned goals and the week's sessions —
 * and the position dots under each need the same answer. Measured from the
 * DOM rather than tracked as scroll maths, because the cards are sized in
 * percentages and the gap is in rems.
 */
function useSnapRail() {
  const ref = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)

  const onScroll = useCallback(() => {
    const rail = ref.current
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
    setIndex(nearest)
  }, [])

  return { ref, index, onScroll }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

/**
 * A vertical snap rail whose heading is not part of what moves.
 *
 * The horizontal rails let their whole card travel, heading and all, because
 * each card is its own thing. Here the pages are the same thing — a week of
 * runs — belonging to different races, and sliding the race's name up and out
 * with the runs under it made the section feel like it was re-drawing itself
 * on every swipe. The name holds its place and dissolves instead.
 *
 * So this reports two things where the horizontal hook reports one. `index` is
 * which page the rail has settled on, and changes at the halfway mark; the
 * fade is written straight to the heading's style, once per frame, because
 * re-rendering the section on every scroll event to move an opacity would cost
 * more than the effect is worth.
 *
 * The heading is fully transparent exactly where the label swaps, so the swap
 * itself is never seen — the runner sees one name dissolve and another appear,
 * which is the same information arriving without the movement.
 *
 * No CSS transition on the opacity: it is driven by the finger, so easing it
 * would leave the name trailing the swipe rather than answering it. Under
 * reduced motion the fade is dropped entirely and the label simply changes —
 * the information is the same either way, and only the dissolve was motion.
 */
function useFadingVerticalRail(headingRef: React.RefObject<HTMLElement | null>) {
  const ref = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)
  const indexRef = useRef(0)
  const frame = useRef<number | null>(null)

  const onScroll = useCallback(() => {
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const rail = ref.current
      if (!rail) return

      // One page is one rail height, so the scroll position in pages is the
      // scroll position over that. Fractional between two pages.
      const pageHeight = rail.clientHeight
      if (pageHeight <= 0) return
      const position = rail.scrollTop / pageHeight
      const nearest = Math.round(position)

      const heading = headingRef.current
      if (heading && !prefersReducedMotion()) {
        const distance = Math.abs(position - nearest)
        // Gone by the time the label changes, back by the time the next page
        // has settled. Doubling the distance is what closes it early rather
        // than leaving the name half-visible for the whole swipe. The dead
        // zone is so a rail at rest reads at full opacity rather than at the
        // 0.9-something a pixel of drift would leave it at.
        const away = distance < 0.03 ? 0 : Math.min(1, distance * 2)
        heading.style.opacity = String(1 - away)
      }

      if (nearest !== indexRef.current) {
        indexRef.current = nearest
        setIndex(nearest)
      }
    })
  }, [headingRef])

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    [],
  )

  return { ref, index, onScroll }
}

/** The position dots under a horizontal rail. */
function RailDots({ count, index }: { count: number; index: number }) {
  return (
    // Position, not navigation: the cards peek past the edge, and tapping a
    // dot would be a second way to do what the swipe already does.
    <div className="flex justify-center gap-1.5 pt-1" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={`size-1.5 rounded-full ${i === index ? "bg-primary" : "bg-border"}`}
          style={{ transition: "background-color var(--dur-state) var(--ease-out)" }}
        />
      ))}
    </div>
  )
}

/** The same dots stacked, for a rail that runs down instead of across. */
function RailDotsVertical({ count, index }: { count: number; index: number }) {
  return (
    <div
      className="absolute right-0 top-1/2 flex -translate-y-1/2 flex-col gap-1.5"
      aria-hidden
    >
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={`size-1.5 rounded-full ${i === index ? "bg-primary" : "bg-border"}`}
          style={{ transition: "background-color var(--dur-state) var(--ease-out)" }}
        />
      ))}
    </div>
  )
}

/**
 * How tall one race's page is inside the vertical rail.
 *
 * Fixed, because snapping needs pages of a known height, and because a rail
 * whose pages are each as tall as their own content would jump the section's
 * height around as the runner swipes between races. Sized to hold one session
 * card with a two-line effort — the week line and the progress line are not
 * in here, they are the heading that stays put.
 */
const PLAN_PAGE_HEIGHT = "7.75rem"

/**
 * The clear air above and below the settled page.
 *
 * A scroller with no gutter cuts its content on a hard line: the card's shadow
 * is sheared off at the boundary, and the page arriving behind it appears from
 * a straight edge with nothing to soften it. The gutter is where that edge
 * goes instead — the card sits inside it at rest, and the mask below dissolves
 * exactly this band, so a page leaves by fading out rather than by being
 * sliced.
 *
 * `scroll-padding` matches it, so snapping still lands the page against the
 * top of the clear air rather than the top of the box.
 */
const PLAN_RAIL_GUTTER = "0.625rem"

/** Fades the gutter at each end, leaving the settled page untouched. */
const PLAN_RAIL_MASK = `linear-gradient(to bottom, transparent 0, #000 ${PLAN_RAIL_GUTTER}, #000 calc(100% - ${PLAN_RAIL_GUTTER}), transparent 100%)`

/** The same, across, for the rail of sessions inside a page. */
const PLAN_RAIL_MASK_X = `linear-gradient(to right, transparent 0, #000 ${PLAN_RAIL_GUTTER}, #000 calc(100% - ${PLAN_RAIL_GUTTER}), transparent 100%)`

/**
 * One race's training week: the runs still left in it, side by side.
 *
 * The plan lives on the goal's screen and always will. What belongs here is
 * the decision the countdown leads to: of the runs this week is made of, which
 * one am I going out for now. So they are a rail — one card each, swiped
 * through — rather than a single "next up", which answered a question the plan
 * had not been asked. A plan week is a set of sessions and a volume; it names
 * no days, because the runner arranges them around their own life, and picking
 * one for them would be the app inventing a commitment the plan never made.
 *
 * Only the outstanding ones are in the rail. A card for a run already done is
 * not something to choose between, and the count above says how many there
 * have been.
 *
 * Nothing in the rail changes anything. Choosing is done with your legs, and
 * ticking a session off belongs after the run, on the screen that holds the
 * week — a tap-to-complete on a surface you swipe would fire on the drag.
 */
interface PlanPage {
  goal: Goal
  week: CurrentPlanWeek
  /** The runs still to be chosen between, in the order the plan wrote them. */
  outstanding: TrainingSession[]
  done: number
  skipped: number
  total: number
}

/**
 * One race's remaining runs, side by side.
 *
 * The plan lives on the goal's screen and always will. What belongs here is
 * the decision the countdown leads to: of the runs this week is made of, which
 * one am I going out for now. So they are a rail — one card each, swiped
 * through — rather than a single "next up", which answered a question the plan
 * had not been asked. A plan week is a set of sessions and a volume; it names
 * no days, because the runner arranges them around their own life, and picking
 * one for them would be the app inventing a commitment the plan never made.
 *
 * Only the outstanding ones are here. A card for a run already done is not
 * something to choose between, and the count in the heading says how many
 * there have been.
 *
 * Nothing in the rail changes anything. Choosing is done with your legs, and
 * ticking a session off belongs after the run, on the screen that holds the
 * week — a tap-to-complete on a surface you swipe would fire on the drag.
 */
function PlanSessionRail({
  page,
  onOpen,
  t,
}: {
  page: PlanPage
  onOpen: () => void
  t: (key: TranslationKey, params?: TranslationParams) => string
}) {
  const { ref: railRef, index: railIndex, onScroll: onRailScroll } = useSnapRail()
  const isRail = page.outstanding.length > 1

  if (page.outstanding.length === 0) {
    return (
      <AppCard className="h-full">
        <p className="text-label font-semibold text-card-foreground">
          {t("home.planWeekSettled")}
        </p>
        <p className="mt-0.5 text-micro text-muted-foreground">{t("home.planWeekSettledBody")}</p>
      </AppCard>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div
        ref={railRef}
        onScroll={isRail ? onRailScroll : undefined}
        role={isRail ? "group" : undefined}
        aria-label={isRail ? `${page.goal.name} — ${t("home.planOutstanding")}` : undefined}
        className={
          isRail
            ? // No bleed past the screen edge here, unlike the goal rail: this
              // one sits inside a vertical scroller, and a container that
              // scrolls on one axis clips the other. The cards are narrow
              // enough that the next one peeks anyway.
              "flex min-h-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto"
            : "flex min-h-0 flex-1 flex-col"
        }
        // Same clear air as the vertical rail, on the other axis: a card
        // leaving the right-hand edge fades into the gutter rather than being
        // cut down its side.
        style={
          isRail
            ? {
                paddingInline: PLAN_RAIL_GUTTER,
                marginInline: `calc(${PLAN_RAIL_GUTTER} * -1)`,
                scrollPaddingInline: PLAN_RAIL_GUTTER,
                maskImage: PLAN_RAIL_MASK_X,
                WebkitMaskImage: PLAN_RAIL_MASK_X,
              }
            : undefined
        }
      >
        {page.outstanding.map((session, i) => (
          <div key={i} className={isRail ? "w-[78%] shrink-0 snap-start" : undefined}>
            <button
              onClick={onOpen}
              // `h-full` so two cards side by side end level even when one has
              // a longer effort line than the other.
              className="press surface flex h-full w-full flex-col p-4 text-left"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-lead font-semibold text-card-foreground">
                  {session.type}
                </span>
                <span className="measure shrink-0 text-label font-semibold text-primary">
                  {session.distance}
                </span>
              </div>

              {/* The pace target when there is one — hill repeats have none,
                  because uphill pace is set by the hill and not by fitness. */}
              {session.suggestedPace && (
                <span className="measure mt-1 text-micro text-primary/70">
                  {session.suggestedPace}
                </span>
              )}

              <p className="mt-1.5 line-clamp-2 text-micro leading-relaxed text-muted-foreground">
                {session.effort}
              </p>
            </button>
          </div>
        ))}
      </div>

      {isRail && <RailDots count={page.outstanding.length} index={railIndex} />}
    </div>
  )
}

/**
 * The training plan on Today, when there is more than one race pinned.
 *
 * Two axes, because there are two questions and they are not the same one:
 * down moves between races, across moves between the runs left in that race's
 * week. A runner training for two events is choosing a race first and a
 * session second, and flattening that into one rail would put a Berlin session
 * next to an Oslo one with nothing but a label between them.
 *
 * What moves is the runs. The race's name, its week and how much of that week
 * is behind them hold their place above the rail and dissolve from one race's
 * figures into the next as the runner swipes. Sliding the heading out with the
 * content made a section three lines tall re-draw itself top to bottom on
 * every swipe, for a name that had moved one row down the page.
 *
 * The vertical rail only becomes a scroller when there is a second race to
 * reach. Today is itself a vertically scrolling page, and a vertical scroller
 * inside one is a trap: a thumb that lands here moves the section instead of
 * the page. Three things keep that survivable — it is off entirely for a
 * single race, a page is exactly one card tall so there is little of it to
 * catch, and scroll chaining is left on, so reaching the end of the rail hands
 * the gesture back to the page rather than swallowing it.
 *
 * A race with no plan is not a page. There is nothing to choose between under
 * one, and the goal's own card already carries the prompt to generate a block.
 * This is also what fixes the case where a pinned race without a plan, sorted
 * first, hid the plan of the race behind it.
 */
function PlanSection({
  plans,
  activities,
  planSessionStatuses,
  nameGoals,
  onViewGoal,
  t,
}: {
  plans: { goal: Goal; week: CurrentPlanWeek }[]
  activities: Activity[]
  planSessionStatuses: Record<string, Record<string, PlanSessionStatus>>
  /**
   * Name the race in the heading even when there is only one page. True as
   * soon as more than one race is pinned: with two on the screen above and one
   * plan below, an unnamed week is a week the runner has to guess the owner
   * of.
   */
  nameGoals: boolean
  onViewGoal: (goal: Goal) => void
  t: (key: TranslationKey, params?: TranslationParams) => string
}) {
  // Every page's figures, worked out together. They used to be worked out
  // inside each page, which is where they belonged while the heading travelled
  // with the page — now the heading needs the figures of whichever page the
  // rail has settled on, so they are held one level up.
  const pages = useMemo<PlanPage[]>(
    () =>
      plans.map(({ goal, week }) => {
        const progress = summarisePlanWeek(
          week,
          activitiesInPlanWeek(activities, week.weekStart),
          planSessionStatuses[goal.id] ?? {},
        )
        return {
          goal,
          week,
          outstanding: week.sessions.filter((_, i) => progress.statuses[i] === "planned"),
          done: progress.done,
          skipped: progress.skipped,
          total: progress.total,
        }
      }),
    [plans, activities, planSessionStatuses],
  )

  const headingRef = useRef<HTMLDivElement>(null)
  const { ref: railRef, index: pageIndex, onScroll: onRailScroll } = useFadingVerticalRail(headingRef)
  const isPaged = pages.length > 1

  // Clamped, because a plan can drop out of the list — a block ending, a goal
  // unpinned — while the rail is sitting on it.
  const current = pages[Math.min(pageIndex, pages.length - 1)] ?? pages[0]

  // Skipped counts as settled, the same as it does in the plan's own week
  // header: the runner has answered for it, so it is not still ahead of them.
  const settled = current.done + current.skipped
  const filled = current.total > 0 ? Math.round((settled / current.total) * 100) : 0
  const countText =
    t("home.planSessionsDone", { done: current.done, total: current.total }) +
    (current.skipped > 0
      ? ` · ${t("home.planSessionsSkipped", { skipped: current.skipped })}`
      : "")

  return (
    <Section>
      <SectionHeader
        title={t("home.planThisWeek")}
        action={
          <SectionAction onClick={() => onViewGoal(current.goal)}>
            {t("home.planSeeWeek")}
          </SectionAction>
        }
      />

      {/* The heading that stays put. Not in a card — the cards below are the
          content, and a card around the lot would be a card holding cards. */}
      <div
        ref={headingRef}
        className="flex flex-col gap-1.5"
        // Only the swap is announced, not every frame of the fade.
        aria-live="polite"
        aria-atomic
        style={{ willChange: isPaged ? "opacity" : undefined }}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-micro font-semibold text-primary">
            {isPaged || nameGoals ? `${current.goal.name} · ` : ""}
            {t("home.planWeek", { week: current.week.weekNumber })}
            {current.week.theme ? ` · ${current.week.theme}` : ""}
          </span>
          <span className="measure shrink-0 text-micro text-muted-foreground">{countText}</span>
        </div>
        <div
          className="h-1 overflow-hidden rounded-full bg-surface-sunken"
          role="img"
          aria-label={`${current.goal.name} — ${t("home.planSessionsDone", {
            done: current.done,
            total: current.total,
          })}`}
        >
          <div
            className={`h-full rounded-full ${
              current.outstanding.length > 0 ? "bg-primary" : "bg-success"
            }`}
            style={{ width: `${filled}%`, transition: "width var(--dur-state) var(--ease-out)" }}
          />
        </div>
      </div>

      {/* The focus ring belongs out here rather than on the scroller: the mask
          that softens the scroller's ends would fade the ring along with the
          content, and a focus indicator that dissolves at both ends is not
          one. `-m-1 p-1` is the room it needs to sit outside the rail. */}
      <div className="relative -m-1 rounded-md p-1 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
        <div
          ref={railRef}
          onScroll={isPaged ? onRailScroll : undefined}
          // Focusable so the rail is reachable by keyboard, where a scroll
          // container with no tab stop is not.
          tabIndex={isPaged ? 0 : undefined}
          role={isPaged ? "group" : undefined}
          aria-label={isPaged ? t("home.planRaces", { count: pages.length }) : undefined}
          className={isPaged ? "snap-y snap-mandatory overflow-y-auto pr-5 outline-none" : undefined}
          style={
            isPaged
              ? {
                  // The window is a page plus its clear air at each end.
                  height: `calc(${PLAN_PAGE_HEIGHT} + ${PLAN_RAIL_GUTTER} * 2)`,
                  paddingBlock: PLAN_RAIL_GUTTER,
                  scrollPaddingBlock: PLAN_RAIL_GUTTER,
                  maskImage: PLAN_RAIL_MASK,
                  WebkitMaskImage: PLAN_RAIL_MASK,
                }
              : undefined
          }
        >
          {pages.map((page) => (
            <div
              key={page.goal.id}
              className={isPaged ? "snap-start" : undefined}
              style={isPaged ? { height: PLAN_PAGE_HEIGHT } : undefined}
            >
              <PlanSessionRail page={page} onOpen={() => onViewGoal(page.goal)} t={t} />
            </div>
          ))}
        </div>

        {isPaged && <RailDotsVertical count={pages.length} index={pageIndex} />}
      </div>
    </Section>
  )
}

interface HomeScreenProps {
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
  /**
   * The week each goal's training plan is in, keyed by goal id, trimmed to the
   * sessions on the server. Only the leading pinned goal's week is shown —
   * Today answers one question at a time, and a runner with two races pinned
   * is deciding today's run against the nearer of them.
   */
  currentPlanWeeks?: Record<string, CurrentPlanWeek>
  /** Manual session statuses per goal, keyed `W3-1`. Seeded by the page render. */
  planSessionStatuses?: Record<string, Record<string, PlanSessionStatus>>
  syncStatus?: SyncStatus
  stravaConnected?: boolean
  onViewActivities: () => void
  onViewGoal: (goal: Goal) => void
  /** Unpins a goal from this screen. Offered only once its date has gone. */
  onUnpinGoal?: (goalId: string) => void
  onViewGoals: () => void
  /**
   * Plan, opened on the weekly list. A weekly goal that leads to the race list
   * has led somewhere the goal is not, which is what the tap used to do.
   */
  onViewWeeklyGoals?: () => void
  onViewInsights: () => void
  onSelectActivity: (activity: Activity) => void
}

export function HomeScreen({
  starredGoals,
  currentWeekGoals,
  activities,
  weeklySummary,
  recentActivities,
  warnings,
  planBadges,
  currentPlanWeeks,
  planSessionStatuses,
  onViewActivities,
  onViewGoal,
  onViewGoals,
  onViewWeeklyGoals,
  onSelectActivity,
  onUnpinGoal,
}: HomeScreenProps) {
  const { t } = useI18n()

  // Falls back to Plan's own default rather than doing nothing, so a caller
  // that has not wired the weekly route still opens something.
  const openWeeklyGoals = onViewWeeklyGoals ?? onViewGoals

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
  const {
    ref: goalRailRef,
    index: goalRailIndex,
    onScroll: onGoalRailScroll,
  } = useSnapRail()

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

  // Every pinned race that has a plan running this week, nearest race first —
  // the same order the goal cards are in. A race already run is left out: its
  // block ended with it, and what is left to say about it is on its own card.
  const planPages = useMemo(
    () =>
      orderedGoals.flatMap((goal, i) => {
        if (goalMetrics[i]?.past) return []
        const week = currentPlanWeeks?.[goal.id]
        return week ? [{ goal, week }] : []
      }),
    [orderedGoals, goalMetrics, currentPlanWeeks],
  )

  return (
    <div className="flex flex-col gap-7 px-4 pb-8 screen-body">
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
            ref={goalRailRef}
            onScroll={isGoalRail ? onGoalRailScroll : undefined}
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

          {isGoalRail && <RailDots count={orderedGoals.length} index={goalRailIndex} />}
        </Section>
      ) : (
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

      {/* ── What there is to run ──────────────────────────────────────── */}
      {/* Directly under the countdown, because it is the decision the
          countdown leads to. Everything below this point is a report on what
          has already happened. */}
      {planPages.length > 0 && (
        <PlanSection
          plans={planPages}
          activities={activities}
          planSessionStatuses={planSessionStatuses ?? {}}
          nameGoals={starredGoals.length > 1}
          onViewGoal={onViewGoal}
          t={t}
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
            action={
              <SectionAction onClick={openWeeklyGoals}>{t("home.seeAll")}</SectionAction>
            }
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
                onOpen={openWeeklyGoals}
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
