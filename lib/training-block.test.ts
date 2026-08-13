import { describe, it, expect } from "vitest"
import {
  mondayOf,
  computeBlockStartDate,
  blockWindow,
  racesInBlock,
  holdRaceWeeks,
  blockWeeksRemaining,
  sessionCountsForBlock,
  raceSessionsForWeek,
  raceKmInWeek,
  type CalendarRace,
  type RaceInBlock,
} from "./training-block"

// 2026-01-05 is a Monday; 2026-01-11 the Sunday that closes that week.
const MONDAY = "2026-01-05"

function race(overrides: Partial<CalendarRace> = {}): CalendarRace {
  return {
    id: "other",
    name: "Sentrumsløpet",
    target_date: "2026-01-17",
    target_distance_km: 10,
    goal_category: "event_training",
    ...overrides,
  }
}

describe("mondayOf", () => {
  it("returns the day itself for a Monday", () => {
    expect(mondayOf(new Date("2026-01-05T09:00:00Z")).toISOString().split("T")[0]).toBe(MONDAY)
  })

  it("walks back to Monday from midweek", () => {
    expect(mondayOf(new Date("2026-01-08T09:00:00Z")).toISOString().split("T")[0]).toBe(MONDAY)
  })

  it("treats Sunday as the end of the week that began six days earlier, not the start of the next", () => {
    expect(mondayOf(new Date("2026-01-11T23:00:00Z")).toISOString().split("T")[0]).toBe(MONDAY)
  })
})

describe("computeBlockStartDate", () => {
  it("starts this Monday when there is no previous block", () => {
    expect(computeBlockStartDate({ today: new Date("2026-01-08T12:00:00Z") })).toBe(MONDAY)
  })

  it("follows on from the previous block rather than restarting the ramp", () => {
    // A 4-week block from 2026-01-05 ends after 2026-02-01; the next starts 02-02.
    expect(
      computeBlockStartDate({
        prevBlockStartDate: MONDAY,
        prevWeekCount: 4,
        today: new Date("2026-01-28T12:00:00Z"),
      }),
    ).toBe("2026-02-02")
  })

  it("starts this Monday when the previous block already ended", () => {
    // Regenerating a month after the old block lapsed: its follow-on Monday is
    // in the past, and a block whose first weeks are behind you is unrunnable.
    expect(
      computeBlockStartDate({
        prevBlockStartDate: MONDAY,
        prevWeekCount: 4,
        today: new Date("2026-03-11T12:00:00Z"),
      }),
    ).toBe("2026-03-09")
  })

  it("ignores a previous block with no weeks", () => {
    expect(
      computeBlockStartDate({
        prevBlockStartDate: MONDAY,
        prevWeekCount: 0,
        today: new Date("2026-01-08T12:00:00Z"),
      }),
    ).toBe(MONDAY)
  })
})

describe("blockWindow", () => {
  it("ends on the Monday after the final week, exclusive", () => {
    const { start, end } = blockWindow(MONDAY, 4)
    expect(start.toISOString().split("T")[0]).toBe(MONDAY)
    expect(end.toISOString().split("T")[0]).toBe("2026-02-02")
  })
})

describe("blockWeeksRemaining", () => {
  it("counts the whole block before it starts running", () => {
    expect(blockWeeksRemaining(MONDAY, 4, new Date("2026-01-05T09:00:00Z"))).toBe(4)
  })

  it("counts the week in progress as still to run", () => {
    // 2026-01-20 is the Tuesday of the block's third week: that week and the
    // fourth are still ahead of the runner.
    expect(blockWeeksRemaining(MONDAY, 4, new Date("2026-01-20T09:00:00Z"))).toBe(2)
  })

  it("is zero for a block that has ended", () => {
    expect(blockWeeksRemaining(MONDAY, 4, new Date("2026-02-02T09:00:00Z"))).toBe(0)
  })

  it("is zero well after the block ended rather than going negative", () => {
    expect(blockWeeksRemaining(MONDAY, 4, new Date("2026-05-02T09:00:00Z"))).toBe(0)
  })
})

describe("racesInBlock", () => {
  it("finds a race inside the window and places it in the right week", () => {
    const found = racesInBlock([race()], "driving", MONDAY, 4)
    expect(found).toHaveLength(1)
    expect(found[0].weekIndex).toBe(1) // 2026-01-17 is in the second week
    expect(found[0].distanceKm).toBe(10)
  })

  it("excludes a performance goal, which is a target and not a start line", () => {
    // "Sub-40 for 10 km by June" has a date and a distance like a race does.
    // Written into the block it would become a race the runner never turns up
    // to, taking a session and its volume with it.
    expect(racesInBlock([race({ goal_category: "performance" })], "driving", MONDAY, 4)).toEqual([])
  })

  it("excludes the race the block is being built for", () => {
    expect(racesInBlock([race({ id: "driving" })], "driving", MONDAY, 4)).toEqual([])
  })

  it("excludes races before the block starts", () => {
    expect(racesInBlock([race({ target_date: "2026-01-04" })], "driving", MONDAY, 4)).toEqual([])
  })

  it("excludes races after the block ends", () => {
    // 2026-02-02 is the first day outside a 4-week block from 01-05.
    expect(racesInBlock([race({ target_date: "2026-02-02" })], "driving", MONDAY, 4)).toEqual([])
  })

  it("includes a race on the block's very first day", () => {
    const found = racesInBlock([race({ target_date: MONDAY })], "driving", MONDAY, 4)
    expect(found[0].weekIndex).toBe(0)
  })

  it("includes a race on the block's final day", () => {
    const found = racesInBlock([race({ target_date: "2026-02-01" })], "driving", MONDAY, 4)
    expect(found[0].weekIndex).toBe(3)
  })

  it("returns races in date order", () => {
    const found = racesInBlock(
      [
        race({ id: "b", target_date: "2026-01-25", name: "Later" }),
        race({ id: "a", target_date: "2026-01-11", name: "Earlier" }),
      ],
      "driving",
      MONDAY,
      4,
    )
    expect(found.map((r) => r.name)).toEqual(["Earlier", "Later"])
  })
})

describe("holdRaceWeeks", () => {
  function inBlock(overrides: Partial<RaceInBlock> = {}): RaceInBlock {
    return { goalId: "other", name: "Sentrumsløpet", distanceKm: 10, date: "2026-01-17", weekIndex: 1, ...overrides }
  }

  it("leaves the targets untouched when no race falls in the block", () => {
    const targets = [40, 44, 48, 36]
    const { targets: held, notes } = holdRaceWeeks(targets, [])
    expect(held).toEqual(targets)
    expect(notes).toEqual([])
  })

  it("does not let a race week step up from the week before it", () => {
    const { targets: held } = holdRaceWeeks([40, 44, 48, 36], [inBlock()])
    expect(held[1]).toBe(40)
  })

  it("leaves a race week that was already a step down alone", () => {
    const { targets: held } = holdRaceWeeks([48, 40, 44, 36], [inBlock()])
    expect(held[1]).toBe(40)
  })

  it("raises a week too small to hold the race itself", () => {
    // A half marathon inside an 18 km week: the race alone overruns it.
    const { targets: held } = holdRaceWeeks([20, 18, 24, 20], [inBlock({ distanceKm: 21.1 })])
    expect(held[1]).toBe(26) // 21.1 + 5 km recovery, rounded
  })

  it("does not touch the weeks after the race", () => {
    const { targets: held } = holdRaceWeeks([40, 44, 48, 36], [inBlock()])
    expect(held[2]).toBe(48)
    expect(held[3]).toBe(36)
  })

  it("holds a race in week one against the floor but has no prior week to hold to", () => {
    const { targets: held } = holdRaceWeeks([12, 44, 48, 36], [inBlock({ weekIndex: 0 })])
    expect(held[0]).toBe(15) // 10 + 5
  })

  it("sums two races landing in the same week", () => {
    const { targets: held } = holdRaceWeeks(
      [20, 18, 24, 20],
      [inBlock({ distanceKm: 10 }), inBlock({ goalId: "third", name: "Parkrun", distanceKm: 5 })],
    )
    expect(held[1]).toBe(20) // 15 km of racing + 5 km recovery
  })

  it("explains every change it makes", () => {
    const { notes } = holdRaceWeeks([40, 44, 48, 36], [inBlock()])
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain("Week 2")
    expect(notes[0]).toContain("Sentrumsløpet")
  })

  it("ignores a race indexed outside the block", () => {
    const targets = [40, 44]
    expect(holdRaceWeeks(targets, [inBlock({ weekIndex: 7 })]).targets).toEqual(targets)
  })
})

describe("sessionCountsForBlock", () => {
  function inBlock(overrides: Partial<RaceInBlock> = {}): RaceInBlock {
    return { goalId: "other", name: "Sentrumsløpet", distanceKm: 10, date: "2026-01-17", weekIndex: 1, ...overrides }
  }
  // Stand-in for supportedSessionCount: four sessions in a normal week, fewer
  // once the week gets small.
  const supported = (km: number) => (km >= 30 ? 4 : km >= 15 ? 3 : 2)

  it("leaves weeks without a race at the full count", () => {
    expect(sessionCountsForBlock([40, 40, 40], [], supported)).toEqual([4, 4, 4])
  })

  it("takes the race out of its week's session count", () => {
    // Week 2 is a 40 km week with a 10 km race: 30 km of training supports
    // four, and the race is one of the week's runs, so three are prescribed.
    expect(sessionCountsForBlock([40, 40, 40], [inBlock()], supported)).toEqual([4, 3, 4])
  })

  it("counts against what is left after the race, not the whole week", () => {
    // 20 km week, half marathon in it: there is no training volume left to
    // spread, so the week is the race and one run.
    // The second week is an ordinary 20 km week and keeps its three.
    expect(sessionCountsForBlock([20, 20], [inBlock({ weekIndex: 0, distanceKm: 21.1 })], supported)).toEqual([1, 3])
  })

  it("never drops a week to zero sessions", () => {
    expect(
      sessionCountsForBlock(
        [12],
        [inBlock({ weekIndex: 0 }), inBlock({ weekIndex: 0, goalId: "x", name: "Parkrun", distanceKm: 5 })],
        supported,
      ),
    ).toEqual([1])
  })
})

describe("raceSessionsForWeek", () => {
  const fmt = (km: number) => `${km} km`
  const race1: RaceInBlock = {
    goalId: "other", name: "Sentrumsløpet", distanceKm: 10, date: "2026-01-17", weekIndex: 1,
  }

  it("writes nothing for a week with no race", () => {
    expect(raceSessionsForWeek([race1], 0, fmt)).toEqual([])
  })

  it("names the race so its zone is recognised as pace-less", () => {
    // The `Race:` prefix is what detectZone matches to leave the entry without
    // a pace — see lib/pace-guide.ts.
    const [session] = raceSessionsForWeek([race1], 1, fmt)
    expect(session.type).toBe("Race: Sentrumsløpet")
    expect(session.distance).toBe("10 km")
    expect(session.purpose).toContain("2026-01-17")
  })

  it("writes one session per race when two land in the same week", () => {
    const race2: RaceInBlock = { ...race1, goalId: "x", name: "Parkrun", distanceKm: 5 }
    expect(raceSessionsForWeek([race1, race2], 1, fmt)).toHaveLength(2)
  })
})

describe("raceKmInWeek", () => {
  const races: RaceInBlock[] = [
    { goalId: "a", name: "A", distanceKm: 10, date: "2026-01-17", weekIndex: 1 },
    { goalId: "b", name: "B", distanceKm: 5, date: "2026-01-18", weekIndex: 1 },
    { goalId: "c", name: "C", distanceKm: 21.1, date: "2026-01-25", weekIndex: 2 },
  ]

  it("is zero for a week with no race", () => {
    expect(raceKmInWeek(races, 0)).toBe(0)
  })

  it("sums the races in a week", () => {
    expect(raceKmInWeek(races, 1)).toBe(15)
  })
})
