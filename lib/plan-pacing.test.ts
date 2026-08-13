import { describe, it, expect } from "vitest"
import { applySessionPaces } from "./plan-pacing"
import { PACE_ASSIGNMENT_VERSION, buildPaceGuide, parsePaceRange } from "./pace-guide"
import type { TrainingPlan, TrainingSession } from "./types"

const guide = buildPaceGuide([], [], 42.195, 5.75) // easy pace 5:45 /km

function session(overrides: Partial<TrainingSession> = {}): TrainingSession {
  return {
    type: "Base run",
    distance: "7 km",
    effort: "Steady easy, breathing under control.",
    purpose: "Aerobic base.",
    ...overrides,
  }
}

function plan(sessions: TrainingSession[], targetKms = [31]): TrainingPlan {
  return {
    summary: "A block.",
    keyPrinciples: [],
    watchOut: null,
    weeks: targetKms.map((targetKm, i) => ({
      weekNumber: i + 1,
      theme: `Week ${i + 1}`,
      targetKm,
      coachNote: null,
      sessions: i === 0 ? sessions : [session()],
    })),
  }
}

const paceIn = (p: TrainingPlan, week: number, index: number) =>
  parsePaceRange(p.weeks[week].sessions[index].suggestedPace)

describe("applySessionPaces", () => {
  it("stamps the rule revision it paced by", () => {
    const paced = applySessionPaces(plan([session()]), guide, {
      fatigueSignal: "none",
      athleteLevel: "intermediate",
    })
    expect(paced.paceVersion).toBe(PACE_ASSIGNMENT_VERSION)
    expect(paced.paceSource).toBe(guide.source)
  })

  it("replaces a pace assigned by the old rules rather than keeping it", () => {
    // The read path used to skip any session that already had a pace, which is
    // right when filling blanks and wrong when correcting them.
    const stale = plan([session({ type: "Recovery run", suggestedPace: "5:43–5:58 /km" })])
    const paced = applySessionPaces(stale, guide, {
      fatigueSignal: "none",
      athleteLevel: "intermediate",
    })
    expect(paced.weeks[0].sessions[0].suggestedPace).not.toBe("5:43–5:58 /km")
  })

  it("takes away a pace from a session whose zone no longer carries one", () => {
    const stale = plan([session({ type: "Hill repeats", suggestedPace: "4:24–4:32 /km" })])
    const paced = applySessionPaces(stale, guide, {
      fatigueSignal: "none",
      athleteLevel: "intermediate",
    })
    expect(paced.weeks[0].sessions[0].suggestedPace).toBeUndefined()
  })

  it("takes the model's pace figures out of the prose beside the number", () => {
    const wordy = plan([
      session({
        effort: "Easy, conversational Z2 (roughly 115-133 bpm), 7:15-7:45/km, and fine to be slower on hills.",
        purpose: "Time on feet at 6:30/km.",
      }),
    ])
    const paced = applySessionPaces(wordy, guide, {
      fatigueSignal: "none",
      athleteLevel: "intermediate",
    })
    expect(paced.weeks[0].sessions[0].effort).toBe(
      "Easy, conversational Z2 (roughly 115-133 bpm), and fine to be slower on hills.",
    )
    // The sentence keeps its full stop even where the figure was the end of
    // it. A stub reads a little abruptly; a second contradicting number reads
    // as a bug, and only stored plans are affected — the prompt now stops new
    // ones being written in the first place.
    expect(paced.weeks[0].sessions[0].purpose).toBe("Time on feet at.")
  })

  it("runs a recovery week slower throughout", () => {
    // Week 2 drops far enough below week 1 to read as a recovery week.
    const block = plan([session()], [40, 20])
    const paced = applySessionPaces(block, guide, {
      fatigueSignal: "none",
      athleteLevel: "intermediate",
    })
    expect(paceIn(paced, 1, 0)!).toBeGreaterThan(paceIn(paced, 0, 0)!)
  })

  it("pulls the quality paces back when the runner is showing fatigue", () => {
    const week = [session({ type: "Tempo run" })]
    const fresh = applySessionPaces(plan(week), guide, {
      fatigueSignal: "none",
      athleteLevel: "intermediate",
    })
    const tired = applySessionPaces(plan(week), guide, {
      fatigueSignal: "both",
      athleteLevel: "intermediate",
    })
    expect(paceIn(tired, 0, 0)!).toBeGreaterThan(paceIn(fresh, 0, 0)!)
  })

  it("leaves the easy sessions alone when the runner is showing fatigue", () => {
    // A fatigued runner's easy pace is already their easy pace. It is the
    // quality work that gets eased off.
    const week = [session({ type: "Base run" })]
    const fresh = applySessionPaces(plan(week), guide, {
      fatigueSignal: "none",
      athleteLevel: "intermediate",
    })
    const tired = applySessionPaces(plan(week), guide, {
      fatigueSignal: "both",
      athleteLevel: "intermediate",
    })
    expect(paceIn(tired, 0, 0)).toBe(paceIn(fresh, 0, 0))
  })

  it("does not touch the plan it was given", () => {
    const original = plan([session({ type: "Recovery run" })])
    applySessionPaces(original, guide, { fatigueSignal: "none", athleteLevel: "intermediate" })
    expect(original.weeks[0].sessions[0].suggestedPace).toBeUndefined()
    expect(original.paceVersion).toBeUndefined()
  })
})
