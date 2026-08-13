/**
 * Pace Guide — Deterministic per-session pace targets
 *
 * Computes training pace zones from:
 *   1. Test run derived metrics (threshold pace — highest priority)
 *   2. Riegel race predictions from activity history
 *   3. Historical easy pace from recent runs
 *
 * All calculations are deterministic. AI is given the result as context
 * but does NOT compute these values.
 */

import type { RacePrediction } from "@/lib/training-utils"
import type { TrainingPlan } from "@/lib/types"

export interface PaceGuide {
  recoveryPace: number | null  // min/km — Z1, deliberately slower than easy
  easyPace: number | null      // min/km — conversational aerobic effort
  longRunPace: number | null   // min/km — slightly slower than easy
  tempoPace: number | null     // min/km — lactate threshold effort
  intervalPace: number | null  // min/km — ~5K race effort
  racePace: number | null      // min/km — goal race pace
  source: "test_run" | "prediction" | "historical" | "none"
}

/**
 * How the paces printed beside a session are computed.
 *
 * Bumped whenever a change would give an existing plan different numbers, so
 * stored plans can be re-paced once on read instead of carrying targets that
 * the current rules would never produce. Version 1 is every plan written
 * before this field existed: those are the ones where a recovery run and a
 * base run came out at the same pace and the long run came out slower than
 * both.
 */
export const PACE_ASSIGNMENT_VERSION = 2

interface TestRunRow {
  derived_metrics: Record<string, number | null> | null
  created_at: string
}

/**
 * Build a full pace guide for a runner.
 *
 * @param predictions   Pre-computed Riegel race predictions (avoids re-running on partial Activity rows)
 * @param testRuns      Test runs sorted newest-first
 * @param goalDistanceKm  Target race distance
 * @param recentEasyPace  Pre-computed easy pace (avg of slowest 50% of runs)
 */
export function buildPaceGuide(
  predictions: RacePrediction[],
  testRuns: TestRunRow[],
  goalDistanceKm: number,
  recentEasyPace: number | null,
): PaceGuide {
  // --- Step 1: threshold pace from most recent test run with valid derived metrics ---
  let thresholdPace: number | null = null
  for (const tr of testRuns) {
    const m = tr.derived_metrics
    if (m?.threshold_pace && m.threshold_pace > 0) {
      thresholdPace = m.threshold_pace
      break
    }
  }

  // --- Step 2: pace zones from pre-computed race predictions ---
  const pred5k = predictions.find((p) => p.distance_km === 5) ?? null
  const pred10k = predictions.find((p) => p.distance_km === 10) ?? null

  // Find prediction closest to goal distance; fall back to Riegel interpolation
  let predGoal: number | null = null
  if (predictions.length > 0) {
    const closest = predictions.reduce((best, p) =>
      Math.abs(p.distance_km - goalDistanceKm) < Math.abs(best.distance_km - goalDistanceKm) ? p : best
    )
    if (Math.abs(closest.distance_km - goalDistanceKm) < 0.5) {
      predGoal = closest.predicted_seconds / 60 / closest.distance_km
    } else {
      // Riegel interpolation from closest prediction
      const ratio = goalDistanceKm / closest.distance_km
      const secs = closest.predicted_seconds * ratio ** 1.06
      predGoal = secs / 60 / goalDistanceKm
    }
  }

  // --- Step 3: determine source confidence ---
  const source: PaceGuide["source"] = thresholdPace
    ? "test_run"
    : pred5k
      ? "prediction"
      : recentEasyPace
        ? "historical"
        : "none"

  // --- Step 4: build pace zones ---

  // Marathon prediction can give a fitness-derived easy pace estimate (~marathon + 15%)
  const predMarathon = predictions.find((p) => p.distance_km > 40)
  const fitnessEasyPace = predMarathon
    ? (predMarathon.predicted_seconds / 60 / predMarathon.distance_km) * 1.15
    : null

  // Easy: take the faster of historical easy pace and fitness-derived estimate, or fall back to threshold
  const easyPaceRaw = recentEasyPace != null && fitnessEasyPace != null
    ? Math.min(recentEasyPace, fitnessEasyPace)  // lower min/km = faster
    : (recentEasyPace ?? fitnessEasyPace)
  const easyPace = easyPaceRaw ?? (thresholdPace ? thresholdPace * 1.22 : null)

  // Long run: 5% slower than easy (more aerobic, less fatigue)
  const longRunPace = easyPace ? easyPace * LONG_RUN_PACE_FACTOR : null

  // Recovery: slower again. A recovery run is Z1 — the session whose whole
  // point is that it is easier than an easy run, so it cannot share the easy
  // pace. It used to: "Recovery run" fell through to the easy zone, which put
  // it level with the base run and *faster* than the Z2 long run.
  const recoveryPace = easyPace ? easyPace * RECOVERY_PACE_FACTOR : null

  // Tempo: test run threshold > 10K-derived > easy-based estimate
  const tempoPace =
    thresholdPace ??
    (pred10k ? (pred10k.predicted_seconds / 60 / 10) * 1.04 : null) ??
    (easyPace ? easyPace * 0.88 : null)

  // Interval: 5K prediction > tempo-derived estimate
  const intervalPace = pred5k
    ? pred5k.predicted_seconds / 60 / 5
    : tempoPace
      ? tempoPace * 0.94
      : null

  // Race pace: goal-distance prediction > tempo-derived
  const racePace = predGoal ?? (tempoPace ? tempoPace * 0.97 : null)

  return orderAerobicZones({
    recoveryPace,
    easyPace,
    longRunPace,
    tempoPace,
    intervalPace,
    racePace,
    source,
  })
}

/** Long runs sit this much slower than easy pace. */
const LONG_RUN_PACE_FACTOR = 1.05
/** Recovery runs sit this much slower than easy pace. */
const RECOVERY_PACE_FACTOR = 1.12

/**
 * Keeps the aerobic zones in the order a runner reads them in.
 *
 * The zones come from different sources — easy from training history, tempo
 * from a test run, intervals from a 5K prediction — so nothing has been
 * stopping them crossing over. A threshold test on a good day against a
 * fortnight of very slow easy runs could put tempo pace behind easy pace, and
 * the plan would then ask for a "hard" session slower than the recovery jog
 * beside it.
 *
 * Slowest to fastest: recovery, long, easy, tempo, interval. Race pace is left
 * out on purpose — where it belongs depends on the race. Marathon pace is
 * slower than threshold and 5K pace is faster, so there is no fixed rung for
 * it on this ladder.
 */
function orderAerobicZones(guide: PaceGuide): PaceGuide {
  // A hair of separation, so two zones never print the same range and read as
  // a bug in the other direction.
  const MARGIN = 1.02

  const easyPace = guide.easyPace
  if (easyPace == null) return guide

  return {
    ...guide,
    longRunPace: guide.longRunPace == null ? null : Math.max(guide.longRunPace, easyPace * MARGIN),
    recoveryPace:
      guide.recoveryPace == null
        ? null
        : Math.max(
            guide.recoveryPace,
            (guide.longRunPace ?? easyPace) * MARGIN,
            easyPace * MARGIN * MARGIN,
          ),
    tempoPace: guide.tempoPace == null ? null : Math.min(guide.tempoPace, easyPace / MARGIN),
    intervalPace:
      guide.intervalPace == null
        ? null
        : Math.min(
            guide.intervalPace,
            (guide.tempoPace == null
              ? easyPace / MARGIN
              : Math.min(guide.tempoPace, easyPace / MARGIN)) / MARGIN,
          ),
  }
}

// Spread in seconds per km for each zone (±half this around target)
const ZONE_SPREAD_SECS: Record<SessionZone, number> = {
  // Wider than easy: the only wrong way to run a recovery run is too fast, so
  // the range leans on being loose rather than on being hit.
  recovery: 20,
  easy: 15,
  long: 15,
  tempo: 10,
  interval: 8,
  race: 6,
}

export type SessionZone = "recovery" | "easy" | "long" | "tempo" | "interval" | "race"

/**
 * Which pace zone a session name asks for, or null when pace is the wrong
 * measure for it.
 *
 * Hill repeats are the null case. Uphill pace is a function of the hill, not
 * of fitness, and printing a flat-ground target beside them asks the runner to
 * chase a number that the gradient decides. They are prescribed by effort, and
 * the effort line already says so.
 *
 * Order matters: the first match wins, so the specific names are tested before
 * the general ones.
 */
export function detectZone(sessionType: string): SessionZone | null {
  const t = sessionType.toLowerCase()
  if (/hill/.test(t)) return null
  if (/recovery|shake.?out|shakeout/.test(t)) return "recovery"
  if (/long/.test(t)) return "long"
  if (/race.?pace|goal.?pace|specific|marathon.?pace|half.?marathon.?pace/.test(t)) return "race"
  // Fartlek belongs here, not with the intervals. Its surges are Z3 — the same
  // sustained-but-controlled effort as a tempo — and pricing them at 5K
  // interval pace turned "relaxed surges" into a session two zones harder than
  // the effort line beside it described.
  if (/tempo|threshold|lactate|cruise|steady.?state|progression|fartlek/.test(t)) return "tempo"
  if (/interval|track|speed|repeat|strides|vo2/.test(t)) return "interval"
  return "easy"
}

function fmtPace(minPerKm: number): string {
  const mins = Math.floor(minPerKm)
  const secs = Math.round((minPerKm - mins) * 60)
  // Handle rounding edge case where secs = 60
  if (secs === 60) return `${mins + 1}:00`
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

/**
 * Returns a formatted pace range string for a session, e.g. "5:20–5:30 /km".
 * Returns null if the guide has no data for the detected zone.
 *
 * @param paceModifier  Optional multiplier applied to the centre pace (>1 = slower).
 *                      Use >1 for recovery weeks or fatigued states.
 */
export function assignSessionPace(
  sessionType: string,
  guide: PaceGuide,
  paceModifier = 1.0,
): string | null {
  const zone = detectZone(sessionType)
  if (zone === null) return null

  const paceMap: Record<SessionZone, number | null> = {
    recovery: guide.recoveryPace,
    easy: guide.easyPace,
    long: guide.longRunPace,
    tempo: guide.tempoPace,
    interval: guide.intervalPace,
    race: guide.racePace,
  }

  const pace = paceMap[zone]
  if (!pace || pace <= 0) return null

  const adjusted = pace * paceModifier
  const spread = ZONE_SPREAD_SECS[zone] / 60 / 2
  return `${fmtPace(adjusted - spread)}–${fmtPace(adjusted + spread)} /km`
}


/**
 * True when a stored plan has at least one session without a pace.
 *
 * Paces are assigned when a plan is generated and are part of it from then on,
 * the same as weekly volume and session distances. Reading a plan should not
 * recompute them — a runner who opened their plan on Monday should not find
 * different targets on Wednesday without having regenerated anything.
 *
 * What this exists for is the plans written before paces were assigned at all,
 * and the ones generated for a runner whose history could not support a pace
 * guide yet. When it returns false the caller can skip building one entirely.
 *
 * A session whose zone carries no pace does not count as missing one. Hill
 * repeats are prescribed by effort and always will be, so counting them here
 * would mark every plan containing one as permanently unfinished — and have
 * the read path re-pace and rewrite it on every single read.
 */
export function planNeedsPaces(plan: Pick<TrainingPlan, "weeks"> | null | undefined): boolean {
  if (!plan?.weeks) return false
  return plan.weeks.some((week) =>
    week.sessions.some((session) => !session.suggestedPace && detectZone(session.type) !== null),
  )
}

/**
 * True when a stored plan's paces were assigned by rules the app no longer
 * uses, and re-pacing it once would change what the runner is shown.
 *
 * This is the one exception to "a plan's paces are settled when it is
 * generated". That rule protects the runner from targets that drift under
 * them; it was never meant to protect a wrong target. A plan whose recovery
 * run is faster than its long run is wrong on its face, and telling the runner
 * to regenerate a whole block to get a fixed number is asking them to pay for
 * our mistake.
 */
export function planPacesStale(
  plan: Pick<TrainingPlan, "weeks" | "paceVersion"> | null | undefined,
): boolean {
  if (!plan?.weeks?.length) return false
  return (plan.paceVersion ?? 1) < PACE_ASSIGNMENT_VERSION
}

/**
 * The middle of a stored pace string, in min/km, or null if it does not read
 * as one. Accepts both the range this module writes ("5:20–5:30 /km") and a
 * single figure ("5:25 /km").
 */
export function parsePaceRange(pace: string | null | undefined): number | null {
  if (!pace) return null
  const toMinutes = (m: string, s: string) => Number(m) + Number(s) / 60

  const range = pace.match(/(\d{1,2}):([0-5]\d)\s*[–—-]\s*(\d{1,2}):([0-5]\d)/)
  if (range) {
    return (toMinutes(range[1], range[2]) + toMinutes(range[3], range[4])) / 2
  }

  const single = pace.match(/(\d{1,2}):([0-5]\d)/)
  return single ? toMinutes(single[1], single[2]) : null
}

/**
 * Pace figures written into free text by the model, e.g. "roughly 7:15–7:45/km".
 *
 * The app prints the runner's own target beside the session, computed from
 * their own history, and the model has no access to that number — so anything
 * it writes is a second, contradicting figure for the same session. The
 * generation prompt now forbids them; this catches the ones already stored,
 * and anything that slips through.
 */
const PACE_FIGURE_RE =
  /(?:\b(?:roughly|around|about|approx\.?|approximately|circa|ca\.?)\s+|~\s*)?\(?\s*\d{1,2}:[0-5]\d(?:\s*[–—-]\s*\d{1,2}:[0-5]\d)?\s*(?:min\s*)?\/\s*km\b\s*\)?/gi

/** Removes model-written pace figures from a session's prose, and tidies after itself. */
export function stripPaceFigures(text: string): string {
  return text
    .replace(PACE_FIGURE_RE, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;])\s*(?=[,;.])/g, "")
    .replace(/^[\s,;:–—-]+/, "")
    .trim()
}
