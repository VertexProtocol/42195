// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n"
import { GoalDetailScreen } from "./goal-detail-screen"
import type { Activity, Goal } from "@/lib/types"

/**
 * What a goal detail leads with once its date has gone.
 *
 * It used to lead with "Training from … 100%" — a bar that reads full for
 * every past goal and says nothing — followed by an invitation to generate a
 * training block for a race that had already been run. What is left to know is
 * how it went.
 */

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
    }),
  }),
}))

function daysFromNow(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().split("T")[0]
}

function makeActivity(distanceKm: number, durationSeconds: number): Activity {
  return {
    id: crypto.randomUUID(),
    user_id: "user-1",
    strava_id: null,
    type: "Run",
    name: "Long Run",
    date: daysFromNow(-60),
    distance_km: distanceKm,
    duration_seconds: durationSeconds,
    pace_min_per_km: durationSeconds / 60 / distanceKm,
    elevation_gain_m: null,
    avg_heart_rate: null,
    avg_cadence: null,
    calories: null,
    created_at: daysFromNow(-60),
  }
}

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal-1",
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

function renderDetail(goal: Goal, activities: Activity[], onToggleStar?: (id: string) => void) {
  return render(
    <I18nProvider>
      <GoalDetailScreen
        goal={goal}
        activities={activities}
        onBack={() => {}}
        onEditGoal={() => {}}
        onToggleStar={onToggleStar}
      />
    </I18nProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })),
  )
})

describe("GoalDetailScreen — a goal that has run its course", () => {
  it("leads with the result rather than a training bar stuck at 100%", () => {
    renderDetail(makeGoal(), [makeActivity(10.5, 3600)])
    expect(screen.getByText("Ended")).toBeTruthy()
    expect(screen.queryByText(/Training from/)).toBeNull()
  })

  it("says achieved when the mark was hit", () => {
    renderDetail(makeGoal(), [makeActivity(21, 7200)])
    expect(screen.getByText("Achieved")).toBeTruthy()
  })

  it("shows the best effort against the target it was set for", () => {
    renderDetail(makeGoal(), [makeActivity(10.5, 3600)])
    // Scoped to its own row: the same 10.5 km also appears as the total
    // logged, since this runner has exactly one run behind the goal.
    const row = screen.getByText("Longest run").closest("div")!
    expect(row.textContent).toContain("10.5 km")
    expect(row.textContent).toContain("20.0 km")
  })

  it("judges a timed goal on time, and reports the time", () => {
    const goal = makeGoal({ target_distance_km: 10, target_time_seconds: 50 * 60 })
    renderDetail(goal, [makeActivity(10, 49 * 60)])
    expect(screen.getByText("Achieved")).toBeTruthy()
    expect(screen.getByText("Best time")).toBeTruthy()
  })

  it("leaves an event goal unjudged, since it has no mark", () => {
    renderDetail(makeGoal({ goal_category: "event_training" }), [makeActivity(42, 14400)])
    expect(screen.getByText("Ended")).toBeTruthy()
    expect(screen.queryByText("Longest run")).toBeNull()
  })
})

describe("GoalDetailScreen — the unpin offer", () => {
  it("offers to unpin a finished goal that is still pinned", () => {
    const onToggleStar = vi.fn()
    renderDetail(makeGoal(), [makeActivity(10.5, 3600)], onToggleStar)

    fireEvent.click(screen.getByRole("button", { name: /unpin from today/i }))
    expect(onToggleStar).toHaveBeenCalledWith("goal-1")
  })

  it("says nothing about pinning for a goal that is not pinned", () => {
    renderDetail(makeGoal({ is_starred: false }), [makeActivity(10.5, 3600)], () => {})
    expect(screen.queryByRole("button", { name: /unpin from today/i })).toBeNull()
  })

  it("never unpins on its own", () => {
    const onToggleStar = vi.fn()
    renderDetail(makeGoal(), [makeActivity(10.5, 3600)], onToggleStar)
    expect(onToggleStar).not.toHaveBeenCalled()
  })
})
