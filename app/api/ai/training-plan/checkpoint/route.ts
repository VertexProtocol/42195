/**
 * Mid-block checkpoint endpoint.
 *
 * POST /api/ai/training-plan/checkpoint
 *
 * Evaluates whether the runner is on track with their current training block
 * at the halfway point. For 4+ week blocks, this fires after the first half
 * of the block is complete. If the runner is significantly off track (> ±30%
 * deviation from planned volume), the remaining weeks are adjusted — completed
 * weeks are never modified.
 *
 * The result is stored in `ai_training_plans.mid_block_checkpoint` and the
 * adjusted plan (if any) replaces the current plan in the DB.
 *
 * Idempotent: running it twice for the same block returns the cached result
 * without re-analysing.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import type { TrainingPlan, MidBlockCheckpoint } from "@/lib/types"
import {
  isCheckpointDue,
  analyzeBlockAdherence,
  adjustRemainingWeeks,
  buildAdjustmentNote,
} from "@/lib/training-checkpoint"
import { detectFatigue, type SafetyActivity } from "@/lib/training-safety"

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let goalId: string
  let dryRun = false
  try {
    const body = await req.json()
    goalId = body.goalId
    dryRun = body.dryRun === true
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  if (!goalId) {
    return NextResponse.json({ error: "goalId is required" }, { status: 400 })
  }

  // Load current plan + checkpoint state, and user preferences in parallel
  const [{ data: planRow, error: fetchError }, { data: prefsRow }] = await Promise.all([
    supabase
      .from("ai_training_plans")
      .select("plan, block_start_date, mid_block_checkpoint")
      .eq("goal_id", goalId)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("goal_preferences")
      .select("focus")
      .eq("goal_id", goalId)
      .eq("user_id", user.id)
      .maybeSingle(),
  ])

  if (fetchError) {
    return NextResponse.json({ error: "Failed to load training plan" }, { status: 500 })
  }

  if (!planRow?.plan || !planRow.block_start_date) {
    return NextResponse.json({ error: "No training plan found for this goal" }, { status: 404 })
  }

  const plan = planRow.plan as TrainingPlan
  const blockStartDate: string = planRow.block_start_date
  const existingCheckpoint = planRow.mid_block_checkpoint as MidBlockCheckpoint | null

  // Check if checkpoint is due — if not, return current state
  if (!isCheckpointDue(plan, blockStartDate, existingCheckpoint)) {
    return NextResponse.json({
      checkpointDue: false,
      checkpoint: existingCheckpoint ?? null,
      message: existingCheckpoint
        ? "Checkpoint already applied for this block."
        : "Not at checkpoint window yet — block has fewer than 4 weeks or midpoint not reached.",
    })
  }

  // Load recent activities for adherence analysis
  const sixWeeksAgo = new Date()
  sixWeeksAgo.setDate(sixWeeksAgo.getDate() - 42)

  const { data: activities } = await supabase
    .from("activities")
    .select("type, date, distance_km, duration_seconds, pace_min_per_km, avg_heart_rate, elevation_gain_m")
    .eq("user_id", user.id)
    .gte("date", sixWeeksAgo.toISOString())
    .order("date", { ascending: false })
    .limit(300)

  const RUN_TYPES = new Set(["Run", "Trail Run", "Virtual Run", "Treadmill", "Race"])
  const allActs = activities ?? []
  const acts = allActs.map((a: { date: string; distance_km: number }) => ({
    date: a.date,
    distance_km: Number(a.distance_km),
  }))

  // Fatigue detection uses running activities with HR + pace metadata
  const safetyActs: SafetyActivity[] = allActs
    .filter((a: { type: string }) => RUN_TYPES.has(a.type))
    .map((a: {
      date: string
      distance_km: number
      duration_seconds: number
      pace_min_per_km: number | null
      avg_heart_rate: number | null
      elevation_gain_m: number | null
    }) => ({
      date: a.date,
      distance_km: Number(a.distance_km),
      duration_seconds: Number(a.duration_seconds),
      pace_min_per_km: a.pace_min_per_km != null ? Number(a.pace_min_per_km) : null,
      avg_heart_rate: a.avg_heart_rate != null ? Number(a.avg_heart_rate) : null,
      elevation_gain_m: a.elevation_gain_m != null ? Number(a.elevation_gain_m) : null,
    }))
  const fatigue = detectFatigue(safetyActs)

  // Run adherence analysis
  const { currentWeekIndex, completedWeeks, activeWeeks, missedWeekCount, overallAdherencePct, isWayOff, direction } =
    analyzeBlockAdherence(plan, acts, blockStartDate)

  let adjustmentApplied = false
  let adjustmentNote: string | null = null
  let updatedPlan = plan
  let fatigueAdjustmentApplied = false

  // Fatigue can trigger an adjustment even when km-adherence looks on track:
  // a runner who hit their volume but shows HR/pace drift is overreaching and
  // should deload regardless of what the km ledger says.
  const shouldAttemptAdjust = (isWayOff || fatigue.signal !== "none") && activeWeeks.length > 0

  if (shouldAttemptAdjust) {
    // Base the scale factor on active weeks only — sick/missed weeks are excluded.
    // If isWayOff is false (fatigue-only trigger), the adherence-derived scale
    // will be close to 1.0 and the fatigue cap will take over inside adjustRemainingWeeks.
    const actualAvgKm = activeWeeks.reduce((s, w) => s + w.actualKm, 0) / activeWeeks.length

    const result = adjustRemainingWeeks(plan, currentWeekIndex, actualAvgKm, {
      skipSessionScaling: prefsRow?.focus === "workouts",
      fatigueSignal: fatigue.signal,
    })
    const { adjustedWeeks, scaleFactor } = result
    fatigueAdjustmentApplied = result.fatigueAdjustmentApplied

    // Only save the adjustment if the remaining weeks actually changed
    const remainingChanged = adjustedWeeks
      .slice(currentWeekIndex)
      .some((w, i) => w.targetKm !== plan.weeks[currentWeekIndex + i]?.targetKm)

    if (remainingChanged) {
      updatedPlan = { ...plan, weeks: adjustedWeeks }
      adjustmentApplied = true
      adjustmentNote = buildAdjustmentNote(
        overallAdherencePct,
        direction,
        scaleFactor,
        activeWeeks.length,
        missedWeekCount,
        fatigue.signal,
      )
    }
  }

  const checkpoint: MidBlockCheckpoint = {
    checkedAt: new Date().toISOString(),
    blockStartDate,
    blockWeeks: plan.weeks.length,
    checkpointWeek: currentWeekIndex + 1, // 1-based
    completedWeeks,
    missedWeekCount,
    overallAdherencePct,
    isWayOff,
    direction,
    adjustmentApplied,
    adjustmentNote,
    fatigueSignal: fatigue.signal,
    fatigueAdjustmentApplied,
  }

  // Dry-run: return analysis without persisting
  if (dryRun) {
    return NextResponse.json({
      checkpointDue: true,
      checkpoint,
      adjustmentApplied,
      dryRun: true,
    })
  }

  // Persist updated plan + checkpoint using service client for reliability
  const service = createServiceClient()
  const { error: upsertError } = await service
    .from("ai_training_plans")
    .update({
      plan: updatedPlan,
      mid_block_checkpoint: checkpoint,
    })
    .eq("goal_id", goalId)
    .eq("user_id", user.id)

  if (upsertError) {
    console.error("[checkpoint] Failed to save checkpoint:", upsertError)
    return NextResponse.json({ error: "Failed to save checkpoint result" }, { status: 500 })
  }

  if (adjustmentApplied) {
    console.info(
      `[checkpoint] Plan adjusted for goal ${goalId}: ` +
        `${overallAdherencePct}% adherence (${direction}), ` +
        `weeks ${currentWeekIndex + 1}-${plan.weeks.length} updated`,
    )
  }

  return NextResponse.json({
    checkpointDue: true,
    checkpoint,
    adjustmentApplied,
    updatedPlan: adjustmentApplied ? updatedPlan : null,
  })
}

// GET — return current checkpoint state without triggering analysis
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const goalId = req.nextUrl.searchParams.get("goalId")
  if (!goalId) return NextResponse.json({ error: "goalId is required" }, { status: 400 })

  const { data: planRow } = await supabase
    .from("ai_training_plans")
    .select("plan, block_start_date, mid_block_checkpoint")
    .eq("goal_id", goalId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!planRow) return NextResponse.json({ checkpoint: null, checkpointDue: false })

  const plan = planRow.plan as TrainingPlan | null
  const existingCheckpoint = planRow.mid_block_checkpoint as MidBlockCheckpoint | null
  const checkpointDue =
    plan && planRow.block_start_date
      ? isCheckpointDue(plan, planRow.block_start_date, existingCheckpoint)
      : false

  return NextResponse.json({
    checkpoint: existingCheckpoint,
    checkpointDue,
  })
}
