import { describe, it, expect } from "vitest"
import { computeStreak, computeBadges } from "@/lib/gamification"
import type { Activity, WeeklyGoal } from "@/lib/types"

// Wednesday 15 October 2025, local noon.
const NOW = new Date(2025, 9, 15, 12)

function run(date: string, km: number): Activity {
  return {
    id: `${date}-${km}`,
    user_id: "u",
    strava_id: null,
    type: "Run",
    name: "Run",
    date: `${date}T08:00:00`,
    distance_km: km,
    duration_seconds: km * 330,
    pace_min_per_km: 5.5,
    elevation_gain_m: 0,
    avg_heart_rate: null,
    avg_cadence: null,
    calories: null,
    created_at: `${date}T09:00:00`,
  } as Activity
}

const weekly20: WeeklyGoal = {
  id: "w1",
  metric: "distance_km",
  label: "",
  target: 20,
  week_start: "2025-09-01",
  is_recurring: true,
}

describe("computeStreak", () => {
  it("counts weeks in a row with a run when there are no weekly goals", () => {
    const s = computeStreak([run("2025-10-08", 5), run("2025-10-01", 5), run("2025-09-24", 5)], [], NOW)
    expect(s).toEqual({ current: 3, best: 3, thisWeekWon: false })
  })

  it("adds the current week once it is won", () => {
    const s = computeStreak([run("2025-10-14", 5), run("2025-10-08", 5)], [], NOW)
    expect(s.current).toBe(2)
    expect(s.thisWeekWon).toBe(true)
  })

  it("only counts weeks where every weekly goal was met", () => {
    const acts = [
      run("2025-10-07", 21), // last week: met
      run("2025-09-30", 10), // the week before: short
      run("2025-09-23", 25),
      run("2025-09-16", 25),
    ]
    const s = computeStreak(acts, [weekly20], NOW)
    expect(s.current).toBe(1)
    expect(s.best).toBe(2)
  })

  it("is zero when last week was missed", () => {
    expect(computeStreak([run("2025-09-30", 30)], [weekly20], NOW).current).toBe(0)
  })
})

describe("computeBadges", () => {
  it("awards distance and total badges from runs", () => {
    const badges = computeBadges([run("2025-10-01", 10.02), run("2025-10-02", 95)], {
      current: 0,
      best: 4,
      thisWeekWon: false,
    })
    const earned = badges.filter((b) => b.earned).map((b) => b.id)
    expect(earned).toEqual(["first_run", "km_5", "km_10", "half", "marathon", "total_100", "streak_4"])
  })

  it("earns nothing without runs", () => {
    expect(computeBadges([], { current: 0, best: 0, thisWeekWon: false }).some((b) => b.earned)).toBe(false)
  })
})
