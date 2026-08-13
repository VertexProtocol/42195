/**
 * Deciding which run finished which planned session.
 *
 * Nothing the runner does tells the app this. They plan a week, they go out
 * four times, and Strava sends back four activities with no idea what any of
 * them was meant to be. Matching them up is a guess, and this module is the
 * guess.
 *
 * It used to be made on distance alone, and a week is full of sessions that
 * are the same distance on purpose — a 7 km base run and a 7 km fartlek sit in
 * the same week precisely because the distance is not what separates them. A
 * runner who did the easy one and skipped the fartlek got the fartlek ticked
 * off, because the two were indistinguishable to the matcher and the fartlek
 * happened to be listed first.
 *
 * So pace weighs more heavily than distance here. It does not replace it:
 * distance still decides whether a run is a candidate at all, and a session
 * with no pace target — or a run with no usable pace — falls back to the
 * distance-only behaviour rather than going unmatched.
 *
 * Pure and deterministic, so both the server render and the plan screen can
 * reach the same answer.
 */

import { parsePaceRange } from "@/lib/pace-guide"
import { parseSessionDistanceKm } from "@/lib/training-sessions"

export interface MatchableSession {
  type: string
  distance: string
  /** The pace range printed beside the session, e.g. "5:20–5:30 /km". */
  suggestedPace?: string
}

export interface MatchableActivity {
  distance_km: number
  pace_min_per_km?: number | null
  duration_seconds?: number | null
}

/**
 * How short a run may fall and still count as having done the session. Running
 * further than planned always counts.
 */
export const MIN_DISTANCE_FRACTION = 0.8

/**
 * How much harder a pace miss counts than a distance miss, per unit of
 * relative error.
 *
 * Both terms are relative, so they are already comparable: 10 % off the
 * planned distance and 10 % off the target pace both score 0.1 before
 * weighting. The weight is what encodes "pace should govern over distance" —
 * at 3, a run has to be three times further off in distance than in pace
 * before distance decides the match. That is enough to pull an easy-paced run
 * away from the fartlek it happens to share a distance with, and not so much
 * that a 5 km jog can claim the 12 km long run on pace alone. The distance
 * gate below stops that outright in any case.
 */
export const PACE_WEIGHT = 3

/** min/km for an activity, from the stored pace or from distance and duration. */
function activityPace(activity: MatchableActivity): number | null {
  const stored = activity.pace_min_per_km == null ? null : Number(activity.pace_min_per_km)
  if (stored != null && Number.isFinite(stored) && stored > 0) return stored

  const km = Number(activity.distance_km)
  const seconds = activity.duration_seconds == null ? null : Number(activity.duration_seconds)
  if (!km || km <= 0 || !seconds || seconds <= 0) return null
  return seconds / 60 / km
}

/**
 * Which of a week's sessions were completed by that week's activities.
 *
 * Returns one boolean per session, in the order they were given. Every
 * activity completes at most one session, and every session is completed by at
 * most one activity.
 */
export function matchSessionsToActivities(
  sessions: MatchableSession[],
  activities: MatchableActivity[],
): boolean[] {
  const matched = new Array<boolean>(sessions.length).fill(false)
  if (activities.length === 0) return matched

  const targets = sessions
    .map((session, index) => ({
      index,
      km: parseSessionDistanceKm(session.distance),
      pace: parsePaceRange(session.suggestedPace),
    }))
    .filter((target) => target.km > 0)

  // Every (session, activity) pair the distance gate allows, scored.
  const candidates: { sessionIndex: number; activityIndex: number; cost: number }[] = []

  for (const target of targets) {
    for (let ai = 0; ai < activities.length; ai++) {
      const actualKm = Number(activities[ai].distance_km)
      if (!(actualKm >= target.km * MIN_DISTANCE_FRACTION)) continue

      const distanceCost = Math.abs(actualKm - target.km) / target.km

      // Neutral when either side is unknown, which leaves the pair ranked on
      // distance exactly as it was before pace entered into this.
      const actualPace = activityPace(activities[ai])
      const paceCost =
        target.pace != null && actualPace != null
          ? Math.abs(actualPace - target.pace) / target.pace
          : 0

      candidates.push({
        sessionIndex: target.index,
        activityIndex: ai,
        cost: distanceCost + PACE_WEIGHT * paceCost,
      })
    }
  }

  // Cheapest pair first, then each side is spoken for. Ties break on the
  // session's position in the week so the result does not depend on the order
  // the activities happened to arrive in.
  candidates.sort((a, b) => a.cost - b.cost || a.sessionIndex - b.sessionIndex)

  const usedSessions = new Set<number>()
  const usedActivities = new Set<number>()

  for (const { sessionIndex, activityIndex } of candidates) {
    if (usedSessions.has(sessionIndex) || usedActivities.has(activityIndex)) continue
    matched[sessionIndex] = true
    usedSessions.add(sessionIndex)
    usedActivities.add(activityIndex)
  }

  return matched
}
