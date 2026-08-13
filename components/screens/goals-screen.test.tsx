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

function renderWeekly(weeklyGoals: WeeklyGoal[], initialTab?: "weekly" | "race") {
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
        initialTab={initialTab}
      />
    </I18nProvider>,
  )
  if (!initialTab) fireEvent.click(screen.getByRole("tab", { name: "Weekly" }))
  return view
}

describe("GoalsScreen — which horizon it opens on", () => {
  it("opens on races by default", () => {
    renderWeekly([makeWeeklyGoal()], "race")
    expect(screen.getByRole("tab", { name: "Targets" }).getAttribute("aria-selected")).toBe("true")
  })

  it("opens on the weekly list when the caller asks for it", () => {
    // What a weekly goal on Today links to. Landing on the race list means
    // landing on a screen the goal that was tapped is not on.
    renderWeekly([makeWeeklyGoal()], "weekly")
    expect(screen.getByRole("tab", { name: "Weekly" }).getAttribute("aria-selected")).toBe("true")
  })
})

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

/**
 * The suggested weekly targets on Plan → Weekly.
 *
 * The screen derives them itself from the goals, the plan digests and the
 * activities it is already holding, so these tests drive the real engine
 * rather than a stub of it.
 */

function makeRun(daysAgo: number, km: number): Activity {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return {
    id: crypto.randomUUID(),
    user_id: "user-1",
    strava_id: null,
    type: "Run",
    name: "Run",
    date: d.toISOString(),
    distance_km: km,
    duration_seconds: Math.round(km * 330),
    pace_min_per_km: 5.5,
    elevation_gain_m: 20,
    avg_heart_rate: 150,
    avg_cadence: null,
    calories: null,
    created_at: d.toISOString(),
  }
}

/** Four runs a week for the last six weeks. */
function steadyHistory(kmEach = 10): Activity[] {
  const out: Activity[] = []
  for (let w = 0; w < 6; w++) {
    for (let r = 1; r <= 4; r++) out.push(makeRun(w * 7 + r, kmEach))
  }
  return out
}

function mondayThisWeek(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + (d.getDay() === 0 ? -6 : 1 - d.getDay()))
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function renderSuggestions(props: Partial<React.ComponentProps<typeof GoalsScreen>> = {}) {
  const result = render(
    <I18nProvider>
      <GoalsScreen
        goals={[]}
        activities={steadyHistory()}
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
        initialTab="weekly"
        {...props}
      />
    </I18nProvider>,
  )
  return result
}

describe("GoalsScreen — suggested weekly targets", () => {
  it("offers a target to a runner who has set none", () => {
    renderSuggestions()
    expect(screen.getAllByRole("button", { name: "Use this" }).length).toBeGreaterThan(0)
  })

  it("explains where the number came from", () => {
    renderSuggestions()
    expect(screen.getByText(/last 4 weeks averaged/i)).toBeTruthy()
  })

  it("passes the suggestion to the editor when it is taken up", () => {
    let received: unknown = "not called"
    renderSuggestions({ onAddWeeklyGoal: (s) => { received = s } })
    fireEvent.click(screen.getAllByRole("button", { name: "Use this" })[0])
    expect(received).toMatchObject({ metric: "distance_km", source: "history" })
  })

  it("opens the editor with nothing prefilled from the plain add button", () => {
    let received: unknown = "not called"
    renderSuggestions({ onAddWeeklyGoal: (s) => { received = s } })
    fireEvent.click(screen.getByRole("button", { name: /add weekly goal/i }))
    expect(received).toBeUndefined()
  })

  it("stops offering a metric the runner has already set", () => {
    const weekStart = mondayThisWeek()
    renderSuggestions({
      weeklyGoals: [
        {
          id: "wg1",
          metric: "distance_km",
          label: "Weekly Distance",
          target: 45,
          current: 0,
          week_start: weekStart,
          is_recurring: false,
          display_order: 1,
        } as WeeklyGoal,
      ],
    })
    const offered = screen.getAllByRole("button", { name: "Use this" })
    expect(offered).toHaveLength(1) // sessions only
    expect(screen.getByText("Suggested for this week")).toBeTruthy()
  })

  it("says nothing at all once every metric is covered", () => {
    const weekStart = mondayThisWeek()
    const base = { current: 0, week_start: weekStart, is_recurring: false }
    renderSuggestions({
      weeklyGoals: [
        { id: "a", metric: "distance_km", label: "Weekly Distance", target: 45, display_order: 1, ...base },
        { id: "b", metric: "sessions", label: "Training Sessions", target: 4, display_order: 2, ...base },
      ] as WeeklyGoal[],
    })
    expect(screen.queryByRole("button", { name: "Use this" })).toBeNull()
    expect(screen.queryByText("Suggested for this week")).toBeNull()
  })

  it("prefers a race's plan over the runner's history", () => {
    const race = makeGoal({
      goal_category: "event_training",
      name: "Oslo Marathon",
      target_date: daysFromNow(120),
      start_date: daysFromNow(-30),
    })
    renderSuggestions({
      goals: [race],
      planDigests: [
        {
          goalId: race.id,
          blockStartDate: mondayThisWeek(),
          weeks: [{ targetKm: 52, sessionCount: 5 }],
        },
      ],
    })
    expect(screen.getByText("52 km")).toBeTruthy()
    // Distance and sessions both come from the same block week, so both cite it.
    expect(screen.getAllByText(/Week 1 of your plan for Oslo Marathon/)).toHaveLength(2)
  })

  it("does not suggest for a week that has already gone", () => {
    renderSuggestions()
    fireEvent.click(screen.getByRole("button", { name: /previous week/i }))
    expect(screen.queryByRole("button", { name: "Use this" })).toBeNull()
  })
})

describe("GoalsScreen — accepting, adjusting and refusing", () => {
  const weekStart = mondayThisWeek()
  const base = { current: 0, week_start: weekStart, display_order: 1 }

  it("turns an offer down by metric and source, not by week", () => {
    const seen: unknown[] = []
    renderSuggestions({ onDismissSuggestion: (m, g) => seen.push([m, g]) })
    fireEvent.click(screen.getAllByRole("button", { name: "Not this" })[0])
    // History-based, so no race behind it — the null is what makes the
    // dismissal stick to the right offer.
    expect(seen).toEqual([["distance_km", null]])
  })

  it("stops offering what has already been turned down", () => {
    renderSuggestions({ dismissals: [{ metric: "distance_km", source_goal_id: null }] })
    expect(screen.queryByText(/km$/)).toBeNull()
    expect(screen.getAllByRole("button", { name: "Use this" })).toHaveLength(1)
  })

  it("says a target was adjusted from what was offered", () => {
    renderSuggestions({
      weeklyGoals: [
        {
          ...base,
          id: "wg1",
          metric: "distance_km",
          label: "Weekly Distance",
          target: 45,
          is_recurring: false,
          source: "history",
          source_goal_id: null,
          suggested_target: 40,
        } as WeeklyGoal,
      ],
    })
    expect(screen.getByText(/Adjusted from 40 km/)).toBeTruthy()
  })

  it("stays quiet about a target taken exactly as offered", () => {
    renderSuggestions({
      weeklyGoals: [
        {
          ...base,
          id: "wg1",
          metric: "distance_km",
          label: "Weekly Distance",
          target: 40,
          is_recurring: false,
          source: "history",
          source_goal_id: null,
          suggested_target: 40,
        } as WeeklyGoal,
      ],
    })
    expect(screen.queryByText(/Adjusted from/)).toBeNull()
  })

  it("keeps offering the plan's number beside a standing manual target", () => {
    // A recurring goal is in every week there will ever be, so suppressing the
    // metric outright would silence the suggestion permanently.
    renderSuggestions({
      weeklyGoals: [
        {
          ...base,
          id: "wg1",
          metric: "distance_km",
          label: "Weekly Distance",
          target: 30,
          is_recurring: true,
          source: "manual",
        } as WeeklyGoal,
      ],
    })
    expect(screen.getByText(/Your plan says/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Use that" })).toBeTruthy()
  })

  it("says nothing under a one-off target the runner set this week", () => {
    renderSuggestions({
      weeklyGoals: [
        {
          ...base,
          id: "wg1",
          metric: "distance_km",
          label: "Weekly Distance",
          target: 30,
          is_recurring: false,
          source: "manual",
        } as WeeklyGoal,
      ],
    })
    expect(screen.queryByText(/Your plan says/)).toBeNull()
  })

  it("takes the plan's number in one tap, recording where it came from", () => {
    let saved: WeeklyGoal | null = null
    renderSuggestions({
      onSaveWeeklyGoal: (g) => { saved = g },
      weeklyGoals: [
        {
          ...base,
          id: "wg1",
          metric: "distance_km",
          label: "Weekly Distance",
          target: 30,
          is_recurring: true,
          source: "manual",
        } as WeeklyGoal,
      ],
    })
    fireEvent.click(screen.getByRole("button", { name: "Use that" }))
    expect(saved).toMatchObject({ id: "wg1", source: "history", source_goal_id: null })
    expect(saved!.target).toBe(saved!.suggested_target)
  })

  it("asks rather than rewrites when the plan has moved", () => {
    const race = makeGoal({
      goal_category: "event_training",
      name: "Oslo Marathon",
      target_date: daysFromNow(120),
      start_date: daysFromNow(-30),
    })
    renderSuggestions({
      goals: [race],
      planDigests: [
        { goalId: race.id, blockStartDate: weekStart, weeks: [{ targetKm: 52, sessionCount: 5 }] },
      ],
      weeklyGoals: [
        {
          ...base,
          id: "wg1",
          metric: "distance_km",
          label: "Weekly Distance",
          target: 44,
          is_recurring: false,
          source: "plan",
          source_goal_id: race.id,
          suggested_target: 44,
        } as WeeklyGoal,
      ],
    })
    // The card still shows what the runner committed to.
    expect(screen.getByText(/Your plan now says 52 km/)).toBeTruthy()
    expect(screen.getByText(/44 km/)).toBeTruthy()
  })

  it("settles a moved plan without touching the target", () => {
    const race = makeGoal({
      goal_category: "event_training",
      name: "Oslo Marathon",
      target_date: daysFromNow(120),
      start_date: daysFromNow(-30),
    })
    let saved: WeeklyGoal | null = null
    renderSuggestions({
      onSaveWeeklyGoal: (g) => { saved = g },
      goals: [race],
      planDigests: [
        { goalId: race.id, blockStartDate: weekStart, weeks: [{ targetKm: 52, sessionCount: 5 }] },
      ],
      weeklyGoals: [
        {
          ...base,
          id: "wg1",
          metric: "distance_km",
          label: "Weekly Distance",
          target: 44,
          is_recurring: false,
          source: "plan",
          source_goal_id: race.id,
          suggested_target: 44,
        } as WeeklyGoal,
      ],
    })
    fireEvent.click(screen.getByRole("button", { name: "Keep mine" }))
    // Their number stands; only the record of what they have seen moves, so
    // the question is not asked again on the next visit.
    expect(saved).toMatchObject({ target: 44, suggested_target: 52 })
  })
})

describe("GoalsScreen — the drag order as priority", () => {
  const future = { target_date: daysFromNow(120), start_date: daysFromNow(-30) }

  it("marks the race that sets the week", () => {
    renderSuggestions({
      initialTab: "race",
      goals: [
        makeGoal({ ...future, goal_category: "event_training", name: "Berlin", display_order: 2 }),
        makeGoal({ ...future, goal_category: "event_training", name: "Oslo", display_order: 1 }),
      ],
    })
    expect(screen.getByText("A")).toBeTruthy()
    expect(screen.getByText(/The order sets priority/)).toBeTruthy()
  })

  it("marks the race, never the performance goal above it", () => {
    const perf = makeGoal({ ...future, goal_category: "performance", name: "Sub-50", display_order: 1 })
    const race = makeGoal({ ...future, goal_category: "event_training", name: "Oslo", display_order: 2 })
    const { container } = renderSuggestions({ initialTab: "race", goals: [perf, race] })
    const marked = container.querySelectorAll("span")
    const pill = Array.from(marked).find((el) => el.textContent?.startsWith("A —"))
    expect(pill).toBeTruthy()
    // The pill sits inside Oslo's card, not the performance goal's.
    expect(pill!.closest("div")!.textContent).toContain("Oslo")
  })

  it("stays quiet about an order of one", () => {
    renderSuggestions({
      initialTab: "race",
      goals: [makeGoal({ ...future, goal_category: "event_training", name: "Oslo" })],
    })
    expect(screen.queryByText(/The order sets priority/)).toBeNull()
  })
})

describe("GoalsScreen — stepping into next week", () => {
  const weekStart = mondayThisWeek()

  function nextMonday(): string {
    const d = new Date(`${weekStart}T00:00:00`)
    d.setDate(d.getDate() + 7)
    const p = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }

  const race = makeGoal({
    goal_category: "event_training",
    name: "Oslo Marathon",
    target_date: daysFromNow(120),
    start_date: daysFromNow(-30),
  })

  it("will not go forward without a plan to go forward into", () => {
    renderSuggestions()
    expect(screen.getByRole("button", { name: /next week/i }).hasAttribute("disabled")).toBe(true)
  })

  it("goes forward one week when the block covers it", () => {
    renderSuggestions({
      goals: [race],
      planDigests: [
        {
          goalId: race.id,
          blockStartDate: weekStart,
          weeks: [{ targetKm: 52, sessionCount: 5 }, { targetKm: 58, sessionCount: 5 }],
        },
      ],
    })
    const forward = screen.getByRole("button", { name: /next week/i })
    expect(forward.hasAttribute("disabled")).toBe(false)
    fireEvent.click(forward)
    expect(screen.getByText("58 km")).toBeTruthy()
    // And stops there — one week ahead is what the block can answer for.
    expect(screen.getByRole("button", { name: /next week/i }).hasAttribute("disabled")).toBe(true)
  })

  it("accepts next week's target against next week", () => {
    let received: { weekStart?: string } | undefined
    renderSuggestions({
      onAddWeeklyGoal: (s) => { received = s },
      goals: [race],
      planDigests: [
        {
          goalId: race.id,
          blockStartDate: weekStart,
          weeks: [{ targetKm: 52, sessionCount: 5 }, { targetKm: 58, sessionCount: 5 }],
        },
      ],
    })
    fireEvent.click(screen.getByRole("button", { name: /next week/i }))
    fireEvent.click(screen.getAllByRole("button", { name: "Use this" })[0])
    // Not this Monday — the row has to land on the week it was derived for.
    expect(received?.weekStart).toBe(nextMonday())
  })

  it("offers no blank add button for a week that is not here yet", () => {
    renderSuggestions({
      goals: [race],
      planDigests: [
        {
          goalId: race.id,
          blockStartDate: weekStart,
          weeks: [{ targetKm: 52, sessionCount: 5 }, { targetKm: 58, sessionCount: 5 }],
        },
      ],
    })
    fireEvent.click(screen.getByRole("button", { name: /next week/i }))
    expect(screen.queryByRole("button", { name: /add weekly goal/i })).toBeNull()
  })
})
