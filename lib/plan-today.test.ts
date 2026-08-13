import { describe, it, expect } from "vitest"
import {
  activitiesInPlanWeek,
  deriveCurrentPlanWeeks,
  sessionKey,
  startOfWeek,
  summarisePlanWeek,
  type CurrentPlanWeek,
  type PlanWeekRow,
} from "./plan-today"
import type { TrainingSession } from "./types"

function session(overrides: Partial<TrainingSession> = {}): TrainingSession {
  return {
    type: "Base run",
    distance: "7 km",
    effort: "Steady easy",
    purpose: "Aerobic base",
    suggestedPace: "5:43–5:58 /km",
    ...overrides,
  }
}

function week(weekNumber: number, sessions: TrainingSession[]) {
  return { weekNumber, theme: `Week ${weekNumber}`, targetKm: 30, sessions, coachNote: null }
}

function row(overrides: Partial<PlanWeekRow> = {}): PlanWeekRow {
  return {
    goal_id: "g1",
    block_start_date: "2026-01-05", // a Monday
    plan: { weeks: [week(1, [session()]), week(2, [session()]), week(3, [session()])] },
    ...overrides,
  }
}

describe("startOfWeek", () => {
  it("snaps to Monday", () => {
    expect(startOfWeek(new Date("2026-01-08T15:00:00")).getDate()).toBe(5)
  })

  it("treats Sunday as the end of the week it closes, not the start of the next", () => {
    expect(startOfWeek(new Date("2026-01-11T15:00:00")).getDate()).toBe(5)
  })
})

describe("deriveCurrentPlanWeeks", () => {
  it("picks the week the block is in right now", () => {
    const weeks = deriveCurrentPlanWeeks([row()], new Date("2026-01-14T09:00:00"))
    expect(weeks.g1.weekNumber).toBe(2)
  })

  it("holds a mid-week day in the week it belongs to", () => {
    // Sunday of week 1 is still week 1.
    const weeks = deriveCurrentPlanWeeks([row()], new Date("2026-01-11T22:00:00"))
    expect(weeks.g1.weekNumber).toBe(1)
  })

  it("leaves out a block that has not started", () => {
    const weeks = deriveCurrentPlanWeeks([row()], new Date("2025-12-20T09:00:00"))
    expect(weeks.g1).toBeUndefined()
  })

  it("leaves out a block that has run out", () => {
    // Nothing to run today under a block that ended — the goal card's
    // "regenerate" prompt is what belongs there instead.
    const weeks = deriveCurrentPlanWeeks([row()], new Date("2026-02-16T09:00:00"))
    expect(weeks.g1).toBeUndefined()
  })

  it("snaps a mid-week block start back to its Monday", () => {
    const weeks = deriveCurrentPlanWeeks(
      [row({ block_start_date: "2026-01-08" })],
      new Date("2026-01-14T09:00:00"),
    )
    expect(weeks.g1.weekNumber).toBe(2)
  })

  it("skips a row with no plan in it", () => {
    expect(deriveCurrentPlanWeeks([row({ plan: null })], new Date("2026-01-14"))).toEqual({})
    expect(deriveCurrentPlanWeeks([row({ plan: { weeks: [] } })], new Date("2026-01-14"))).toEqual({})
  })

  it("keys the result by goal, so two pinned races do not share a week", () => {
    const weeks = deriveCurrentPlanWeeks(
      [row(), row({ goal_id: "g2", plan: { weeks: [week(1, [session({ type: "Long run" })])] } })],
      new Date("2026-01-07T09:00:00"),
    )
    expect(weeks.g1.sessions[0].type).toBe("Base run")
    expect(weeks.g2.sessions[0].type).toBe("Long run")
  })
})

describe("summarisePlanWeek", () => {
  const planWeek: CurrentPlanWeek = {
    goalId: "g1",
    weekNumber: 2,
    theme: "Building",
    targetKm: 31,
    weekStart: new Date("2026-01-12T00:00:00").toISOString(),
    sessions: [
      session({ type: "Long run", distance: "10.5 km", suggestedPace: "6:00–6:15 /km" }),
      session({ type: "Base run", distance: "7 km" }),
      session({ type: "Fartlek", distance: "7 km", suggestedPace: "4:24–4:32 /km" }),
    ],
  }

  it("hands a session back to the matcher when the runner cycles it to planned", () => {
    // The bug this covers: the status control cycles
    // planned -> completed -> skipped -> planned, and landing back on
    // "planned" used to store it as an answer. From then on the session was
    // pinned open — the 10.6 km run below matches the long run, and could
    // never tick it off again, with no way back from the screen because the
    // control cycles round to the value causing it.
    const progress = summarisePlanWeek(
      planWeek,
      [{ distance_km: 10.6, pace_min_per_km: 6.1 }],
      { "W2-0": "planned" },
    )
    expect(progress.done).toBe(1)
    expect(progress.next?.type).toBe("Base run")
  })

  it("still lets the runner say a matched session was skipped", () => {
    // "Skipped" is the real answer for "I did not do this", and it has to keep
    // beating the matcher — otherwise clearing the pin would take that away.
    const progress = summarisePlanWeek(
      planWeek,
      [{ distance_km: 10.6, pace_min_per_km: 6.1 }],
      { "W2-0": "skipped" },
    )
    expect(progress.done).toBe(0)
    expect(progress.skipped).toBe(1)
  })

  it("still lets the runner tick off a session nothing matches", () => {
    const progress = summarisePlanWeek(planWeek, [], { "W2-1": "completed" })
    expect(progress.done).toBe(1)
  })

  it("names the first outstanding session as what is next", () => {
    const progress = summarisePlanWeek(planWeek, [{ distance_km: 10.6, pace_min_per_km: 6.1 }])
    expect(progress.done).toBe(1)
    expect(progress.next?.type).toBe("Base run")
  })

  it("counts a run against the session it was actually run as", () => {
    // A quick 7 km is the fartlek, not the base run listed before it.
    const progress = summarisePlanWeek(planWeek, [{ distance_km: 7, pace_min_per_km: 4.4 }])
    expect(progress.statuses).toEqual(["planned", "planned", "completed"])
    expect(progress.next?.type).toBe("Long run")
  })

  it("lets the runner's own answer beat what the activities imply", () => {
    const progress = summarisePlanWeek(planWeek, [], { [sessionKey(2, 0)]: "completed" })
    expect(progress.done).toBe(1)
    expect(progress.next?.type).toBe("Base run")
  })

  it("counts a skipped session as answered for, not as still to come", () => {
    const progress = summarisePlanWeek(planWeek, [], {
      [sessionKey(2, 0)]: "skipped",
      [sessionKey(2, 1)]: "skipped",
    })
    expect(progress.skipped).toBe(2)
    expect(progress.done).toBe(0)
    expect(progress.next?.type).toBe("Fartlek")
  })

  it("has nothing next once every session is accounted for", () => {
    const progress = summarisePlanWeek(planWeek, [], {
      [sessionKey(2, 0)]: "completed",
      [sessionKey(2, 1)]: "skipped",
      [sessionKey(2, 2)]: "completed",
    })
    expect(progress.next).toBeNull()
    expect(progress.total).toBe(3)
  })

  it("keys statuses by the plan's week number, not by its position", () => {
    // A status stored under W2 must not be read as belonging to W1.
    const progress = summarisePlanWeek(planWeek, [], { [sessionKey(1, 0)]: "completed" })
    expect(progress.done).toBe(0)
  })
})

describe("activitiesInPlanWeek", () => {
  const weekStart = new Date("2026-01-12T00:00:00").toISOString()

  it("keeps the seven days of the week and nothing else", () => {
    const kept = activitiesInPlanWeek(
      [
        { date: "2026-01-11T18:00:00" }, // the Sunday before
        { date: "2026-01-12T06:00:00" }, // Monday
        { date: "2026-01-18T22:00:00" }, // Sunday
        { date: "2026-01-19T06:00:00" }, // the Monday after
      ],
      weekStart,
    )
    expect(kept.map((a) => a.date)).toEqual(["2026-01-12T06:00:00", "2026-01-18T22:00:00"])
  })
})
