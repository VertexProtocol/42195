// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n"
import { HomeScreen } from "./home-screen"
import type { Activity, Goal, WeeklyGoal, WeeklySummary } from "@/lib/types"

/**
 * The "This week" card.
 *
 * It used to print Distance, Duration and Runs as stats and then the same
 * three measurements again as weekly targets, so every number appeared twice.
 * A target now annotates the stat it belongs to — except where it measures
 * something narrower, which is the case worth pinning: merging a qualifying
 * session count into the plain run count would put two different numbers on
 * one measurement.
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

/** Weekly-target bars, which is what a duplicated measurement would add. */
function targetBars(): HTMLElement[] {
  return screen
    .queryAllByRole("progressbar")
    .filter((el) => /Weekly distance|Active minutes|Training sessions|Elevation/i.test(
      el.getAttribute("aria-label") ?? "",
    ))
}

describe("HomeScreen — this week", () => {
  it("states each measurement once when every target has a matching stat", () => {
    const activities = [makeActivity(), makeActivity()]
    renderHome(activities, [
      makeGoal({ metric: "distance_km", target: 10 }),
      makeGoal({ metric: "duration_minutes", target: 60 }),
      makeGoal({ metric: "sessions", target: 2 }),
    ])

    // Three targets, three bars — and no separate rows repeating the labels
    // that the stat row already carries.
    expect(targetBars()).toHaveLength(3)
    expect(screen.queryByText("Weekly distance")).toBeNull()
    expect(screen.queryByText("Active minutes")).toBeNull()
  })

  it("annotates a stat with its target rather than restating the current value", () => {
    renderHome([makeActivity({ distance_km: 4 })], [makeGoal({ metric: "distance_km", target: 10 })])
    expect(screen.getByText("of 10 km")).toBeTruthy()
    // The current figure belongs to the stat above, and appears once.
    expect(screen.queryByText(/4 km \/ 10 km/)).toBeNull()
  })

  it("shows the stat row untouched when there are no weekly goals", () => {
    renderHome([makeActivity()], [])
    expect(targetBars()).toHaveLength(0)
    expect(screen.getByText("Distance")).toBeTruthy()
    expect(screen.getByText("Runs")).toBeTruthy()
  })

  it("measures the target against the same number the stat shows", () => {
    // Two 5 km runs → 10 of 10 km, so the target reads as met.
    renderHome(
      [makeActivity({ distance_km: 5 }), makeActivity({ distance_km: 5 })],
      [makeGoal({ metric: "distance_km", target: 10 })],
    )
    const bar = targetBars()[0]
    expect(bar.getAttribute("aria-valuenow")).toBe("100")
    expect(bar.getAttribute("aria-valuetext")).toBe("10 km / 10 km")
  })
})

describe("HomeScreen — targets that measure something narrower", () => {
  it("keeps a qualifying-session goal in its own row", () => {
    // Three runs, only one of them 30 minutes or longer. Folding this into the
    // Runs stat would show "3" above a target counting to 1.
    const activities = [
      makeActivity({ duration_seconds: 2400 }),
      makeActivity({ duration_seconds: 600 }),
      makeActivity({ duration_seconds: 600 }),
    ]
    renderHome(activities, [
      makeGoal({ metric: "sessions", target: 2, session_min_duration_minutes: 30 }),
    ])

    expect(screen.getByText("1 / 2")).toBeTruthy()
    expect(screen.getByText("Runs")).toBeTruthy()
  })

  it("keeps an elevation goal, which no stat reports", () => {
    renderHome(
      [makeActivity({ elevation_gain_m: 120 })],
      [makeGoal({ metric: "elevation_m", target: 300 })],
    )
    expect(screen.getByText("Elevation gain")).toBeTruthy()
    expect(screen.getByText("120 m / 300 m")).toBeTruthy()
  })

  it("gives a plain session goal the stat instead of a row of its own", () => {
    renderHome([makeActivity(), makeActivity()], [makeGoal({ metric: "sessions", target: 3 })])
    expect(screen.getByText("of 3")).toBeTruthy()
    expect(screen.queryByText("2 / 3")).toBeNull()
  })

  it("keeps a second goal for an already-annotated measurement visible", () => {
    renderHome(
      [makeActivity({ distance_km: 4 })],
      [
        makeGoal({ metric: "distance_km", target: 10 }),
        makeGoal({ metric: "distance_km", target: 25, label: "Stretch week" }),
      ],
    )
    expect(screen.getByText("of 10 km")).toBeTruthy()
    expect(screen.getByText("Stretch week")).toBeTruthy()
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
