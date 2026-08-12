// @vitest-environment jsdom

import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n"
import { GoalsScreen } from "./goals-screen"
import type { Activity, Goal, WeeklyGoal } from "@/lib/types"

/**
 * What a target's subtitle claims once its date has gone.
 *
 * It used to read "Completed" for any goal whose day had been and gone —
 * including a 20 km target whose longest run was 10.5 km. The engine already
 * knew the mark had been missed; the list said otherwise.
 */

function daysFromNow(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().split("T")[0]
}

function makeActivity(distanceKm: number): Activity {
  return {
    id: crypto.randomUUID(),
    user_id: "user-1",
    strava_id: null,
    type: "Run",
    name: "Long Run",
    date: daysFromNow(-30),
    distance_km: distanceKm,
    duration_seconds: Math.round(distanceKm * 330),
    pace_min_per_km: 5.5,
    elevation_gain_m: null,
    avg_heart_rate: null,
    avg_cadence: null,
    calories: null,
    created_at: daysFromNow(-30),
  }
}

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: crypto.randomUUID(),
    name: "20 km",
    goal_category: "performance",
    target_distance_km: 20,
    target_date: daysFromNow(-40),
    target_time_seconds: null,
    start_date: daysFromNow(-120),
    is_active: true,
    is_starred: true,
    display_order: 0,
    created_at: daysFromNow(-120),
    ...overrides,
  } as Goal
}

function renderGoals(goals: Goal[], activities: Activity[]) {
  return render(
    <I18nProvider>
      <GoalsScreen
        goals={goals}
        activities={activities}
        weeklyGoals={[]}
        onToggleActive={() => {}}
        onToggleStar={() => {}}
        onEditGoal={() => {}}
        onAddGoal={() => {}}
        onEditWeeklyGoal={() => {}}
        onAddWeeklyGoal={() => {}}
        onSelectGoal={() => {}}
        onReorderGoals={async () => {}}
        onReorderWeeklyGoals={async () => {}}
      />
    </I18nProvider>,
  )
}

describe("GoalsScreen — what a past target claims", () => {
  it("does not call a missed target completed", () => {
    // Longest run 10.5 km against a 20 km target, four days after the date.
    renderGoals([makeGoal()], [makeActivity(10.5)])
    expect(screen.getByText(/Ended/)).toBeTruthy()
    expect(screen.queryByText(/Completed/)).toBeNull()
    expect(screen.queryByText(/Achieved/)).toBeNull()
  })

  it("says achieved when the mark was actually hit", () => {
    renderGoals([makeGoal()], [makeActivity(21)])
    expect(screen.getByText(/Achieved/)).toBeTruthy()
    expect(screen.queryByText(/Ended/)).toBeNull()
  })

  it("judges a timed target on the time, not the date", () => {
    // 10 km in 49:00 against a sub-50 target.
    const goal = makeGoal({
      name: "Sub-50 10km",
      target_distance_km: 10,
      target_time_seconds: 50 * 60,
    })
    const run: Activity = { ...makeActivity(10), duration_seconds: 49 * 60 }
    renderGoals([goal], [run])
    expect(screen.getByText(/Achieved/)).toBeTruthy()
  })

  it("ends rather than achieves a timed target that came up short", () => {
    const goal = makeGoal({
      name: "Sub-50 10km",
      target_distance_km: 10,
      target_time_seconds: 50 * 60,
    })
    const run: Activity = { ...makeActivity(10), duration_seconds: 53 * 60 }
    renderGoals([goal], [run])
    expect(screen.getByText(/Ended/)).toBeTruthy()
    expect(screen.queryByText(/Achieved/)).toBeNull()
  })

  it("ends an event goal, which has no mark to judge", () => {
    renderGoals(
      [makeGoal({ name: "Oslo Marathon", goal_category: "event_training" })],
      [makeActivity(42)],
    )
    expect(screen.getByText(/Ended/)).toBeTruthy()
  })

  it("still counts down a target that is still to come", () => {
    renderGoals([makeGoal({ target_date: daysFromNow(32) })], [makeActivity(10.5)])
    expect(screen.getByText(/32 days left/)).toBeTruthy()
    expect(screen.queryByText(/Ended/)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The metric icon
// ---------------------------------------------------------------------------

/**
 * The icons a weekly card leads with. They now come from a module shared with
 * Today and the editor, so a card here and the same goal there are marked the
 * same. These hold the icons in place through that move.
 */

function makeWeeklyGoal(overrides: Partial<WeeklyGoal> = {}): WeeklyGoal {
  const d = new Date()
  d.setDate(d.getDate() + (d.getDay() === 0 ? -6 : 1 - d.getDay()))
  const p = (n: number) => String(n).padStart(2, "0")
  return {
    id: crypto.randomUUID(),
    metric: "distance_km",
    label: "",
    target: 40,
    current: 0,
    week_start: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    is_recurring: true,
    ...overrides,
  }
}

function renderWeekly(weeklyGoals: WeeklyGoal[]) {
  const view = render(
    <I18nProvider>
      <GoalsScreen
        goals={[]}
        activities={[]}
        weeklyGoals={weeklyGoals}
        onToggleActive={() => {}}
        onToggleStar={() => {}}
        onEditGoal={() => {}}
        onAddGoal={() => {}}
        onEditWeeklyGoal={() => {}}
        onAddWeeklyGoal={() => {}}
        onSelectGoal={() => {}}
        onReorderGoals={async () => {}}
        onReorderWeeklyGoals={async () => {}}
      />
    </I18nProvider>,
  )
  fireEvent.click(screen.getByRole("tab", { name: "Weekly" }))
  return view
}

describe("GoalsScreen — weekly cards keep their metric icon", () => {
  it("marks each metric with its own icon", () => {
    const { container } = renderWeekly([
      makeWeeklyGoal({ metric: "distance_km" }),
      makeWeeklyGoal({ metric: "duration_minutes" }),
      makeWeeklyGoal({ metric: "sessions" }),
      makeWeeklyGoal({ metric: "elevation_m" }),
    ])
    for (const cls of ["trending-up", "clock", "flame", "mountain"]) {
      expect(container.querySelectorAll(`svg.lucide-${cls}`).length).toBe(1)
    }
  })
})
