/**
 * Where a runner is in their training cycle, derived from how far the race is.
 *
 * One vocabulary, one definition. There used to be two functions producing
 * "base" / "build" / "taper": this one, and a second that labelled a note's
 * position *within a four-week block*. Both reached the coach, so a note could
 * arrive tagged "build" meaning "week 3 of 4" while the plan around it was in
 * the base-building phase of the cycle. Same words, different meanings, no way
 * for the model to tell them apart.
 */

/** Days until the race at which each phase begins. */
const PHASE_BOUNDARY_DAYS = {
  baseBuilding: 84,
  build: 42,
  peak: 21,
} as const

export type RacePhase = "base-building" | "build" | "peak" | "taper"

/**
 * The training phase for a runner this many days out from their race.
 *
 * A past or same-day race counts as taper — there is no phase after the race,
 * and the plan generator rejects past race dates before this is ever reached.
 */
export function racePhase(daysUntilRace: number): RacePhase {
  if (daysUntilRace > PHASE_BOUNDARY_DAYS.baseBuilding) return "base-building"
  if (daysUntilRace > PHASE_BOUNDARY_DAYS.build) return "build"
  if (daysUntilRace > PHASE_BOUNDARY_DAYS.peak) return "peak"
  return "taper"
}

/** Days between a date and a race day, rounded up. Negative once the race has passed. */
export function daysUntil(targetDate: string, from: number = Date.now()): number {
  return Math.ceil((new Date(targetDate).getTime() - from) / (1000 * 60 * 60 * 24))
}
