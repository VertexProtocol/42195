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
  easyPace: number | null      // min/km — conversational aerobic effort
  longRunPace: number | null   // min/km — slightly slower than easy
  tempoPace: number | null     // min/km — lactate threshold effort
  intervalPace: number | null  // min/km — ~5K race effort
  racePace: number | null      // min/km — goal race pace
  source: "test_run" | "prediction" | "historical" | "none"
}

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
  const longRunPace = easyPace ? easyPace * 1.05 : null

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

  return { easyPace, longRunPace, tempoPace, intervalPace, racePace, source }
}

// Spread in seconds per km for each zone (±half this around target)
const ZONE_SPREAD_SECS: Record<SessionZone, number> = {
  easy: 15,
  long: 15,
  tempo: 10,
  interval: 8,
  race: 6,
}

type SessionZone = "easy" | "long" | "tempo" | "interval" | "race"

function detectZone(sessionType: string): SessionZone {
  const t = sessionType.toLowerCase()
  if (/long/.test(t)) return "long"
  if (/tempo|threshold|lactate|cruise|steady.?state|progression/.test(t)) return "tempo"
  if (/interval|track|speed|fartlek|repeat|strides|vo2|hill/.test(t)) return "interval"
  if (/race.?pace|goal.?pace|specific|marathon.?pace|half.?marathon.?pace/.test(t)) return "race"
  // "recovery run" gets easy zone but slightly slower — handled by caller via modifier
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

  const paceMap: Record<SessionZone, number | null> = {
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
 * What this exists for is the plans written before paces were assigned at all.
 * When it returns false the caller can skip building a pace guide entirely.
 */
export function planNeedsPaces(plan: Pick<TrainingPlan, "weeks"> | null | undefined): boolean {
  if (!plan?.weeks) return false
  return plan.weeks.some((week) => week.sessions.some((session) => !session.suggestedPace))
}
