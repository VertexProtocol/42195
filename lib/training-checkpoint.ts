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
import { parseSessionDistanceParts } from "@/lib/training-safety"
import type { FatigueSignal } from "@/lib/training-safety"
import {
  CHECKPOINT_UNDER_THRESHOLD as UNDER_THRESHOLD,
  CHECKPOINT_OVER_THRESHOLD as OVER_THRESHOLD,
  CHECKPOINT_MIN_BLOCK_WEEKS as MIN_BLOCK_WEEKS_FOR_CHECKPOINT,
  CHECKPOINT_DELOAD_WEEK_THRESHOLD as DELOAD_WEEK_THRESHOLD,
  CHECKPOINT_MISSED_WEEK_THRESHOLD as MISSED_WEEK_THRESHOLD,
  CHECKPOINT_MIN_SCALE,
  CHECKPOINT_MAX_SCALE,
} from "@/lib/training-constants"

/**
 * Caps applied to the checkpoint scale factor when a fatigue signal is
 * detected. The cap is never raised by fatigue — it can only tighten an
 * otherwise healthy scaling. The values mirror detectFatigue's intensity
 * multipliers so the interpretation is consistent across the codebase.
 */
const FATIGUE_SCALE_CAPS: Record<FatigueSignal, number | null> = {
  none: null,
  hr_elevated: 0.85,
  pace_declining: 0.90,
  both: 0.75,
}

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
  activeWeeks: WeekAdherence[]
  missedWeekCount: number
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
      activeWeeks: [],
      missedWeekCount: 0,
      overallAdherencePct: 100,
      isWayOff: false,
      direction: "on_track",
    }
  }

  // Split into active weeks and missed weeks (sick/travel/life).
  // Missed weeks are excluded from the adherence calculation so a single
  // illness doesn't cause the whole remaining block to be scaled down.
  const activeWeeks = completedWeeks.filter(
    (w) => w.plannedKm === 0 || w.actualKm / w.plannedKm >= MISSED_WEEK_THRESHOLD,
  )
  const missedWeekCount = completedWeeks.length - activeWeeks.length

  const totalPlanned = activeWeeks.reduce((s, w) => s + w.plannedKm, 0)
  const totalActual = activeWeeks.reduce((s, w) => s + w.actualKm, 0)
  const overallAdherencePct = totalPlanned > 0 ? Math.round((totalActual / totalPlanned) * 100) : 100
  const adherenceFraction = overallAdherencePct / 100

  const direction: "under" | "over" | "on_track" =
    adherenceFraction < UNDER_THRESHOLD ? "under"
    : adherenceFraction > OVER_THRESHOLD ? "over"
    : "on_track"

  // If all completed weeks were missed (e.g. two sick weeks), there's no
  // training signal to act on — treat as on_track.
  const effectiveDirection = activeWeeks.length === 0 ? "on_track" : direction

  return {
    currentWeekIndex,
    completedWeeks,
    activeWeeks,
    missedWeekCount,
    overallAdherencePct: activeWeeks.length === 0 ? 100 : overallAdherencePct,
    isWayOff: effectiveDirection !== "on_track",
    direction: effectiveDirection,
  }
}

/**
 * Applies a fatigue-driven ceiling to a base scale factor. The fatigue cap
 * only tightens — it never raises a scaling computed from adherence.
 *
 * - "none"           → no change
 * - "hr_elevated"    → scale capped at 0.85 (15% further reduction)
 * - "pace_declining" → scale capped at 0.90 (10% further reduction)
 * - "both"           → scale capped at 0.75 (25% further reduction — forced deload)
 */
export function applyFatigueToScale(
  baseScale: number,
  fatigueSignal: FatigueSignal,
): { scale: number; fatigueAdjustmentApplied: boolean } {
  const cap = FATIGUE_SCALE_CAPS[fatigueSignal]
  if (cap === null || cap >= baseScale) {
    return { scale: baseScale, fatigueAdjustmentApplied: false }
  }
  return { scale: cap, fatigueAdjustmentApplied: true }
}

/**
 * Scales a session distance string by `scale`.
 * Handles ranges like "8-10 km" and single values like "10 km".
 */
export function scaleSessionDistance(distanceStr: string, scale: number): string {
  const parts = parseSessionDistanceParts(distanceStr)
  if (!parts) return distanceStr // unparseable — leave unchanged
  if (parts.low !== parts.high) {
    const low = Math.round(parts.low * scale * 10) / 10
    const high = Math.round(parts.high * scale * 10) / 10
    return `${low}–${high} km`
  }
  const km = Math.round(parts.high * scale * 10) / 10
  return `${km} km`
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
  {
    skipSessionScaling = false,
    fatigueSignal = "none",
  }: { skipSessionScaling?: boolean; fatigueSignal?: FatigueSignal } = {},
): { adjustedWeeks: TrainingWeek[]; scaleFactor: number; fatigueAdjustmentApplied: boolean } {
  const completedWeeks = plan.weeks.slice(0, currentWeekIndex)
  const remainingWeeks = plan.weeks.slice(currentWeekIndex)

  if (remainingWeeks.length === 0) {
    return { adjustedWeeks: plan.weeks, scaleFactor: 1.0, fatigueAdjustmentApplied: false }
  }

  // Detect deload weeks using the average of *completed* weeks as the reference.
  // This avoids the deload week itself pulling down the average and masking other weeks.
  const completedPlannedAvg =
    currentWeekIndex > 0
      ? plan.weeks.slice(0, currentWeekIndex).reduce((s, w) => s + w.targetKm, 0) / currentWeekIndex
      : 0

  const isDeload = (week: TrainingWeek) =>
    completedPlannedAvg > 0 && week.targetKm < completedPlannedAvg * DELOAD_WEEK_THRESHOLD

  // Use the first non-deload remaining week as the scaling anchor
  const anchorWeek = remainingWeeks.find((w) => !isDeload(w))
  if (!anchorWeek) {
    // All remaining weeks are deload — nothing to adjust
    return { adjustedWeeks: plan.weeks, scaleFactor: 1.0, fatigueAdjustmentApplied: false }
  }

  const adherenceScale =
    anchorWeek.targetKm > 0
      ? Math.min(CHECKPOINT_MAX_SCALE, Math.max(CHECKPOINT_MIN_SCALE, actualAvgKm / anchorWeek.targetKm))
      : 1.0

  // Fatigue can only tighten the scale, never raise it. A runner who hit their
  // volume but shows HR/pace drift is overreaching even if km-adherence says
  // "on track" — the fatigue cap overrides the adherence-derived scaling.
  const { scale: scaleFactor, fatigueAdjustmentApplied } = applyFatigueToScale(adherenceScale, fatigueSignal)

  const adjustedRemaining = remainingWeeks.map((week) => {
    // Leave deload/recovery weeks untouched
    if (isDeload(week)) return week

    const newTargetKm = Math.max(5, Math.round(week.targetKm * scaleFactor))
    const sessionScale = week.targetKm > 0 ? newTargetKm / week.targetKm : 1.0

    // For workouts-focused plans, preserve session distances — structure matters
    // more than volume. Only the weekly km target label is updated.
    const adjustedSessions = skipSessionScaling
      ? week.sessions
      : week.sessions.map((session) => ({
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
    fatigueAdjustmentApplied,
  }
}

/**
 * Builds a human-readable note explaining why the plan was (or was not) adjusted.
 */
export function buildAdjustmentNote(
  adherencePct: number,
  direction: "under" | "over" | "on_track",
  scaleFactor: number,
  activeCount: number,
  missedWeekCount = 0,
  fatigueSignal: FatigueSignal = "none",
): string {
  const pct = Math.round((scaleFactor - 1) * 100)
  const sign = pct >= 0 ? "+" : ""
  const missedNote = missedWeekCount > 0
    ? ` (${missedWeekCount} missed week${missedWeekCount !== 1 ? "s" : ""} excluded)`
    : ""
  const fatigueSuffix = (() => {
    if (fatigueSignal === "none") return ""
    if (fatigueSignal === "both") return " Fatigue signal detected (HR elevated and pace declining) — extra reduction applied."
    if (fatigueSignal === "hr_elevated") return " Heart rate trend is elevated — extra reduction applied."
    return " Pace is drifting despite steady HR — extra reduction applied."
  })()
  if (direction === "under") {
    return `After ${activeCount} active week${activeCount !== 1 ? "s" : ""}${missedNote} at ${adherencePct}% of planned volume, the remaining weeks have been scaled down by ${Math.abs(pct)}% to better match your current training load.${fatigueSuffix}`
  }
  if (direction === "over") {
    if (scaleFactor < 1) {
      return `Volume exceeded plan at ${adherencePct}% (${activeCount} active week${activeCount !== 1 ? "s" : ""})${missedNote}, but a fatigue signal forced a deload: remaining weeks scaled by ${Math.abs(pct)}% down.${fatigueSuffix}`
    }
    return `After ${activeCount} active week${activeCount !== 1 ? "s" : ""}${missedNote} at ${adherencePct}% of planned volume, the remaining weeks have been scaled up by ${sign}${pct}% to reflect your stronger-than-expected performance.${fatigueSuffix}`
  }
  if (fatigueSignal !== "none" && scaleFactor < 1) {
    return `Training km is on track at ${adherencePct}% adherence, but a fatigue signal prompted a deload: remaining weeks scaled down by ${Math.abs(pct)}%.${fatigueSuffix}`
  }
  return `Training is on track at ${adherencePct}% adherence — no adjustment needed.`
}
