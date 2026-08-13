// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
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
    current: 0,
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
        recentActivities={activities.slice(0, 5)}
        warnings={[]}
        planBadges={{}}
        onViewActivities={() => {}}
        onViewGoal={() => {}}
        onViewGoals={() => {}}
        onViewInsights={() => {}}
        onSelectActivity={() => {}}
      />
    </I18nProvider>,
  )
}

/**
 * The lanes, one per weekly goal.
 *
 * A lane is a `role="img"` rather than a progressbar — it draws its value
 * instead of exposing a numeric range — so its accessible name is where both
 * figures live, and these read the name for the value. Nothing on the card
 * prints them.
 */
function lanes(): HTMLElement[] {
  // "current / target" is what makes a weekly lane; a pinned race's lane reads
  // "<name> — elapsed: 40%" and would otherwise be counted here too.
  return screen
    .queryAllByRole("img")
    .filter((el) => / \/ /.test(el.getAttribute("aria-label") ?? ""))
}

const laneNames = () => lanes().map((el) => el.getAttribute("aria-label"))

describe("HomeScreen — one lane per weekly goal", () => {
  it("gives every goal a lane, whatever mix of metrics they are", () => {
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

  it("gives a second goal on the same metric its own lane", () => {
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

  it("prints no figures or labels of its own", () => {
    // The whole point of the lane: Today asks how far along a goal is, and the
    // fill answers it. The numbers are a tap away under Targets.
    renderHome([makeActivity({ distance_km: 4 })], [makeGoal({ metric: "distance_km", target: 10 })])
    expect(screen.queryByText(/of 10 km/)).toBeNull()
    expect(screen.queryByText(/4 km \/ 10 km/)).toBeNull()
    expect(screen.queryByText("Weekly distance")).toBeNull()
  })

  it("gives the targets a heading of their own, not the tail of This week", () => {
    // Two unrelated readings in one card had nothing saying which was which.
    renderHome([makeActivity()], [makeGoal({ metric: "distance_km", target: 10 })])
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)
    expect(headings).toContain("This week")
    expect(headings).toContain("Targets")
  })

  it("drops that section entirely rather than heading an empty card", () => {
    renderHome([makeActivity()], [])
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)
    expect(headings).toContain("This week")
    expect(headings).not.toContain("Targets")
  })

  it("sizes the lanes by how many are sharing the row", () => {
    // They divide the width between them, so a fixed size makes a row of two
    // into two small marks with a screen of nothing beside them.
    const two = renderHome(
      [makeActivity()],
      [
        makeGoal({ metric: "distance_km", target: 10 }),
        makeGoal({ metric: "sessions", target: 3 }),
      ],
    )
    const heightOfTwo = Number.parseFloat(lanes()[0].style.height)
    two.unmount()

    renderHome(
      [makeActivity()],
      [
        makeGoal({ metric: "distance_km", target: 10 }),
        makeGoal({ metric: "sessions", target: 3 }),
        makeGoal({ metric: "duration_minutes", target: 60 }),
        makeGoal({ metric: "elevation_m", target: 300 }),
      ],
    )
    expect(Number.parseFloat(lanes()[0].style.height)).toBeLessThan(heightOfTwo)
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
          recentActivities={[]}
          warnings={[]}
          planBadges={{}}
          onViewActivities={() => {}}
          onViewGoal={() => {}}
          onViewGoals={onViewGoals}
          onViewWeeklyGoals={onViewWeeklyGoals}
          onViewInsights={() => {}}
          onSelectActivity={() => {}}
        />
      </I18nProvider>,
    )

    fireEvent.click(screen.getByTitle(/Weekly distance/))
    fireEvent.click(screen.getByRole("button", { name: "See all" }))
    expect(onViewWeeklyGoals).toHaveBeenCalledTimes(2)
    expect(onViewGoals).not.toHaveBeenCalled()
  })

  it("draws a track that survives the page background", () => {
    // surface-sunken is a well in a card and is 0.035 off the page in
    // lightness. On the page, a goal at 0% would be an icon with no ring.
    renderHome([], [makeGoal({ metric: "distance_km", target: 10 })])
    expect(lanes()[0].querySelector("rect")?.getAttribute("stroke")).toBe("var(--border)")
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
 * The metric icon rides inside the lane.
 *
 * With no text on the card, the icon is the only thing saying which goal a
 * lane belongs to — so it has to be inside that lane and it has to differ per
 * metric. An icon beside a lane, or one generic mark on all of them, is the
 * shape this replaced.
 */
const iconsIn = (scope: ParentNode, cls: string) =>
  scope.querySelectorAll(`svg.lucide-${cls}`).length

/** The lane element itself, so an icon can be located inside one. */
const laneFor = (name: RegExp) =>
  screen
    .getAllByRole("img")
    .find((el) => name.test(el.getAttribute("aria-label") ?? ""))!

describe("HomeScreen — the metric icon rides inside the lane", () => {
  it("puts a goal's icon inside that goal's lane", () => {
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
        recentActivities={[]}
        warnings={[]}
        planBadges={{}}
        onViewActivities={() => {}}
        onViewGoal={() => {}}
        onViewGoals={() => {}}
        onViewInsights={() => {}}
        onSelectActivity={() => {}}
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
    expect(screen.getByText("Active goal")).toBeTruthy()
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
          recentActivities={[]}
          warnings={[]}
          planBadges={{}}
          onViewActivities={() => {}}
          onViewGoal={() => {}}
          onViewGoals={() => {}}
          onViewInsights={() => {}}
          onSelectActivity={() => {}}
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
          recentActivities={[]}
          warnings={[]}
          planBadges={{}}
          onViewActivities={() => {}}
          onViewGoal={() => {}}
          onViewGoals={() => {}}
          onViewInsights={() => {}}
          onSelectActivity={() => {}}
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
        recentActivities={[]}
        warnings={[]}
        planBadges={{}}
        currentPlanWeeks={planWeeks}
        planSessionStatuses={statuses}
        onViewActivities={() => {}}
        onViewGoal={onViewGoal}
        onViewGoals={() => {}}
        onViewInsights={() => {}}
        onSelectActivity={() => {}}
      />
    </I18nProvider>,
  )
}

describe("HomeScreen — this week of the training plan", () => {
  it("names the next session outstanding, with its distance and pace", () => {
    const goal = makeRaceGoal({ id: "goal-1" })
    renderWithPlan({ goals: [goal], planWeeks: { "goal-1": makePlanWeek() } })

    expect(screen.getByText("Long run")).toBeTruthy()
    expect(screen.getByText("10.5 km")).toBeTruthy()
    expect(screen.getByText("6:00–6:15 /km")).toBeTruthy()
    expect(screen.getByText("0/2 done")).toBeTruthy()
  })

  it("moves on to the next session once one has been run", () => {
    const goal = makeRaceGoal({ id: "goal-1" })
    renderWithPlan({
      goals: [goal],
      planWeeks: { "goal-1": makePlanWeek() },
      activities: [makeActivity({ distance_km: 10.6, pace_min_per_km: 6.1 })],
    })

    expect(screen.getByText("Fartlek")).toBeTruthy()
    expect(screen.getByText("1/2 done")).toBeTruthy()
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

    fireEvent.click(screen.getByRole("button", { name: /see the week/i }))
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
    // With more than one race pinned, the card says which one it is about —
    // so the name is on screen twice: on the goal card and on this one.
    expect(screen.getAllByText("Still ahead")).toHaveLength(2)
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
