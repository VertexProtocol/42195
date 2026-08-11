// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n"
import { TrainingCalendarCard } from "./training-calendar-card"
import type { Activity, Goal } from "@/lib/types"

/**
 * Opening what is on a day.
 *
 * Only race dates used to be tappable; a day carrying a run was a plain div,
 * so the calendar showed a run and offered no way to reach it. The rule now is
 * "do the unambiguous thing": one run and nothing else opens it, anything more
 * expands so the runner picks.
 */

function dayOfThisMonth(day: number): string {
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(day)}`
}

function makeActivity(day: number, overrides: Partial<Activity> = {}): Activity {
  return {
    id: `activity-${day}-${overrides.name ?? "run"}`,
    user_id: "user-1",
    strava_id: null,
    type: "Run",
    name: "Morning Run",
    date: dayOfThisMonth(day),
    distance_km: 8,
    duration_seconds: 2700,
    pace_min_per_km: 5.6,
    elevation_gain_m: null,
    avg_heart_rate: null,
    avg_cadence: null,
    calories: null,
    created_at: dayOfThisMonth(day),
    ...overrides,
  }
}

function makeGoal(day: number): Goal {
  return {
    id: "goal-1",
    name: "Sub-50 10km",
    goal_category: "event_training",
    target_distance_km: 10,
    target_date: dayOfThisMonth(day),
    target_time_seconds: null,
    start_date: null,
    is_active: true,
    is_starred: false,
    display_order: 0,
    created_at: dayOfThisMonth(1),
  } as Goal
}

function renderCalendar(props: {
  activities?: Activity[]
  goals?: Goal[]
  onSelectActivity?: (a: Activity) => void
  onViewGoal?: (g: Goal) => void
}) {
  return render(
    <I18nProvider>
      <TrainingCalendarCard
        activities={props.activities ?? []}
        goals={props.goals ?? []}
        onSelectActivity={props.onSelectActivity}
        onViewGoal={props.onViewGoal}
      />
    </I18nProvider>,
  )
}

/** The grid cell for a day of the current month. */
function dayCell(day: number): HTMLElement {
  const cells = screen.getAllByRole("button").filter((el) => {
    const first = el.querySelector("span")
    return first?.textContent === String(day)
  })
  expect(cells.length).toBeGreaterThan(0)
  return cells[0]
}

describe("TrainingCalendarCard — opening a day", () => {
  it("opens the run directly when a day holds exactly one", () => {
    const onSelectActivity = vi.fn()
    const activity = makeActivity(12)
    renderCalendar({ activities: [activity], onSelectActivity })

    fireEvent.click(dayCell(12))
    expect(onSelectActivity).toHaveBeenCalledWith(activity)
  })

  it("expands instead of guessing when a day holds several runs", () => {
    const onSelectActivity = vi.fn()
    const first = makeActivity(12, { name: "Morning Run" })
    const second = makeActivity(12, { name: "Evening Run" })
    renderCalendar({ activities: [first, second], onSelectActivity })

    fireEvent.click(dayCell(12))
    expect(onSelectActivity).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: /Evening Run/ }))
    expect(onSelectActivity).toHaveBeenCalledWith(second)
  })

  it("expands when a run shares its day with a race date", () => {
    const onSelectActivity = vi.fn()
    const activity = makeActivity(12)
    renderCalendar({ activities: [activity], goals: [makeGoal(12)], onSelectActivity })

    fireEvent.click(dayCell(12))
    expect(onSelectActivity).not.toHaveBeenCalled()
    // Both the race and the run are listed, so neither is chosen for the runner.
    expect(screen.getByText("Sub-50 10km")).toBeTruthy()
    expect(screen.getByRole("button", { name: /Morning Run/ })).toBeTruthy()
  })

  it("leaves an empty day inert", () => {
    renderCalendar({ activities: [makeActivity(12)], onSelectActivity: vi.fn() })
    const emptyCells = screen.getAllByRole("button").filter((el) => {
      const first = el.querySelector("span")
      return first?.textContent === "13"
    })
    expect(emptyCells).toHaveLength(0)
  })

  it("does not offer to open runs when there is nowhere to send them", () => {
    renderCalendar({ activities: [makeActivity(12), makeActivity(12, { name: "Evening Run" })] })
    fireEvent.click(dayCell(12))
    expect(screen.queryByRole("button", { name: /Evening Run/ })).toBeNull()
  })

  it("still selects a race date on its own, as it always did", () => {
    const onViewGoal = vi.fn()
    renderCalendar({ goals: [makeGoal(20)], onViewGoal })

    fireEvent.click(dayCell(20))
    const goalRow = screen.getByRole("button", { name: /Sub-50 10km/ })
    fireEvent.click(goalRow)
    expect(onViewGoal).toHaveBeenCalled()
  })

  it("collapses a day that is tapped twice", () => {
    renderCalendar({
      activities: [makeActivity(12), makeActivity(12, { name: "Evening Run" })],
      onSelectActivity: vi.fn(),
    })
    fireEvent.click(dayCell(12))
    expect(screen.getByRole("button", { name: /Evening Run/ })).toBeTruthy()

    fireEvent.click(dayCell(12))
    expect(screen.queryByRole("button", { name: /Evening Run/ })).toBeNull()
  })
})

describe("TrainingCalendarCard — listing a day", () => {
  it("shows each run's distance next to its name", () => {
    renderCalendar({
      activities: [
        makeActivity(12, { name: "Morning Run", distance_km: 8.4 }),
        makeActivity(12, { name: "Evening Run", distance_km: 5 }),
      ],
      onSelectActivity: vi.fn(),
    })
    fireEvent.click(dayCell(12))

    const row = screen.getByRole("button", { name: /Morning Run/ })
    expect(within(row).getByText("8.4 km")).toBeTruthy()
  })
})
