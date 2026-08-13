import { describe, it, expect } from "vitest"
import {
  suggestWeeklyGoals,
  type PlanDigest,
  type WeeklySuggestion,
} from "./weekly-suggestions"
import type { Activity, Goal } from "./types"

// Monday 2026-08-10 is "this week" throughout; NOW is the Wednesday inside it.
const WEEK_START = "2026-08-10"
const NOW = new Date(2026, 7, 12, 9, 0)
const DAY_MS = 24 * 60 * 60 * 1000

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "g1",
    name: "Oslo Marathon",
    goal_category: "event_training",
    target_distance_km: 42.195,
    target_date: "2026-11-14",
    start_date: "2026-06-01",
    target_time_seconds: null,
    current_distance_km: 0,
    is_active: true,
    created_at: "2026-06-01T00:00:00.000Z",
    display_order: 1,
    ...overrides,
  }
}

/**
 * `weeks` runs of `kmEach` per week, going back from NOW. Week 0 is the seven
 * days ending now, week 1 the seven before that, and so on — the same rolling
 * windows the volume baseline measures in.
 */
function history(weeks: number, runsPerWeek: number, kmEach: number): Activity[] {
  const out: Activity[] = []
  for (let w = 0; w < weeks; w++) {
    for (let r = 0; r < runsPerWeek; r++) {
      const at = new Date(NOW.getTime() - w * 7 * DAY_MS - (r + 1) * DAY_MS)
      out.push(run(at, kmEach))
    }
  }
  return out
}

function run(at: Date, km: number, type = "Run"): Activity {
  return {
    id: `a-${at.getTime()}-${km}`,
    user_id: "u1",
    strava_id: null,
    type,
    name: "Run",
    date: at.toISOString(),
    distance_km: km,
    duration_seconds: Math.round(km * 5.5 * 60),
    pace_min_per_km: 5.5,
    elevation_gain_m: 20,
    avg_heart_rate: 150,
    avg_cadence: null,
    calories: null,
    created_at: at.toISOString(),
  }
}

function digest(overrides: Partial<PlanDigest> = {}): PlanDigest {
  return {
    goalId: "g1",
    blockStartDate: "2026-07-27", // two Mondays before WEEK_START → week 3
    weeks: [
      { targetKm: 40, sessionCount: 4 },
      { targetKm: 44, sessionCount: 4 },
      { targetKm: 48, sessionCount: 5 },
      { targetKm: 38, sessionCount: 4 },
    ],
    ...overrides,
  }
}

function km(suggestions: WeeklySuggestion[]): WeeklySuggestion | undefined {
  return suggestions.find((s) => s.metric === "distance_km")
}

function sessions(suggestions: WeeklySuggestion[]): WeeklySuggestion | undefined {
  return suggestions.find((s) => s.metric === "sessions")
}

describe("suggestWeeklyGoals — from an active plan", () => {
  it("takes the week the block prescribes", () => {
    const out = suggestWeeklyGoals({
      goals: [goal()],
      plans: [digest()],
      activities: history(8, 4, 10),
      weekStart: WEEK_START,
      now: NOW,
    })
    expect(km(out)).toMatchObject({ target: 48, source: "plan", sourceGoalId: "g1" })
    expect(sessions(out)).toMatchObject({ target: 5, source: "plan" })
  })

  it("names the week number in the reason, not a rendered sentence", () => {
    const out = suggestWeeklyGoals({
      goals: [goal()],
      plans: [digest()],
      activities: history(8, 4, 10),
      weekStart: WEEK_START,
      now: NOW,
    })
    expect(km(out)!.reasonKey).toBe("weeklySuggestion.reason.planDistance")
    expect(km(out)!.reasonValues).toEqual({ week: 3, goal: "Oslo Marathon" })
  })

  it("falls through to the volume engine once the block has run out", () => {
    // A four-week block starting 2026-06-29 ends before 2026-08-10.
    const out = suggestWeeklyGoals({
      goals: [goal()],
      plans: [digest({ blockStartDate: "2026-06-29" })],
      activities: history(8, 4, 10),
      weekStart: WEEK_START,
      now: NOW,
    })
    expect(km(out)!.source).toBe("target")
  })

  it("ignores a block that has not started yet", () => {
    const out = suggestWeeklyGoals({
      goals: [goal()],
      plans: [digest({ blockStartDate: "2026-08-31" })],
      activities: history(8, 4, 10),
      weekStart: WEEK_START,
      now: NOW,
    })
    expect(km(out)!.source).toBe("target")
  })

  it("drops a rest week rather than showing a target of zero", () => {
    const out = suggestWeeklyGoals({
      goals: [goal()],
      plans: [
        digest({
          blockStartDate: WEEK_START,
          weeks: [{ targetKm: 0, sessionCount: 0 }],
        }),
      ],
      activities: history(8, 4, 10),
      weekStart: WEEK_START,
      now: NOW,
    })
    // Nothing from the plan, so the engine offers the history instead of
    // an empty screen.
    expect(out.every((s) => s.target > 0)).toBe(true)
  })
})

describe("suggestWeeklyGoals — from a target goal with no plan", () => {
  it("derives a volume from the runner's history", () => {
    const out = suggestWeeklyGoals({
      goals: [goal()],
      activities: history(8, 4, 10), // ~40 km/week
      weekStart: WEEK_START,
      now: NOW,
    })
    const distance = km(out)!
    expect(distance.source).toBe("target")
    expect(distance.sourceGoalId).toBe("g1")
    expect(distance.target).toBeGreaterThan(30)
    expect(distance.target).toBeLessThan(60)
  })

  it("uses the goal's own sessions-per-week setting", () => {
    const out = suggestWeeklyGoals({
      goals: [goal()],
      preferences: { g1: { sessionsPerWeek: 5, weeklyIncreasePct: 10, blockWeeks: 4 } },
      activities: history(8, 4, 10),
      weekStart: WEEK_START,
      now: NOW,
    })
    expect(sessions(out)).toMatchObject({ target: 5, source: "target" })
  })

  it("stays under the progression cap for a runner's level", () => {
    // 40 km/week for eight weeks. An intermediate runner may add 10%, so a
    // suggestion above ~44 km would be the engine outrunning its own rules.
    const out = suggestWeeklyGoals({
      goals: [goal()],
      activities: history(8, 4, 10),
      weekStart: WEEK_START,
      now: NOW,
    })
    expect(km(out)!.target).toBeLessThanOrEqual(45)
  })

  it("cuts the week for a runner coming back from a long pause", () => {
    // Same eight-week history, but it stopped three weeks ago.
    const paused = history(8, 4, 10).map((a) => ({
      ...a,
      date: new Date(new Date(a.date).getTime() - 21 * DAY_MS).toISOString(),
    }))
    const steady = suggestWeeklyGoals({
      goals: [goal()],
      activities: history(8, 4, 10),
      weekStart: WEEK_START,
      now: NOW,
    })
    const returning = suggestWeeklyGoals({
      goals: [goal()],
      activities: paused,
      weekStart: WEEK_START,
      now: NOW,
    })
    expect(km(returning)!.target).toBeLessThan(km(steady)!.target)
  })

  it("counts runs only, not cross-training", () => {
    const runs = history(8, 3, 10)
    const withRides = [
      ...runs,
      ...Array.from({ length: 8 }, (_, w) =>
        run(new Date(NOW.getTime() - w * 7 * DAY_MS), 60, "Ride"),
      ),
    ]
    const a = suggestWeeklyGoals({ goals: [goal()], activities: runs, weekStart: WEEK_START, now: NOW })
    const b = suggestWeeklyGoals({ goals: [goal()], activities: withRides, weekStart: WEEK_START, now: NOW })
    expect(km(b)!.target).toBe(km(a)!.target)
  })
})

describe("suggestWeeklyGoals — from history alone", () => {
  it("holds the runner's typical week", () => {
    const out = suggestWeeklyGoals({
      goals: [],
      activities: history(6, 3, 10), // 30 km/week
      weekStart: WEEK_START,
      now: NOW,
    })
    const distance = km(out)!
    expect(distance.source).toBe("history")
    expect(distance.sourceGoalId).toBeNull()
    expect(distance.target).toBeGreaterThanOrEqual(30)
    expect(distance.target).toBeLessThanOrEqual(34)
  })

  it("suggests the number of runs the runner usually does", () => {
    const out = suggestWeeklyGoals({
      goals: [],
      activities: history(6, 3, 10),
      weekStart: WEEK_START,
      now: NOW,
    })
    expect(sessions(out)).toMatchObject({ target: 3, source: "history" })
  })

  it("is not dragged down by one missed week", () => {
    // Three 40 km weeks and one week off. A mean would report 30 km; the
    // median of the weeks that happened reports 40.
    const acts = [
      ...history(1, 4, 10),
      // week 1 skipped
      ...history(4, 4, 10).filter((a) => {
        const age = NOW.getTime() - new Date(a.date).getTime()
        return age > 2 * 7 * DAY_MS
      }),
    ]
    const out = suggestWeeklyGoals({
      goals: [],
      activities: acts,
      weekStart: WEEK_START,
      now: NOW,
    })
    expect(km(out)!.target).toBeGreaterThanOrEqual(40)
  })

  it("holds level instead of progressing on thin history", () => {
    const out = suggestWeeklyGoals({
      goals: [],
      activities: history(2, 3, 10), // two weeks only
      weekStart: WEEK_START,
      now: NOW,
    })
    const distance = km(out)!
    expect(distance.lowConfidence).toBe(true)
    expect(distance.reasonKey).toBe("weeklySuggestion.reason.historyDistanceThin")
    expect(distance.target).toBe(30) // no increase applied
  })

  it("offers a conservative default to a runner with no runs at all", () => {
    const out = suggestWeeklyGoals({
      goals: [],
      activities: [],
      weekStart: WEEK_START,
      now: NOW,
    })
    expect(km(out)).toMatchObject({ target: 15, source: "history", lowConfidence: true })
    expect(sessions(out)).toMatchObject({ target: 3, lowConfidence: true })
    expect(km(out)!.reasonValues).toEqual({ weeks: 0 })
  })

  it("says how many weeks it looked at", () => {
    const out = suggestWeeklyGoals({
      goals: [],
      activities: history(4, 3, 10),
      weekStart: WEEK_START,
      now: NOW,
    })
    expect(km(out)!.reasonValues.weeks).toBe(4)
  })
})

describe("suggestWeeklyGoals — choosing between goals", () => {
  const marathon = goal({ id: "m", name: "Marathon", target_date: "2026-11-14", display_order: 1 })
  const tenK = goal({ id: "t", name: "Bislett 10K", target_date: "2026-10-03", display_order: 2 })

  it("lets the first goal in the drag order set the pace", () => {
    const out = suggestWeeklyGoals({
      goals: [tenK, marathon],
      plans: [digest({ goalId: "m" }), digest({ goalId: "t", weeks: [{ targetKm: 20, sessionCount: 3 }, { targetKm: 22, sessionCount: 3 }, { targetKm: 24, sessionCount: 3 }, { targetKm: 18, sessionCount: 3 }] })],
      activities: history(8, 4, 10),
      weekStart: WEEK_START,
      now: NOW,
    })
    expect(km(out)).toMatchObject({ target: 48, sourceGoalId: "m" })
  })

  it("follows the order when it is reversed", () => {
    const out = suggestWeeklyGoals({
      goals: [
        { ...marathon, display_order: 2 },
        { ...tenK, display_order: 1 },
      ],
      plans: [
        digest({ goalId: "m" }),
        digest({
          goalId: "t",
          weeks: [
            { targetKm: 20, sessionCount: 3 },
            { targetKm: 22, sessionCount: 3 },
            { targetKm: 24, sessionCount: 3 },
            { targetKm: 18, sessionCount: 3 },
          ],
        }),
      ],
      activities: history(8, 4, 10),
      weekStart: WEEK_START,
      now: NOW,
    })
    expect(km(out)).toMatchObject({ target: 24, sourceGoalId: "t" })
  })

  it("never adds two goals together", () => {
    const out = suggestWeeklyGoals({
      goals: [marathon, tenK],
      plans: [
        digest({ goalId: "m" }),
        digest({
          goalId: "t",
          weeks: [
            { targetKm: 20, sessionCount: 3 },
            { targetKm: 22, sessionCount: 3 },
            { targetKm: 24, sessionCount: 3 },
            { targetKm: 18, sessionCount: 3 },
          ],
        }),
      ],
      activities: history(8, 4, 10),
      weekStart: WEEK_START,
      now: NOW,
    })
    expect(km(out)!.target).toBeLessThan(48 + 24)
    expect(out.filter((s) => s.metric === "distance_km")).toHaveLength(1)
  })

  it("skips a goal whose race has been run", () => {
    const out = suggestWeeklyGoals({
      goals: [goal({ id: "past", target_date: "2026-05-01", display_order: 0 }), marathon],
      plans: [digest({ goalId: "m" })],
      activities: history(8, 4, 10),
      weekStart: WEEK_START,
      now: NOW,
    })
    expect(km(out)!.sourceGoalId).toBe("m")
  })

  it("skips a goal that has been made inactive", () => {
    const out = suggestWeeklyGoals({
      goals: [goal({ id: "off", is_active: false, display_order: 0 }), marathon],
      plans: [digest({ goalId: "m" })],
      activities: history(8, 4, 10),
      weekStart: WEEK_START,
      now: NOW,
    })
    expect(km(out)!.sourceGoalId).toBe("m")
  })

  it("skips a goal whose training has not started yet", () => {
    const out = suggestWeeklyGoals({
      goals: [
        goal({ id: "later", start_date: "2026-09-01", display_order: 0 }),
        marathon,
      ],
      plans: [digest({ goalId: "m" })],
      activities: history(8, 4, 10),
      weekStart: WEEK_START,
      now: NOW,
    })
    expect(km(out)!.sourceGoalId).toBe("m")
  })

  it("does not let a performance goal set the pace", () => {
    const out = suggestWeeklyGoals({
      goals: [
        goal({ id: "p", goal_category: "performance", display_order: 0 }),
        marathon,
      ],
      plans: [digest({ goalId: "m" })],
      activities: history(8, 4, 10),
      weekStart: WEEK_START,
      now: NOW,
    })
    expect(km(out)!.sourceGoalId).toBe("m")
  })

  it("falls back to history when every goal is spent", () => {
    const out = suggestWeeklyGoals({
      goals: [goal({ target_date: "2026-05-01" })],
      activities: history(6, 3, 10),
      weekStart: WEEK_START,
      now: NOW,
    })
    expect(km(out)!.source).toBe("history")
  })
})

describe("suggestWeeklyGoals — the race-proximity clamp", () => {
  const marathon = goal({ id: "m", name: "Marathon", target_date: "2026-11-14", display_order: 1 })

  it("eases the week when a second race lands inside it", () => {
    const raceSaturday = goal({
      id: "t",
      name: "Bislett 10K",
      target_date: "2026-08-15",
      display_order: 2,
    })
    const out = suggestWeeklyGoals({
      goals: [marathon, raceSaturday],
      plans: [digest({ goalId: "m" })], // week 3 = 48 km
      activities: history(8, 4, 10),
      weekStart: WEEK_START,
      now: NOW,
    })
    expect(km(out)!.target).toBeLessThan(48)
    expect(km(out)!.clampedByGoalId).toBe("t")
  })

  it("eases the week for a race just after it", () => {
    const raceNextTuesday = goal({
      id: "t",
      target_date: "2026-08-18",
      display_order: 2,
    })
    const out = suggestWeeklyGoals({
      goals: [marathon, raceNextTuesday],
      plans: [digest({ goalId: "m" })],
      activities: history(8, 4, 10), // a 40 km/week baseline
      weekStart: WEEK_START,
      now: NOW,
    })
    // 65% of the baseline, not 65% of the marathon plan's 48 km week.
    expect(km(out)!.target).toBe(26)
    expect(km(out)!.clampedByGoalId).toBe("t")
  })

  it("leaves the week alone for a race still weeks away", () => {
    const raceInAugustEnd = goal({ id: "t", target_date: "2026-08-29", display_order: 2 })
    const out = suggestWeeklyGoals({
      goals: [marathon, raceInAugustEnd],
      plans: [digest({ goalId: "m" })],
      activities: history(8, 4, 10),
      weekStart: WEEK_START,
      now: NOW,
    })
    expect(km(out)!.target).toBe(48)
    expect(km(out)!.clampedByGoalId).toBeUndefined()
  })

  it("trusts a nearby race's own plan over the fraction", () => {
    const raceSoon = goal({ id: "t", target_date: "2026-08-18", display_order: 2 })
    const out = suggestWeeklyGoals({
      goals: [marathon, raceSoon],
      plans: [
        digest({ goalId: "m" }),
        // The 10K's own block has tapered this week to 26 km — higher than the
        // blunt 65% fraction, and truer, because a coach wrote it.
        digest({
          goalId: "t",
          blockStartDate: WEEK_START,
          weeks: [{ targetKm: 26, sessionCount: 3 }],
        }),
      ],
      activities: history(8, 4, 10),
      weekStart: WEEK_START,
      now: NOW,
    })
    expect(km(out)!.target).toBe(26)
  })

  it("does not raise a week that is already lighter than the ceiling", () => {
    const raceSoon = goal({ id: "t", target_date: "2026-08-18", display_order: 2 })
    const out = suggestWeeklyGoals({
      goals: [marathon, raceSoon],
      plans: [
        digest({
          goalId: "m",
          blockStartDate: WEEK_START,
          weeks: [{ targetKm: 12, sessionCount: 2 }],
        }),
      ],
      activities: history(8, 4, 10),
      weekStart: WEEK_START,
      now: NOW,
    })
    expect(km(out)!.target).toBe(12)
  })

  it("caps sessions in a week that contains a race", () => {
    const raceSaturday = goal({ id: "t", target_date: "2026-08-15", display_order: 2 })
    const out = suggestWeeklyGoals({
      goals: [marathon, raceSaturday],
      plans: [digest({ goalId: "m" })], // week 3 asks for 5 sessions
      activities: history(8, 4, 10),
      weekStart: WEEK_START,
      now: NOW,
    })
    expect(sessions(out)!.target).toBe(3)
  })

  it("clamps for the pacesetter's own race too", () => {
    // One goal, racing this Saturday, no plan. Its own proximity has to lower
    // the week — the clamp is not only about competing goals.
    const out = suggestWeeklyGoals({
      goals: [goal({ id: "solo", target_date: "2026-08-15" })],
      activities: history(8, 4, 10),
      weekStart: WEEK_START,
      now: NOW,
    })
    const unclamped = suggestWeeklyGoals({
      goals: [goal({ id: "solo", target_date: "2026-11-14" })],
      activities: history(8, 4, 10),
      weekStart: WEEK_START,
      now: NOW,
    })
    expect(km(out)!.target).toBeLessThan(km(unclamped)!.target)
  })

  it("does not taper a week for a performance goal's deadline", () => {
    const deadlineFriday = goal({
      id: "p",
      goal_category: "performance",
      target_date: "2026-08-14",
      display_order: 2,
    })
    const out = suggestWeeklyGoals({
      goals: [marathon, deadlineFriday],
      plans: [digest({ goalId: "m" })],
      activities: history(8, 4, 10),
      weekStart: WEEK_START,
      now: NOW,
    })
    expect(km(out)!.target).toBe(48)
  })
})

describe("suggestWeeklyGoals — shape of the result", () => {
  it("returns at most one suggestion per metric", () => {
    const out = suggestWeeklyGoals({
      goals: [goal()],
      plans: [digest()],
      activities: history(8, 4, 10),
      weekStart: WEEK_START,
      now: NOW,
    })
    const metrics = out.map((s) => s.metric)
    expect(new Set(metrics).size).toBe(metrics.length)
  })

  it("suggests neither duration nor elevation", () => {
    // Duration would restate distance through average pace, and nothing says
    // whether a race is on trails. The type forbids both; this checks that
    // nothing widens it at runtime.
    const out = suggestWeeklyGoals({
      goals: [goal()],
      plans: [digest()],
      activities: history(8, 4, 10),
      weekStart: WEEK_START,
      now: NOW,
    })
    const metrics: string[] = out.map((s) => s.metric)
    expect(metrics.sort()).toEqual(["distance_km", "sessions"])
  })

  it("returns whole numbers", () => {
    const out = suggestWeeklyGoals({
      goals: [goal()],
      activities: history(7, 3, 8.4),
      weekStart: WEEK_START,
      now: NOW,
    })
    for (const s of out) expect(Number.isInteger(s.target)).toBe(true)
  })

  it("is a pure function of its input", () => {
    const args = {
      goals: [goal()],
      plans: [digest()],
      activities: history(8, 4, 10),
      weekStart: WEEK_START,
      now: NOW,
    }
    expect(suggestWeeklyGoals(args)).toEqual(suggestWeeklyGoals(args))
  })

  it("suggests for a past week from that week's point of view", () => {
    // Week 1 of the block, not week 3.
    const out = suggestWeeklyGoals({
      goals: [goal()],
      plans: [digest()],
      activities: history(8, 4, 10),
      weekStart: "2026-07-27",
      now: NOW,
    })
    expect(km(out)).toMatchObject({ target: 40, source: "plan" })
  })
})
