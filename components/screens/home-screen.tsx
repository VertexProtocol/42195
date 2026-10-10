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
import { ChevronRight, StarOff } from "lucide-react"
import { PoweredByStrava } from "@/components/strava-brand"
import {
  formatDuration,
  formatDateShort,
  daysUntil,
  isDatePast,
  daysSince,
  formatTargetTime,
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
 * A weekly goal, as one row of the week's goals.
 *
 * The way a game lists the day's quests: what the goal is, a bar for how far
 * along it is, and the two numbers. A row of bare rings said none of that —
 * an empty ring with an icon in it read as a button, not as "4 of 10 km".
 *
 * The bar is a `role="img"` whose name carries the whole reading, so a screen
 * reader hears the same thing the eye gets from the bar and the figures.
 */
function WeeklyGoalRow({
  goal,
  current,
  onOpen,
  t,
}: {
  goal: WeeklyGoal
  current: number
  onOpen: () => void
  t: (key: TranslationKey, params?: TranslationParams) => string
}) {
  const Icon = WEEKLY_METRIC_ICONS[goal.metric]
  const isComplete = current >= goal.target
  const label = goal.label || t(WEEKLY_METRIC_LABEL_KEYS[goal.metric])
  const pct = progressPercentage(current, goal.target)
  const valueText = `${formatWeeklyMetric(current, goal.metric)} / ${formatWeeklyMetric(
    goal.target,
    goal.metric,
  )}`
  return (
    <CardRow className="p-0">
      <button onClick={onOpen} className="press flex w-full items-center gap-3 px-4 py-3 text-left">
        <span
          className={`flex size-8 shrink-0 items-center justify-center ${
            isComplete
              ? "text-success"
              : "text-muted-foreground"
          }`}
          aria-hidden
        >
          <Icon size={18} strokeWidth={2.4} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-label font-extrabold text-card-foreground">{label}</span>
            <span
              className={`measure shrink-0 text-micro font-bold ${
                isComplete ? "text-success" : "text-muted-foreground"
              }`}
            >
              {valueText}
            </span>
          </div>
          <div
            role="img"
            aria-label={`${label} — ${valueText}: ${pct}%`}
            className="h-3 overflow-hidden rounded-full bg-surface-sunken"
          >
            <div
              className={`grow-x h-full rounded-full ${isComplete ? "bg-success" : "bg-primary"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </button>
    </CardRow>
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
                <span className="truncate text-lead font-extrabold text-card-foreground">
                  {session.type}
                </span>
                <span className="measure shrink-0 text-lead font-bold text-primary">
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
      <SectionHeader title={t("home.nextRun")} />

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
          className="h-3 overflow-hidden rounded-full bg-surface-sunken"
          role="img"
          aria-label={`${current.goal.name} — ${t("home.planSessionsDone", {
            done: current.done,
            total: current.total,
          })}`}
        >
          <div
            className={`grow-x h-full rounded-full ${
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
  onViewGoal: (goal: Goal) => void
  /** Unpins a goal from this screen. Offered only once its date has gone. */
  onUnpinGoal?: (goalId: string) => void
  onViewGoals: () => void
  /**
   * Plan, opened on the weekly list. A weekly goal that leads to the race list
   * has led somewhere the goal is not, which is what the tap used to do.
   */
  onViewWeeklyGoals?: () => void
  onViewCoach?: () => void
  onSelectActivity?: (activity: Activity) => void
  onViewInsights: () => void
}

export function HomeScreen({
  starredGoals,
  currentWeekGoals,
  activities,
  weeklySummary,
  warnings,
  currentPlanWeeks,
  planSessionStatuses,
  onViewGoal,
  onViewGoals,
  onViewWeeklyGoals,
  onUnpinGoal,
  onViewCoach,
  onViewInsights,
  onSelectActivity,
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
      orderedGoals.flatMap((goal) => {
        if (isDatePast(goal.target_date)) return []
        const week = currentPlanWeeks?.[goal.id]
        return week ? [{ goal, week }] : []
      }),
    [orderedGoals, currentPlanWeeks],
  )

  const latestActivity = useMemo(() => activities.reduce<Activity | null>(
    (latest, activity) => !latest || activity.date > latest.date ? activity : latest,
    null,
  ), [activities])

  return (
    <div className="stagger flex flex-col gap-7 px-4 pb-8 screen-body">
      {planPages.length === 0 && (
        <div className="py-2">
          <h2 className="text-screen font-semibold">{t("home.startTitle")}</h2>
          <p className="mt-2 max-w-prose text-body text-muted-foreground">{t("home.startBody")}</p>
          <Button className="mt-4" onClick={onViewGoals}>{t("home.setGoal")}</Button>
        </div>
      )}
      {/* ── What there is to run ──────────────────────────────────────── */}
      {/* Current training leads; historical goals stay below the week. */}
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

      {/* ── What the week is aiming at ────────────────────────────────── */}
      {/* Ahead of the week's totals: the goals are what there is still to do,
          the totals are a report on what has been done. */}
      {weeklyLaps.length > 0 && (
        <Section>
          <SectionHeader
            title={t("home.weeklyTargets")}
            action={
              <SectionAction onClick={openWeeklyGoals}>{t("home.seeAll")}</SectionAction>
            }
          />
          <AppCard variant="rows">
            {weeklyLaps.map(({ goal, current }) => (
              <WeeklyGoalRow
                key={goal.id}
                goal={goal}
                current={current}
                onOpen={openWeeklyGoals}
                t={t}
              />
            ))}
          </AppCard>
        </Section>
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

      {orderedGoals.some((goal) => !isDatePast(goal.target_date)) && <Section>
        {orderedGoals.some((goal) => !isDatePast(goal.target_date)) && (
          <SectionHeader title={t("home.activeGoals")} action={<SectionAction onClick={onViewGoals}>{t("home.seeAll")}</SectionAction>} />
        )}
        <div className="flex flex-col gap-3">
          {orderedGoals.filter((goal) => !isDatePast(goal.target_date)).map((goal, i) => {
            return (
              <button key={goal.id} onClick={() => onViewGoal(goal)} className={`press flex w-full items-center justify-between gap-4 text-left ${i === 0 ? "surface p-5" : "border-b border-border py-3"}`}>
                <div className="min-w-0">
                  <h3 className="text-title font-semibold">{goal.name}</h3>
                  {goal.target_time_seconds ? <p className="mt-1 text-label text-muted-foreground">{t("home.target")} <span className="measure">{formatTargetTime(goal.target_time_seconds)}</span></p> : null}
                </div>
                <div className="shrink-0 text-right">
                  <p className="measure text-title font-semibold">{daysUntil(goal.target_date)}</p>
                  <p className="text-micro text-muted-foreground">{t("home.daysLeft")}</p>
                </div>
              </button>
            )
          })}
        </div>
      </Section>}
      <button onClick={onViewCoach ?? onViewInsights} className="press flex min-h-14 items-center justify-between gap-3 border-y border-border py-4 text-left">
        <span><span className="block text-body font-semibold">{t("insights.askCoach")}</span><span className="text-label text-muted-foreground">{t("insights.coachDesc")}</span></span>
        <ChevronRight size={18} className="shrink-0 text-muted-foreground" aria-hidden />
      </button>

      {latestActivity && onSelectActivity && (
        <Section>
          <SectionHeader title={t("home.latestRun")} />
          <button onClick={() => onSelectActivity(latestActivity)} className="press flex w-full items-center justify-between gap-3 py-3 text-left">
            <span className="min-w-0"><span className="block text-body font-semibold">{latestActivity.name}</span><span className="text-label text-muted-foreground">{formatDateShort(latestActivity.date)} · {formatDuration(latestActivity.duration_seconds)}</span></span>
            <span className="measure shrink-0 text-body">{Number(latestActivity.distance_km).toFixed(1)} km</span>
          </button>
        </Section>
      )}

      {orderedGoals.some((goal) => isDatePast(goal.target_date)) && (
        <Section>
          <SectionHeader title={t("home.pastGoals")} />
          <div className="divide-y divide-border">
            {orderedGoals.filter((goal) => isDatePast(goal.target_date)).map((goal) => (
              <div key={goal.id} className="flex items-center gap-2 py-2">
                <button onClick={() => onViewGoal(goal)} className="press min-h-12 min-w-0 flex-1 text-left">
                  <h3 className="text-body font-semibold">{goal.name}</h3>
                  <p className="text-label text-muted-foreground"><span>{t("home.finishedGoal")}</span> · <span>{daysSince(goal.target_date)}</span> <span>{t("home.daysAgo")}</span></p>
                </button>
                {onUnpinGoal && <button onClick={() => onUnpinGoal(goal.id)} className="press flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-sunken" aria-label={t("home.unpinFinished")}><StarOff size={17} aria-hidden /></button>}
              </div>
            ))}
          </div>
        </Section>
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

      {activities.length > 0 && <PoweredByStrava className="pt-1" />}
    </div>
  )
}
