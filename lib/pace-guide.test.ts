import { describe, it, expect } from "vitest"
import {
  PACE_ASSIGNMENT_VERSION,
  assignSessionPace,
  buildPaceGuide,
  detectZone,
  parsePaceRange,
  planNeedsPaces,
  planPacesStale,
  stripPaceFigures,
  type PaceGuide,
} from "./pace-guide"
import type { RacePrediction } from "./training-utils"
import type { TrainingPlan } from "./types"

/** A guide built the way a real runner's would be: from their easy pace. */
function guideFromEasyPace(easyPaceMinPerKm: number): PaceGuide {
  return buildPaceGuide([], [], 42.195, easyPaceMinPerKm)
}

/** The centre of an assigned range, in min/km, for comparing zones. */
function paceOf(sessionType: string, guide: PaceGuide): number {
  const assigned = assignSessionPace(sessionType, guide)
  expect(assigned).not.toBeNull()
  const centre = parsePaceRange(assigned)
  expect(centre).not.toBeNull()
  return centre as number
}

describe("detectZone", () => {
  it("gives a recovery run its own zone rather than the easy one", () => {
    // It used to fall through to "easy", which is what put a Z1 recovery run
    // at the same pace as the Z2 base run beside it.
    expect(detectZone("Recovery run")).toBe("recovery")
    expect(detectZone("Shakeout jog")).toBe("recovery")
  })

  it("reads a fartlek as tempo work, not as intervals", () => {
    // Its surges are Z3. Pricing them at 5K interval pace made the number
    // beside the session two zones harder than the effort line described.
    expect(detectZone("Fartlek")).toBe("tempo")
  })

  it("gives hill repeats no pace zone at all", () => {
    // Uphill pace is set by the gradient, not by fitness.
    expect(detectZone("Hill repeats")).toBeNull()
  })

  it("still reads the ordinary session names", () => {
    expect(detectZone("Long run")).toBe("long")
    expect(detectZone("Base run")).toBe("easy")
    expect(detectZone("Tempo run")).toBe("tempo")
    expect(detectZone("Intervals")).toBe("interval")
    expect(detectZone("Race pace run")).toBe("race")
  })
})

describe("buildPaceGuide — zone ordering", () => {
  const guide = guideFromEasyPace(5.75) // 5:45 /km

  it("runs recovery slower than the long run, and the long run slower than easy", () => {
    // The bug this pins: with recovery sharing the easy pace, a plan showed
    // "Recovery run 5:43–5:58" above "Long run 6:00–6:15" — the Z1 session
    // faster than the Z2 one.
    const recovery = paceOf("Recovery run", guide)
    const long = paceOf("Long run", guide)
    const easy = paceOf("Base run", guide)

    expect(recovery).toBeGreaterThan(long)
    expect(long).toBeGreaterThan(easy)
  })

  it("runs the quality zones faster than easy, in order", () => {
    const easy = paceOf("Base run", guide)
    const tempo = paceOf("Tempo run", guide)
    const interval = paceOf("Intervals", guide)

    expect(tempo).toBeLessThan(easy)
    expect(interval).toBeLessThan(tempo)
  })

  it("keeps a fast threshold test from landing behind easy pace", () => {
    // Zones come from different sources — easy from training history, tempo
    // from a test run — so nothing stops them crossing without the guard.
    // Here the runner's easy runs are far slower than their threshold test.
    const crossed = buildPaceGuide(
      [],
      [{ derived_metrics: { threshold_pace: 7.0 }, created_at: "2026-01-01" }],
      10,
      5.0,
    )
    expect(paceOf("Tempo run", crossed)).toBeLessThan(paceOf("Base run", crossed))
  })

  it("leaves race pace out of the ladder", () => {
    // Marathon pace is slower than threshold and 5K pace is faster, so there
    // is no fixed rung for it. This only asserts it is produced at all.
    const predictions: RacePrediction[] = [
      { distance_km: 42.195, distance_label: "Marathon", predicted_seconds: 4 * 3600 } as RacePrediction,
    ]
    const withRace = buildPaceGuide(predictions, [], 42.195, 6.5)
    expect(withRace.racePace).not.toBeNull()
  })
})

describe("assignSessionPace", () => {
  it("prints no pace for a session whose zone has none", () => {
    expect(assignSessionPace("Hill repeats", guideFromEasyPace(5.5))).toBeNull()
  })

  it("prints nothing when the guide has no data to go on", () => {
    expect(assignSessionPace("Base run", buildPaceGuide([], [], 10, null))).toBeNull()
  })

  it("applies a modifier that slows the target", () => {
    const guide = guideFromEasyPace(5.5)
    expect(paceOf("Base run", guide)).toBeLessThan(
      parsePaceRange(assignSessionPace("Base run", guide, 1.1)) as number,
    )
  })
})

describe("parsePaceRange", () => {
  it("takes the middle of a range", () => {
    expect(parsePaceRange("5:20–5:30 /km")).toBeCloseTo(5.4167, 3)
  })

  it("accepts a plain hyphen as well as an en dash", () => {
    expect(parsePaceRange("5:20-5:30 /km")).toBeCloseTo(5.4167, 3)
  })

  it("reads a single figure", () => {
    expect(parsePaceRange("6:00 /km")).toBeCloseTo(6, 5)
  })

  it("returns null for anything that is not a pace", () => {
    expect(parsePaceRange("easy, conversational")).toBeNull()
    expect(parsePaceRange(undefined)).toBeNull()
    expect(parsePaceRange("")).toBeNull()
  })
})

describe("stripPaceFigures", () => {
  it("takes the model's pace out of an effort line", () => {
    // Straight from a generated plan: the text said 7:15–7:45 while the pace
    // computed from the runner's own history, printed beside it, said 6:00–6:15.
    expect(
      stripPaceFigures(
        "Easy, conversational Z2 (roughly 115-133 bpm), 7:15-7:45/km, and fine to be slower on hills.",
      ),
    ).toBe("Easy, conversational Z2 (roughly 115-133 bpm), and fine to be slower on hills.")
  })

  it("removes a single figure with its qualifier", () => {
    expect(stripPaceFigures("Hold around 5:30 /km throughout.")).toBe("Hold throughout.")
  })

  it("leaves heart rates, durations and distances alone", () => {
    const text = "5-6 surges of 2 minutes at Z3 (140-150 bpm), 7 km total."
    expect(stripPaceFigures(text)).toBe(text)
  })

  it("leaves prose without a pace untouched", () => {
    const text = "Very easy Z1, slower than feels natural. Under 120 bpm."
    expect(stripPaceFigures(text)).toBe(text)
  })
})

function plan(paces: Array<string | undefined>[]): Pick<TrainingPlan, "weeks"> {
  return {
    weeks: paces.map((weekPaces, i) => ({
      weekNumber: i + 1,
      theme: "Build",
      targetKm: 40,
      coachNote: null,
      sessions: weekPaces.map((suggestedPace) => ({
        type: "Base run",
        distance: "10 km",
        effort: "Easy",
        purpose: "Aerobic base",
        suggestedPace,
      })),
    })),
  }
}

describe("planNeedsPaces", () => {
  it("is false when every session already has a pace", () => {
    // The common case: a plan generated since paces became part of generation.
    // Nothing to compute, so the caller can skip building a pace guide at all.
    expect(planNeedsPaces(plan([["5:20–5:30 /km", "5:20–5:30 /km"], ["5:15–5:25 /km"]]))).toBe(false)
  })

  it("is true when any session is missing one", () => {
    expect(planNeedsPaces(plan([["5:20–5:30 /km", undefined]]))).toBe(true)
    expect(planNeedsPaces(plan([["5:20–5:30 /km"], [undefined]]))).toBe(true)
  })

  it("is true for a plan predating pace assignment entirely", () => {
    expect(planNeedsPaces(plan([[undefined, undefined], [undefined]]))).toBe(true)
  })

  it("treats an empty pace string as missing", () => {
    // assignSessionPace returns null when it has no data for a zone, and the
    // route only assigns truthy values — an empty string means unassigned.
    expect(planNeedsPaces(plan([[""]]))).toBe(true)
  })

  it("handles a missing or empty plan without throwing", () => {
    expect(planNeedsPaces(null)).toBe(false)
    expect(planNeedsPaces(undefined)).toBe(false)
    expect(planNeedsPaces({ weeks: [] })).toBe(false)
  })

  it("does not count hill repeats as missing a pace", () => {
    // They never get one, so counting them would mark every plan containing
    // one as unfinished forever — and have the read path re-pace and rewrite
    // it on every single read.
    const withHills: Pick<TrainingPlan, "weeks"> = {
      weeks: [
        {
          weekNumber: 1,
          theme: "Build",
          targetKm: 40,
          coachNote: null,
          sessions: [
            {
              type: "Base run",
              distance: "10 km",
              effort: "Easy",
              purpose: "Aerobic base",
              suggestedPace: "5:20–5:30 /km",
            },
            { type: "Hill repeats", distance: "6 km", effort: "Hard uphill", purpose: "Strength" },
          ],
        },
      ],
    }
    expect(planNeedsPaces(withHills)).toBe(false)
  })
})

describe("planPacesStale", () => {
  const weeks = [{ weekNumber: 1, theme: "t", targetKm: 30, sessions: [], coachNote: null }]

  it("flags a plan written before the paces were versioned", () => {
    expect(planPacesStale({ weeks })).toBe(true)
  })

  it("leaves a plan paced by the current rules alone", () => {
    expect(planPacesStale({ weeks, paceVersion: PACE_ASSIGNMENT_VERSION })).toBe(false)
  })

  it("has nothing to say about a plan with no weeks", () => {
    expect(planPacesStale({ weeks: [] })).toBe(false)
    expect(planPacesStale(null)).toBe(false)
  })
})
