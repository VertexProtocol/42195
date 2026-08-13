import { describe, it, expect } from "vitest"
import { matchSessionsToActivities, type MatchableSession } from "./plan-session-match"

/**
 * The week from the screenshot that started this: a base run and a fartlek at
 * the same distance, separated only by the pace they are meant to be run at.
 */
const SAME_DISTANCE_WEEK: MatchableSession[] = [
  { type: "Base run", distance: "7 km", suggestedPace: "5:43–5:58 /km" },
  { type: "Fartlek", distance: "7 km", suggestedPace: "4:24–4:32 /km" },
]

describe("matchSessionsToActivities", () => {
  it("gives a fast run to the fast session when the distances are identical", () => {
    // Distance alone cannot tell these apart, and it used to hand the run to
    // whichever session was listed first.
    const matched = matchSessionsToActivities(SAME_DISTANCE_WEEK, [
      { distance_km: 7, pace_min_per_km: 4.5 },
    ])
    expect(matched).toEqual([false, true])
  })

  it("gives an easy run to the easy session", () => {
    const matched = matchSessionsToActivities(SAME_DISTANCE_WEEK, [
      { distance_km: 7, pace_min_per_km: 5.9 },
    ])
    expect(matched).toEqual([true, false])
  })

  it("sorts a week's runs into the sessions they were run as", () => {
    const matched = matchSessionsToActivities(SAME_DISTANCE_WEEK, [
      { distance_km: 7.1, pace_min_per_km: 4.4 },
      { distance_km: 6.9, pace_min_per_km: 5.8 },
    ])
    expect(matched).toEqual([true, true])
  })

  it("lets pace override a closer distance, within reason", () => {
    // The 7.4 km run is nearer the fartlek's distance, but it was run at easy
    // pace — so it belongs to the base run, and the quick 7.0 km to the fartlek.
    const matched = matchSessionsToActivities(
      [
        { type: "Base run", distance: "8 km", suggestedPace: "5:45–6:00 /km" },
        { type: "Fartlek", distance: "7 km", suggestedPace: "4:24–4:32 /km" },
      ],
      [
        { distance_km: 7.4, pace_min_per_km: 5.9 },
        { distance_km: 7.0, pace_min_per_km: 4.4 },
      ],
    )
    expect(matched).toEqual([true, true])
  })

  it("does not let pace overrule the distance gate", () => {
    // A perfectly paced 3 km is not a 12 km long run, however well it matches
    // on pace. Distance still decides who is a candidate at all.
    const matched = matchSessionsToActivities(
      [{ type: "Long run", distance: "12 km", suggestedPace: "6:00–6:15 /km" }],
      [{ distance_km: 3, pace_min_per_km: 6.1 }],
    )
    expect(matched).toEqual([false])
  })

  it("counts a run that falls just inside the 80 % gate", () => {
    const matched = matchSessionsToActivities(
      [{ type: "Long run", distance: "10 km" }],
      [{ distance_km: 8 }],
    )
    expect(matched).toEqual([true])
  })

  it("counts running further than planned", () => {
    const matched = matchSessionsToActivities(
      [{ type: "Base run", distance: "6 km" }],
      [{ distance_km: 9 }],
    )
    expect(matched).toEqual([true])
  })

  it("falls back to distance when the session carries no pace target", () => {
    // Hill repeats have no pace by design, and plans written before paces
    // existed have none at all. Neither should go unmatched.
    const matched = matchSessionsToActivities(
      [
        { type: "Hill repeats", distance: "6 km" },
        { type: "Long run", distance: "14 km" },
      ],
      [
        { distance_km: 14.2, pace_min_per_km: 6.2 },
        { distance_km: 6.1, pace_min_per_km: 5.4 },
      ],
    )
    expect(matched).toEqual([true, true])
  })

  it("falls back to distance when the run has no pace of its own", () => {
    const matched = matchSessionsToActivities(SAME_DISTANCE_WEEK, [{ distance_km: 7 }])
    // One of them is matched — which one is decided on distance, and they tie,
    // so the earlier session takes it. What matters is that nothing is lost.
    expect(matched.filter(Boolean)).toHaveLength(1)
  })

  it("derives a run's pace from its duration when Strava sent none", () => {
    const matched = matchSessionsToActivities(SAME_DISTANCE_WEEK, [
      { distance_km: 7, duration_seconds: 7 * 4.5 * 60 },
    ])
    expect(matched).toEqual([false, true])
  })

  it("spends each run once", () => {
    const matched = matchSessionsToActivities(
      [
        { type: "Base run", distance: "7 km", suggestedPace: "5:43–5:58 /km" },
        { type: "Base run", distance: "7 km", suggestedPace: "5:43–5:58 /km" },
      ],
      [{ distance_km: 7, pace_min_per_km: 5.8 }],
    )
    expect(matched.filter(Boolean)).toHaveLength(1)
  })

  it("matches nothing in a week with no runs in it", () => {
    expect(matchSessionsToActivities(SAME_DISTANCE_WEEK, [])).toEqual([false, false])
  })

  it("ignores a session whose distance cannot be read", () => {
    const matched = matchSessionsToActivities(
      [{ type: "Rest", distance: "—" }],
      [{ distance_km: 8, pace_min_per_km: 5.5 }],
    )
    expect(matched).toEqual([false])
  })
})
