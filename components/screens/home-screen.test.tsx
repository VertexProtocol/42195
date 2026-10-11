// @vitest-environment jsdom

import { afterEach, describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n"
import { HomeScreen } from "./home-screen"
import type {
  Activity,
  Goal,
  PlanSessionStatus,
  WeeklyGoal,
  WeeklySummary,
} from "@/lib/types"
import type { CurrentPlanWeek } from "@/lib/plan-today"

/**
 * The "This week" card.
 *
 * Two halves that do not interfere: the week's own three numbers, and the
 * goals the runner has set. The goals used to be bound to the numbers — each
 * one annotating a stat column, unless it measured something narrower, in
 * which case it was exiled to a differently-shaped row below a rule. That
 * arrangement rearranged itself every time a goal was added or removed, and
 * it printed a figure per goal on top of the three already there.
 *
 * A goal is now one lane, in one wrapping row, carrying nothing but its
 * metric icon.
 */

function mondayOfThisWeek(): string {
  const now = new Date()
  const day = now.getDay()
  const mon = new Date(now)
  mon.setDate(now.getDate() + (day === 0 ? -6 : 1 - day))
  const p = (n: number) => String(n).padStart(2, "0")
  return `${mon.getFullYear()}-${p(mon.getMonth() + 1)}-${p(mon.getDate())}`
}

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: crypto.randomUUID(),
    user_id: "user-1",
    strava_id: null,
    type: "Run",
    name: "Run",
    date: mondayOfThisWeek(),
    distance_km: 5,
    duration_seconds: 1800,
    pace_min_per_km: 6,
    elevation_gain_m: 10,
    avg_heart_rate: null,
    avg_cadence: null,
    calories: null,
    created_at: mondayOfThisWeek(),
    ...overrides,
  }
}

function makeGoal(overrides: Partial<WeeklyGoal> = {}): WeeklyGoal {
  return {
    id: crypto.randomUUID(),
    metric: "distance_km",
    label: "",
    target: 10,
    week_start: mondayOfThisWeek(),
    is_recurring: true,
    ...overrides,
  }
}

function summaryOf(activities: Activity[]): WeeklySummary {
  return {
    total_distance_km: activities.reduce((s, a) => s + a.distance_km, 0),
    total_time_seconds: activities.reduce((s, a) => s + a.duration_seconds, 0),
    run_count: activities.length,
  }
}

function renderHome(activities: Activity[], weeklyGoals: WeeklyGoal[]) {
  return render(
    <I18nProvider>
      <HomeScreen
        starredGoals={[]}
        currentWeekGoals={weeklyGoals}
        activities={activities}
        weeklySummary={summaryOf(activities)}
        warnings={[]}
        planBadges={{}}
        onViewGoal={() => {}}
        onViewGoals={() => {}}
        onViewInsights={() => {}}
      />
    </I18nProvider>,
  )
}

/**
 * The rows, one per weekly goal.
 *
 * Each row's bar is a `role="img"` whose accessible name carries the whole
 * reading, so these read the name for the value. The row also prints the
 * goal's name and both figures, because a bare ring with an icon in it did not
 * say what it was measuring.
 */
function lanes(): HTMLElement[] {
  // "current / target" is what makes a weekly lane; a pinned race's lane reads
  // "<name> — elapsed: 40%" and would otherwise be counted here too.
  return screen
    .queryAllByRole("img")
    .filter((el) => / \/ /.test(el.getAttribute("aria-label") ?? ""))
}

const laneNames = () => lanes().map((el) => el.getAttribute("aria-label"))

describe("HomeScreen — one row per weekly goal", () => {
  it("gives every goal a row, whatever mix of metrics they are", () => {
    renderHome(
      [makeActivity(), makeActivity()],
      [
        makeGoal({ metric: "distance_km", target: 10 }),
        makeGoal({ metric: "duration_minutes", target: 60 }),
        makeGoal({ metric: "sessions", target: 2 }),
        makeGoal({ metric: "elevation_m", target: 300 }),
      ],
    )
    expect(lanes()).toHaveLength(4)
  })

  it("gives a second goal on the same metric its own row", () => {
    // These used to compete for one stat column, so the loser was exiled to a
    // different-looking row below a rule.
    renderHome(
      [makeActivity({ distance_km: 4 })],
      [
        makeGoal({ metric: "distance_km", target: 10 }),
        makeGoal({ metric: "distance_km", target: 25, label: "Stretch week" }),
      ],
    )
    expect(laneNames()).toEqual([
      "Weekly distance — 4 km / 10 km: 40%",
      "Stretch week — 4 km / 25 km: 16%",
    ])
  })

  it("says what the goal is and how far along it is, in words", () => {
    renderHome([makeActivity({ distance_km: 4 })], [makeGoal({ metric: "distance_km", target: 10 })])
    expect(screen.getByText("Weekly distance")).toBeTruthy()
    expect(screen.getByText("4 km / 10 km")).toBeTruthy()
  })

  it("gives the targets a heading of their own, not the tail of This week", () => {
    // Two unrelated readings in one card had nothing saying which was which.
    renderHome([makeActivity()], [makeGoal({ metric: "distance_km", target: 10 })])
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)
    expect(headings).toContain("This week")
    expect(headings).toContain("Weekly goals")
  })

  it("drops that section entirely rather than heading an empty card", () => {
    renderHome([makeActivity()], [])
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)
    expect(headings).toContain("This week")
    expect(headings).not.toContain("Weekly goals")
  })

  it("opens Plan on the weekly list, not the race list", () => {
    // Plan opens on races. A weekly goal that leads there has led to a screen
    // its own goal is not on.
    const onViewGoals = vi.fn()
    const onViewWeeklyGoals = vi.fn()
    render(
      <I18nProvider>
        <HomeScreen
          starredGoals={[]}
          currentWeekGoals={[makeGoal({ metric: "distance_km", target: 10 })]}
          activities={[makeActivity()]}
          weeklySummary={summaryOf([makeActivity()])}
          warnings={[]}
          planBadges={{}}
          onViewGoal={() => {}}
          onViewGoals={onViewGoals}
          onViewWeeklyGoals={onViewWeeklyGoals}
          onViewInsights={() => {}}
        />
      </I18nProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: /Weekly distance/ }))
    fireEvent.click(screen.getByRole("button", { name: "See all" }))
    expect(onViewWeeklyGoals).toHaveBeenCalledTimes(2)
    expect(onViewGoals).not.toHaveBeenCalled()
  })

  it("leaves the stat row the same shape whether or not there are goals", () => {
    // Adding and removing goals is what the runner does to this card; the
    // week's own three numbers should not move when they do.
    const bare = renderHome([makeActivity()], [])
    expect(lanes()).toHaveLength(0)
    const withoutGoals = screen.getAllByText(/Distance|Duration|Runs/).map((el) => el.textContent)
    bare.unmount()

    renderHome([makeActivity()], [makeGoal({ metric: "elevation_m", target: 300 })])
    expect(lanes()).toHaveLength(1)
    expect(screen.getAllByText(/Distance|Duration|Runs/).map((el) => el.textContent)).toEqual(
      withoutGoals,
    )
  })
})

describe("HomeScreen — what a lane is measuring", () => {
  it("measures against the same number the stat row shows", () => {
    // Two 5 km runs → 10 of 10 km, so the lane reads as full.
    renderHome(
      [makeActivity({ distance_km: 5 }), makeActivity({ distance_km: 5 })],
      [makeGoal({ metric: "distance_km", target: 10 })],
    )
    expect(laneNames()).toEqual(["Weekly distance — 10 km / 10 km: 100%"])
  })

  it("counts only qualifying sessions when the goal asks for them", () => {
    // Three runs, only one of them 30 minutes or longer. The Runs stat still
    // says 3; this goal is counting something narrower and must say 1.
    renderHome(
      [
        makeActivity({ duration_seconds: 2400 }),
        makeActivity({ duration_seconds: 600 }),
        makeActivity({ duration_seconds: 600 }),
      ],
      [makeGoal({ metric: "sessions", target: 2, session_min_duration_minutes: 30 })],
    )
    expect(laneNames()).toEqual(["Training sessions — 1 / 2: 50%"])
    expect(screen.getByText("Runs")).toBeTruthy()
    expect(screen.getByText("3")).toBeTruthy()
  })

  it("carries a metric no stat reports", () => {
    renderHome(
      [makeActivity({ elevation_gain_m: 120 })],
      [makeGoal({ metric: "elevation_m", target: 300 })],
    )
    expect(laneNames()).toEqual(["Elevation gain — 120 m / 300 m: 40%"])
  })
})

// ---------------------------------------------------------------------------
// The metric icon
// ---------------------------------------------------------------------------

/**
 * The metric icon sits in its goal's row.
 *
 * It has to be in that row and it has to differ per metric, so a glance down
 * the list tells distance from minutes from sessions before the words do.
 */
const iconsIn = (scope: ParentNode, cls: string) =>
  scope.querySelectorAll(`svg.lucide-${cls}`).length

/** The row a goal's bar sits in, so an icon can be located inside it. */
const laneFor = (name: RegExp) =>
  screen
    .getAllByRole("img")
    .find((el) => name.test(el.getAttribute("aria-label") ?? ""))!
    .closest("button")!

describe("HomeScreen — the metric icon sits in its goal's row", () => {
  it("puts a goal's icon in that goal's row", () => {
    renderHome(
      [makeActivity({ distance_km: 4 })],
      [makeGoal({ metric: "distance_km", target: 10 })],
    )
    expect(iconsIn(laneFor(/Weekly distance/), "trending-up")).toBe(1)
  })

  it("uses a different icon per metric rather than one generic mark", () => {
    renderHome(
      [makeActivity()],
      [
        makeGoal({ metric: "distance_km", target: 10 }),
        makeGoal({ metric: "duration_minutes", target: 60 }),
        makeGoal({ metric: "sessions", target: 3 }),
        makeGoal({ metric: "elevation_m", target: 300 }),
      ],
    )
    expect(iconsIn(laneFor(/Weekly distance/), "trending-up")).toBe(1)
    expect(iconsIn(laneFor(/Active minutes/), "clock")).toBe(1)
    expect(iconsIn(laneFor(/Training sessions/), "flame")).toBe(1)
    expect(iconsIn(laneFor(/Elevation gain/), "mountain")).toBe(1)
  })

  it("draws no lane and no icon when there is no goal", () => {
    const { container } = renderHome([makeActivity()], [])
    expect(lanes()).toHaveLength(0)
    expect(iconsIn(container, "trending-up")).toBe(0)
    expect(iconsIn(container, "mountain")).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Pinned goals
// ---------------------------------------------------------------------------

function makeRaceGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: crypto.randomUUID(),
    name: "Oslo Marathon",
    goal_category: "event_training",
    target_distance_km: 42.195,
    target_date: daysFromNow(32),
    target_time_seconds: null,
    start_date: daysFromNow(-60),
    is_active: true,
    is_starred: true,
    display_order: 0,
    created_at: daysFromNow(-60),
    ...overrides,
  } as Goal
}

function daysFromNow(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().split("T")[0]
}

function renderPinned(goals: Goal[]) {
  return render(
    <I18nProvider>
      <HomeScreen
        starredGoals={goals}
        currentWeekGoals={[]}
        activities={[]}
        weeklySummary={summaryOf([])}
        warnings={[]}
        planBadges={{}}
        onViewGoal={() => {}}
        onViewGoals={() => {}}
        onViewInsights={() => {}}
      />
    </I18nProvider>,
  )
}

describe("HomeScreen — pinned goals that have been run", () => {
  it("puts a race that has happened behind one that has not", () => {
    renderPinned([
      makeRaceGoal({ name: "Last spring", target_date: daysFromNow(-120), display_order: 0 }),
      makeRaceGoal({ name: "Still ahead", target_date: daysFromNow(32), display_order: 1 }),
    ])
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(["Still ahead", "Last spring"])
  })

  it("calls a finished race finished rather than the active goal", () => {
    renderPinned([makeRaceGoal({ target_date: daysFromNow(-120) })])
    expect(screen.getByText("Finished")).toBeTruthy()
    expect(screen.queryByText("Active goal")).toBeNull()
  })

  it("counts the days the other way once the date has gone", () => {
    // daysUntil floors at zero, so this used to read "0 days left" for a race
    // four months old — the same as one happening tomorrow.
    renderPinned([makeRaceGoal({ target_date: daysFromNow(-120) })])
    expect(screen.getByText("days ago")).toBeTruthy()
    expect(screen.getByText("120")).toBeTruthy()
    expect(screen.queryByText("days left")).toBeNull()
  })

  it("leaves a race still to come exactly as it was", () => {
    renderPinned([makeRaceGoal({ target_date: daysFromNow(32) })])
    expect(screen.queryByText("Finished")).toBeNull()
    expect(screen.getByText("days left")).toBeTruthy()
    expect(screen.getByText("32")).toBeTruthy()
  })
})

describe("HomeScreen — unpinning a race that is done", () => {
  it("offers to unpin once the date has gone", () => {
    const onUnpinGoal = vi.fn()
    const goal = makeRaceGoal({ target_date: daysFromNow(-120) })
    render(
      <I18nProvider>
        <HomeScreen
          starredGoals={[goal]}
          currentWeekGoals={[]}
          activities={[]}
          weeklySummary={summaryOf([])}
          warnings={[]}
          planBadges={{}}
          onViewGoal={() => {}}
          onViewGoals={() => {}}
          onViewInsights={() => {}}
          onUnpinGoal={onUnpinGoal}
        />
      </I18nProvider>,
    )

    const unpin = screen.getByRole("button", { name: /unpin from today/i })
    fireEvent.click(unpin)
    expect(onUnpinGoal).toHaveBeenCalledWith(goal.id)
  })

  it("does not offer it for a race still to come", () => {
    render(
      <I18nProvider>
        <HomeScreen
          starredGoals={[makeRaceGoal({ target_date: daysFromNow(32) })]}
          currentWeekGoals={[]}
          activities={[]}
          weeklySummary={summaryOf([])}
          warnings={[]}
          planBadges={{}}
          onViewGoal={() => {}}
          onViewGoals={() => {}}
          onViewInsights={() => {}}
          onUnpinGoal={() => {}}
        />
      </I18nProvider>,
    )
    expect(screen.queryByRole("button", { name: /unpin from today/i })).toBeNull()
  })

  it("does not unpin anything on its own", () => {
    const onUnpinGoal = vi.fn()
    renderPinned([makeRaceGoal({ target_date: daysFromNow(-120) })])
    expect(onUnpinGoal).not.toHaveBeenCalled()
    // Without a handler the card is simply not offering it.
    expect(screen.queryByRole("button", { name: /unpin from today/i })).toBeNull()
  })
})

/**
 * The plan's current week, on Today.
 *
 * The plan lived two taps away behind a goal, and arrived only after that
 * screen had fetched it — so the runner deciding what to do this morning had
 * to go and look it up. One session and a count is what belongs here.
 */
function makePlanWeek(overrides: Partial<CurrentPlanWeek> = {}): CurrentPlanWeek {
  const monday = new Date()
  monday.setHours(0, 0, 0, 0)
  monday.setDate(monday.getDate() + (monday.getDay() === 0 ? -6 : 1 - monday.getDay()))
  return {
    goalId: "goal-1",
    weekNumber: 2,
    theme: "Building on the re-entry",
    targetKm: 31,
    weekStart: monday.toISOString(),
    sessions: [
      {
        type: "Long run",
        distance: "10.5 km",
        effort: "Easy, conversational Z2",
        purpose: "Aerobic base",
        suggestedPace: "6:00–6:15 /km",
      },
      {
        type: "Fartlek",
        distance: "7 km",
        effort: "Relaxed surges",
        purpose: "Turnover",
        suggestedPace: "4:24–4:32 /km",
      },
    ],
    ...overrides,
  }
}

function renderWithPlan({
  goals,
  planWeeks,
  activities = [],
  statuses = {},
  onViewGoal = () => {},
}: {
  goals: Goal[]
  planWeeks: Record<string, CurrentPlanWeek>
  activities?: Activity[]
  statuses?: Record<string, Record<string, PlanSessionStatus>>
  onViewGoal?: (goal: Goal) => void
}) {
  return render(
    <I18nProvider>
      <HomeScreen
        starredGoals={goals}
        currentWeekGoals={[]}
        activities={activities}
        weeklySummary={summaryOf(activities)}
        warnings={[]}
        planBadges={{}}
        currentPlanWeeks={planWeeks}
        planSessionStatuses={statuses}
        onViewGoal={onViewGoal}
        onViewGoals={() => {}}
        onViewInsights={() => {}}
      />
    </I18nProvider>,
  )
}

describe("HomeScreen — this week of the training plan", () => {
  it("puts every run still left in the week up to be chosen between", () => {
    const goal = makeRaceGoal({ id: "goal-1" })
    renderWithPlan({ goals: [goal], planWeeks: { "goal-1": makePlanWeek() } })

    expect(screen.getByText("Long run")).toBeTruthy()
    expect(screen.getByText("10.5 km")).toBeTruthy()
    expect(screen.getByText("6:00–6:15 /km")).toBeTruthy()
    expect(screen.getByText("Fartlek")).toBeTruthy()
    expect(screen.getByText("4:24–4:32 /km")).toBeTruthy()
    expect(screen.getByText("0/2 done")).toBeTruthy()
  })

  it("takes a run out of the rail once it has been done", () => {
    // A card for a run already behind them is not something to choose
    // between, and the count above says how many there have been.
    const goal = makeRaceGoal({ id: "goal-1" })
    renderWithPlan({
      goals: [goal],
      planWeeks: { "goal-1": makePlanWeek() },
      activities: [makeActivity({ distance_km: 10.6, pace_min_per_km: 6.1 })],
    })

    expect(screen.getByText("Fartlek")).toBeTruthy()
    expect(screen.queryByText("Long run")).toBeNull()
    expect(screen.getByText("1/2 done")).toBeTruthy()
  })

  it("takes a skipped run out of the rail too", () => {
    const goal = makeRaceGoal({ id: "goal-1" })
    renderWithPlan({
      goals: [goal],
      planWeeks: { "goal-1": makePlanWeek() },
      statuses: { "goal-1": { "W2-1": "skipped" } },
    })

    expect(screen.getByText("Long run")).toBeTruthy()
    expect(screen.queryByText("Fartlek")).toBeNull()
  })

  it("swipes rather than stacks when there is more than one run left", () => {
    const goal = makeRaceGoal({ id: "goal-1" })
    renderWithPlan({ goals: [goal], planWeeks: { "goal-1": makePlanWeek() } })
    expect(screen.getByRole("group", { name: /Left this week/ })).toBeTruthy()
  })

  it("does not make a carousel out of a single remaining run", () => {
    // A rail of one is a lie, the same as it is for the pinned goals.
    const goal = makeRaceGoal({ id: "goal-1" })
    renderWithPlan({
      goals: [goal],
      planWeeks: { "goal-1": makePlanWeek() },
      statuses: { "goal-1": { "W2-1": "skipped" } },
    })
    expect(screen.queryByRole("group", { name: /Left this week/ })).toBeNull()
  })

  it("changes nothing when a session card is tapped", () => {
    // Choosing is done with your legs. Ticking off belongs after the run, on
    // the screen that holds the week — a tap-to-complete on a surface you
    // swipe would fire on the drag.
    const goal = makeRaceGoal({ id: "goal-1" })
    const onViewGoal = vi.fn()
    renderWithPlan({ goals: [goal], planWeeks: { "goal-1": makePlanWeek() }, onViewGoal })

    fireEvent.click(screen.getByText("Long run"))
    expect(onViewGoal).toHaveBeenCalledWith(goal)
    // Still there, still outstanding.
    expect(screen.getByText("0/2 done")).toBeTruthy()
  })

  it("counts a skipped session as answered for", () => {
    const goal = makeRaceGoal({ id: "goal-1" })
    renderWithPlan({
      goals: [goal],
      planWeeks: { "goal-1": makePlanWeek() },
      statuses: { "goal-1": { "W2-0": "skipped", "W2-1": "completed" } },
    })

    expect(screen.getByText(/1 skipped/)).toBeTruthy()
    expect(screen.getByText("Every session this week is accounted for")).toBeTruthy()
  })

  it("opens the goal the week belongs to", () => {
    const goal = makeRaceGoal({ id: "goal-1" })
    const onViewGoal = vi.fn()
    renderWithPlan({ goals: [goal], planWeeks: { "goal-1": makePlanWeek() }, onViewGoal })

    // The session card itself is the way in; there is no separate link.
    fireEvent.click(screen.getByText("Long run"))
    expect(onViewGoal).toHaveBeenCalledWith(goal)
  })

  it("shows the week of the race that is next, not of a race already run", () => {
    // Today answers one question at a time, and it is answered against the
    // nearer race — the same one leading the rail.
    const past = makeRaceGoal({ id: "goal-past", name: "Last spring", target_date: daysFromNow(-120) })
    const next = makeRaceGoal({ id: "goal-1", name: "Still ahead", target_date: daysFromNow(32) })
    renderWithPlan({
      goals: [past, next],
      planWeeks: {
        "goal-1": makePlanWeek(),
        "goal-past": makePlanWeek({ goalId: "goal-past", sessions: [
          { type: "Ghost session", distance: "5 km", effort: "-", purpose: "-" },
        ] }),
      },
    })

    expect(screen.getByText("Long run")).toBeTruthy()
    expect(screen.queryByText("Ghost session")).toBeNull()
    // With more than one race pinned, the plan page says which race its week
    // belongs to, on the same line as the week number.
    expect(screen.getByText(/^Still ahead · Week 2/)).toBeTruthy()
  })

  it("says nothing at all when the goal has no plan", () => {
    renderWithPlan({ goals: [makeRaceGoal({ id: "goal-1" })], planWeeks: {} })
    expect(screen.queryByText("Training plan")).toBeNull()
  })

  it("says nothing when the leading race is already behind them", () => {
    // The block is over with the race; the goal card's own prompt covers it.
    const past = makeRaceGoal({ id: "goal-1", target_date: daysFromNow(-10) })
    renderWithPlan({ goals: [past], planWeeks: { "goal-1": makePlanWeek() } })
    expect(screen.queryByText("Training plan")).toBeNull()
  })
})

/**
 * More than one race pinned, each with a block running.
 *
 * Two axes, because there are two questions: down picks the race, across picks
 * the run. Flattening them into one rail would put a Berlin session next to an
 * Oslo one with nothing but a label between them.
 */
describe("HomeScreen — several races, several plans", () => {
  const oslo = () => makeRaceGoal({ id: "oslo", name: "Oslo", display_order: 0, target_date: daysFromNow(40) })
  const berlin = () => makeRaceGoal({ id: "berlin", name: "Berlin", display_order: 1, target_date: daysFromNow(120) })

  const weekFor = (goalId: string, type: string) =>
    makePlanWeek({
      goalId,
      sessions: [{ type, distance: "10 km", effort: "Easy", purpose: "Base" }],
    })

  it("carries a page for every race with a plan, not only the nearest", () => {
    // Both weeks are in the DOM: the second is a swipe down, not a trip to
    // the goal screen.
    renderWithPlan({
      goals: [oslo(), berlin()],
      planWeeks: { oslo: weekFor("oslo", "OSLO LONG RUN"), berlin: weekFor("berlin", "BERLIN TEMPO") },
    })
    expect(screen.getByText("OSLO LONG RUN")).toBeTruthy()
    expect(screen.getByText("BERLIN TEMPO")).toBeTruthy()
    expect(screen.getAllByRole("heading", { name: "Next run" })).toHaveLength(1)
  })

  it("names the race in one heading that stays put, not once per page", () => {
    // The heading is the still part: it names the race the rail is settled on
    // and nothing else. Sliding a name per page up and out with its runs made
    // the section re-draw itself top to bottom on every swipe.
    renderWithPlan({
      goals: [oslo(), berlin()],
      planWeeks: { oslo: weekFor("oslo", "OSLO LONG RUN"), berlin: weekFor("berlin", "BERLIN TEMPO") },
    })
    expect(screen.getByText(/^Oslo · Week 2/)).toBeTruthy()
    expect(screen.queryByText(/^Berlin · Week 2/)).toBeNull()
  })

  it("changes the name over to the race the runner has swiped to", async () => {
    renderWithPlan({
      goals: [oslo(), berlin()],
      planWeeks: { oslo: weekFor("oslo", "OSLO LONG RUN"), berlin: weekFor("berlin", "BERLIN TEMPO") },
    })

    const rail = screen.getByRole("group", { name: /^Training plans/ })
    // jsdom lays nothing out, so the page height the fade divides by has to be
    // supplied. Any positive number will do — the maths is a ratio.
    Object.defineProperty(rail, "clientHeight", { value: 124, configurable: true })
    rail.scrollTop = 124
    fireEvent.scroll(rail)

    // The fade and the swap are both written on the next frame.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    })

    expect(screen.getByText(/^Berlin · Week 2/)).toBeTruthy()
    expect(screen.queryByText(/^Oslo · Week 2/)).toBeNull()
  })

  it("makes the races swipeable down", () => {
    renderWithPlan({
      goals: [oslo(), berlin()],
      planWeeks: { oslo: weekFor("oslo", "OSLO LONG RUN"), berlin: weekFor("berlin", "BERLIN TEMPO") },
    })
    expect(screen.getByRole("group", { name: "Training plans for 2 races" })).toBeTruthy()
  })

  it("does not make a scroller out of a single race", () => {
    // Today scrolls vertically itself, so a nested vertical scroller is a
    // trap. It is only worth the cost when there is a second race to reach.
    renderWithPlan({ goals: [oslo()], planWeeks: { oslo: weekFor("oslo", "OSLO LONG RUN") } })
    expect(screen.queryByRole("group", { name: /Training plans for/ })).toBeNull()
  })

  it("shows a plan on a race that is not the first one pinned", () => {
    // This used to show nothing at all: the section only ever looked at the
    // nearest race, so a pinned parkrun with no block hid the marathon's.
    renderWithPlan({
      goals: [makeRaceGoal({ id: "parkrun", name: "Parkrun", display_order: 0, target_date: daysFromNow(20) }), berlin()],
      planWeeks: { berlin: weekFor("berlin", "BERLIN TEMPO") },
    })
    expect(screen.getByText("BERLIN TEMPO")).toBeTruthy()
    // One race has a plan, so there is nothing to swipe between — but the page
    // still says whose week it is, because two races are pinned.
    expect(screen.getByText(/^Berlin · Week 2/)).toBeTruthy()
    expect(screen.queryByRole("group", { name: /Training plans for/ })).toBeNull()
  })

  it("leaves out a race whose block is behind it", () => {
    renderWithPlan({
      goals: [berlin(), makeRaceGoal({ id: "last", name: "Last spring", target_date: daysFromNow(-120) })],
      planWeeks: { berlin: weekFor("berlin", "BERLIN TEMPO"), last: weekFor("last", "GHOST SESSION") },
    })
    expect(screen.getByText("BERLIN TEMPO")).toBeTruthy()
    expect(screen.queryByText("GHOST SESSION")).toBeNull()
  })
})

describe("HomeScreen — next steps and recent activity", () => {
  it("opens the coach directly and selects the newest activity by date", () => {
    const onViewCoach = vi.fn()
    const onSelectActivity = vi.fn()
    const older = makeActivity({ name: "Older run", date: "2026-01-01" })
    const newer = makeActivity({ name: "Latest run", date: "2026-02-01" })
    render(<I18nProvider><HomeScreen starredGoals={[]} currentWeekGoals={[]} activities={[older, newer]} weeklySummary={summaryOf([])} warnings={[]} planBadges={{}} onViewGoal={() => {}} onViewGoals={() => {}} onViewInsights={() => {}} onViewCoach={onViewCoach} onSelectActivity={onSelectActivity} /></I18nProvider>)
    fireEvent.click(screen.getByRole("button", { name: /ask your coach/i }))
    expect(onViewCoach).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole("button", { name: /latest run/i }))
    expect(onSelectActivity).toHaveBeenCalledWith(newer)
  })
})


describe("HomeScreen — goals do not require favourites", () => {
  function show(goal: Goal, weeks: Record<string, CurrentPlanWeek> = {}, badges = {}, onViewGoal = vi.fn()) {
    return render(<I18nProvider><HomeScreen goals={[goal]} starredGoals={[]} currentWeekGoals={[]} activities={[]} weeklySummary={summaryOf([])} warnings={[]} planBadges={badges} currentPlanWeeks={weeks} onViewGoal={onViewGoal} onViewGoals={() => {}} onViewInsights={() => {}} /></I18nProvider>)
  }

  it("shows the current plan and its goal without a star", () => {
    const goal = makeRaceGoal({ id: "unstarred", is_starred: false })
    show(goal, { [goal.id]: makePlanWeek() })
    expect(screen.getByText("Long run")).toBeTruthy()
    expect(screen.getByText(goal.name)).toBeTruthy()
    expect(screen.queryByText("Set a goal")).toBeNull()
  })

  it("opens an existing goal when there is no current plan week", () => {
    const goal = makeRaceGoal({ is_starred: false })
    const open = vi.fn()
    show(goal, {}, {}, open)
    fireEvent.click(screen.getByRole("button", { name: "Open plan" }))
    expect(open).toHaveBeenCalledWith(goal)
    expect(screen.queryByText("Set a goal")).toBeNull()
  })

  it("keeps an unstarred goal with a completed block reachable", () => {
    const goal = makeRaceGoal({ is_starred: false })
    show(goal, {}, { [goal.id]: { checkpoint: false, blockCompleted: true } })
    expect(screen.getAllByText(goal.name).length).toBeGreaterThan(0)
    expect(screen.getByRole("button", { name: "Open plan" })).toBeTruthy()
    expect(screen.queryByText("Set a goal")).toBeNull()
  })

  it("does not bring an unstarred past race back onto Today", () => {
    const goal = makeRaceGoal({ is_starred: false, target_date: daysFromNow(-10) })
    show(goal, { [goal.id]: makePlanWeek() }, { [goal.id]: { checkpoint: false, blockCompleted: true } })
    expect(screen.queryByText(goal.name)).toBeNull()
    expect(screen.queryByText("Long run")).toBeNull()
  })
})


describe("HomeScreen — onboarding and plans between blocks", () => {
  afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear() })

  function show(goals: Goal[], badges: Record<string, { checkpoint: boolean; blockCompleted: boolean }> = {}, onViewGoal = vi.fn()) {
    return render(<I18nProvider><HomeScreen goals={goals} starredGoals={[]} currentWeekGoals={[]} activities={[]} weeklySummary={summaryOf([])} warnings={[]} planBadges={badges} onViewGoal={onViewGoal} onViewGoals={() => {}} onViewInsights={() => {}} /></I18nProvider>)
  }

  it("still opens the assessment when a new runner already has a goal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ plan: null, userId: "new-with-goal" }) })))
    show([makeRaceGoal({ is_starred: false })])
    expect(await screen.findByRole("dialog")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Explore first" })).toBeTruthy()
  })

  it.each([true, false])("opens the existing plan without starter onboarding when blockCompleted=%s", (blockCompleted) => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const unrelated = makeRaceGoal({ id: "no-plan", name: "Another race", is_starred: false })
    const planned = makeRaceGoal({ id: "with-plan", name: "Planned race", is_starred: false })
    const open = vi.fn()
    show([unrelated, planned], { [planned.id]: { checkpoint: false, blockCompleted } }, open)
    fireEvent.click(screen.getByRole("button", { name: "Open plan" }))
    expect(open).toHaveBeenCalledWith(planned)
    expect(fetch).not.toHaveBeenCalled()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.queryByText("Set a goal")).toBeNull()
  })
})
