/**
 * Mid-block checkpoint analysis for training plans.
 *
 * For training blocks of 4+ weeks, this module checks adherence at the halfway
 * point (after the first half of weeks is complete). If the runner is significantly
 * off track, it adjusts only the remaining weeks of the current block — completed
 * weeks are never modified.
 *
 * "Way off" thresholds:
 *  - Under-performing: overall adherence < 70% of planned km
 *  - Over-performing:  overall adherence > 135% of planned km
 */

import type { TrainingPlan, TrainingWeek, WeekAdherence, MidBlockCheckpoint } from "@/lib/types"

/** Adherence below this triggers a downward adjustment */
const UNDER_THRESHOLD = 0.70

/** Adherence above this triggers an upward adjustment (capped by safety limits) */
const OVER_THRESHOLD = 1.35

/** Minimum block length for checkpoint to apply */
const MIN_BLOCK_WEEKS_FOR_CHECKPOINT = 4

/**
 * A week whose targetKm is below this fraction of the block average is treated
 * as a deload/recovery week and left untouched by the checkpoint adjustment.
 */
const DELOAD_WEEK_THRESHOLD = 0.75

/**
 * Returns the 0-based index of the current week within the training block.
 * Week 0 = first week of the block. Returns -1 if block hasn't started yet.
 */
export function getCurrentBlockWeekIndex(blockStartDate: string): number {
  // Parse as UTC date (format: "YYYY-MM-DD")
  const [y, m, d] = blockStartDate.split("-").map(Number)
  const start = new Date(Date.UTC(y, m - 1, d))

  // Align block start to Monday
  const startDay = start.getUTCDay()
  const startDiff = startDay === 0 ? -6 : 1 - startDay
  start.setUTCDate(start.getUTCDate() + startDiff)

  const nowUtc = Date.now()
  const msElapsed = nowUtc - start.getTime()
  if (msElapsed < 0) return -1 // block hasn't started
  return Math.floor(msElapsed / (7 * 24 * 60 * 60 * 1000))
}

/**
 * Computes the total distance (km) run during a specific block week (0-based index).
 */
export function getWeekActualKm(
  activities: Array<{ date: string; distance_km: number }>,
  blockStartDate: string,
  weekIndex: number,
): number {
  const [y, m, d] = blockStartDate.split("-").map(Number)
  const blockStart = new Date(Date.UTC(y, m - 1, d))

  // Align to Monday
  const startDay = blockStart.getUTCDay()
  const startDiff = startDay === 0 ? -6 : 1 - startDay
  blockStart.setUTCDate(blockStart.getUTCDate() + startDiff)

  const weekStartMs = blockStart.getTime() + weekIndex * 7 * 24 * 60 * 60 * 1000
  const weekEndMs = weekStartMs + 7 * 24 * 60 * 60 * 1000

  return activities
    .filter((a) => {
      const t = new Date(a.date).getTime()
      return t >= weekStartMs && t < weekEndMs
    })
    .reduce((sum, a) => sum + Number(a.distance_km), 0)
}

/**
 * Determines whether a mid-block checkpoint should be run now.
 *
 * Conditions:
 * 1. Block has >= MIN_BLOCK_WEEKS_FOR_CHECKPOINT weeks
 * 2. We are at or past the midpoint of the block (currentWeekIndex >= half)
 * 3. We're still inside the block (not past the last week)
 * 4. No checkpoint has been applied yet for this block (or it was applied on a
 *    different block_start_date, meaning a new block has started)
 */
export function isCheckpointDue(
  plan: TrainingPlan,
  blockStartDate: string,
  existingCheckpoint: MidBlockCheckpoint | null | undefined,
): boolean {
  const totalWeeks = plan.weeks.length
  if (totalWeeks < MIN_BLOCK_WEEKS_FOR_CHECKPOINT) return false

  const currentWeekIndex = getCurrentBlockWeekIndex(blockStartDate)
  if (currentWeekIndex < 0) return false // block hasn't started

  const midpoint = Math.floor(totalWeeks / 2) // 0-based index of the midpoint week
  if (currentWeekIndex < midpoint) return false // not at midpoint yet
  if (currentWeekIndex >= totalWeeks) return false // past the end of the block

  // If a checkpoint was already applied for *this* block, don't re-run
  if (existingCheckpoint?.adjustmentApplied && existingCheckpoint.blockStartDate === blockStartDate) {
    return false
  }

  // If a checkpoint was already *checked* (not necessarily applied) for this block,
  // don't re-check unless a new week has started since the last check
  if (existingCheckpoint?.blockStartDate === blockStartDate) {
    return false
  }

  return true
}

/**
 * Analyses how closely the runner is adhering to the plan for the completed weeks.
 * Only weeks before `currentWeekIndex` are considered "completed".
 */
export function analyzeBlockAdherence(
  plan: TrainingPlan,
  activities: Array<{ date: string; distance_km: number }>,
  blockStartDate: string,
): {
  currentWeekIndex: number
  completedWeeks: WeekAdherence[]
  overallAdherencePct: number
  isWayOff: boolean
  direction: "under" | "over" | "on_track"
} {
  const currentWeekIndex = getCurrentBlockWeekIndex(blockStartDate)
  const completedWeeks: WeekAdherence[] = []

  // Analyse only fully completed weeks (those strictly before current week)
  const numCompleted = Math.min(currentWeekIndex, plan.weeks.length)
  for (let i = 0; i < numCompleted; i++) {
    const week = plan.weeks[i]
    const actualKm = getWeekActualKm(activities, blockStartDate, i)
    const adherencePct = week.targetKm > 0 ? Math.round((actualKm / week.targetKm) * 100) : 100
    completedWeeks.push({
      weekNumber: week.weekNumber,
      plannedKm: week.targetKm,
      actualKm: Math.round(actualKm * 10) / 10,
      adherencePct,
    })
  }

  if (completedWeeks.length === 0) {
    return {
      currentWeekIndex,
      completedWeeks: [],
      overallAdherencePct: 100,
      isWayOff: false,
      direction: "on_track",
    }
  }

  const totalPlanned = completedWeeks.reduce((s, w) => s + w.plannedKm, 0)
  const totalActual = completedWeeks.reduce((s, w) => s + w.actualKm, 0)
  const overallAdherencePct = totalPlanned > 0 ? Math.round((totalActual / totalPlanned) * 100) : 100
  const adherenceFraction = overallAdherencePct / 100

  const direction: "under" | "over" | "on_track" =
    adherenceFraction < UNDER_THRESHOLD ? "under"
    : adherenceFraction > OVER_THRESHOLD ? "over"
    : "on_track"

  return {
    currentWeekIndex,
    completedWeeks,
    overallAdherencePct,
    isWayOff: direction !== "on_track",
    direction,
  }
}

/**
 * Scales a session distance string by `scale`.
 * Handles ranges like "8-10 km" and single values like "10 km".
 */
function scaleSessionDistance(distanceStr: string, scale: number): string {
  // Range: "8-10 km" or "8–10 km"
  const rangeMatch = distanceStr.match(/^([\d.]+)\s*[-–]\s*([\d.]+)\s*km$/i)
  if (rangeMatch) {
    const low = Math.round(parseFloat(rangeMatch[1]) * scale * 10) / 10
    const high = Math.round(parseFloat(rangeMatch[2]) * scale * 10) / 10
    return `${low}–${high} km`
  }
  // Single value: "10 km" or "10.5km"
  const singleMatch = distanceStr.match(/^([\d.]+)\s*km$/i)
  if (singleMatch) {
    const km = Math.round(parseFloat(singleMatch[1]) * scale * 10) / 10
    return `${km} km`
  }
  return distanceStr // unparseable — leave unchanged
}

/**
 * Adjusts only the remaining (not yet started) weeks in the plan based on
 * the runner's actual performance so far.
 *
 * The scale factor is derived from the ratio of actual average km to the
 * planned average for the remaining weeks, clamped to prevent extreme changes:
 *  - Under-performer: scale down by at most 45% (min scale 0.55)
 *  - Over-performer:  scale up by at most 30% (max scale 1.30)
 *
 * Session distances within each week are scaled proportionally.
 * Completed weeks are returned untouched.
 */
export function adjustRemainingWeeks(
  plan: TrainingPlan,
  currentWeekIndex: number,
  actualAvgKm: number,
): { adjustedWeeks: TrainingWeek[]; scaleFactor: number } {
  const completedWeeks = plan.weeks.slice(0, currentWeekIndex)
  const remainingWeeks = plan.weeks.slice(currentWeekIndex)

  if (remainingWeeks.length === 0) {
    return { adjustedWeeks: plan.weeks, scaleFactor: 1.0 }
  }

  // Detect deload weeks: any week whose targetKm is below DELOAD_WEEK_THRESHOLD
  // of the block average is a recovery week and should not be scaled.
  const blockAvgKm =
    plan.weeks.reduce((s, w) => s + w.targetKm, 0) / plan.weeks.length

  const isDeload = (week: TrainingWeek) =>
    blockAvgKm > 0 && week.targetKm < blockAvgKm * DELOAD_WEEK_THRESHOLD

  // Use the first non-deload remaining week as the scaling anchor
  const anchorWeek = remainingWeeks.find((w) => !isDeload(w))
  if (!anchorWeek) {
    // All remaining weeks are deload — nothing to adjust
    return { adjustedWeeks: plan.weeks, scaleFactor: 1.0 }
  }

  const scaleFactor =
    anchorWeek.targetKm > 0
      ? Math.min(1.30, Math.max(0.55, actualAvgKm / anchorWeek.targetKm))
      : 1.0

  const adjustedRemaining = remainingWeeks.map((week) => {
    // Leave deload/recovery weeks untouched
    if (isDeload(week)) return week

    const newTargetKm = Math.max(5, Math.round(week.targetKm * scaleFactor))
    const sessionScale = week.targetKm > 0 ? newTargetKm / week.targetKm : 1.0

    const adjustedSessions = week.sessions.map((session) => ({
      ...session,
      distance: scaleSessionDistance(session.distance, sessionScale),
    }))

    const adjustNote = `Mid-block adjustment: target updated from ${week.targetKm} km to ${newTargetKm} km based on recent training load.`
    const existingNote = week.coachNote ? ` ${week.coachNote}` : ""

    return {
      ...week,
      targetKm: newTargetKm,
      sessions: adjustedSessions,
      coachNote: `${adjustNote}${existingNote}`.trim(),
    }
  })

  return {
    adjustedWeeks: [...completedWeeks, ...adjustedRemaining],
    scaleFactor,
  }
}

/**
 * Builds a human-readable note explaining why the plan was (or was not) adjusted.
 */
export function buildAdjustmentNote(
  adherencePct: number,
  direction: "under" | "over" | "on_track",
  scaleFactor: number,
  completedCount: number,
): string {
  const pct = Math.round((scaleFactor - 1) * 100)
  const sign = pct >= 0 ? "+" : ""
  if (direction === "under") {
    return `After ${completedCount} completed week${completedCount !== 1 ? "s" : ""} at ${adherencePct}% of planned volume, the remaining weeks have been scaled down by ${Math.abs(pct)}% to better match your current training load.`
  }
  if (direction === "over") {
    return `After ${completedCount} completed week${completedCount !== 1 ? "s" : ""} at ${adherencePct}% of planned volume, the remaining weeks have been scaled up by ${sign}${pct}% to reflect your stronger-than-expected performance.`
  }
  return `Training is on track at ${adherencePct}% adherence — no adjustment needed.`
}
