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

  // Load current plan + checkpoint state
  const { data: planRow, error: fetchError } = await supabase
    .from("ai_training_plans")
    .select("plan, block_start_date, mid_block_checkpoint")
    .eq("goal_id", goalId)
    .eq("user_id", user.id)
    .maybeSingle()

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
    .select("date, distance_km")
    .eq("user_id", user.id)
    .gte("date", sixWeeksAgo.toISOString())
    .order("date", { ascending: false })
    .limit(300)

  const acts = (activities ?? []).map((a: { date: string; distance_km: number }) => ({
    date: a.date,
    distance_km: Number(a.distance_km),
  }))

  // Run adherence analysis
  const { currentWeekIndex, completedWeeks, overallAdherencePct, isWayOff, direction } =
    analyzeBlockAdherence(plan, acts, blockStartDate)

  let adjustmentApplied = false
  let adjustmentNote: string | null = null
  let updatedPlan = plan

  if (isWayOff && completedWeeks.length > 0) {
    const actualAvgKm =
      completedWeeks.reduce((s, w) => s + w.actualKm, 0) / completedWeeks.length

    const { adjustedWeeks, scaleFactor } = adjustRemainingWeeks(plan, currentWeekIndex, actualAvgKm)

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
        completedWeeks.length,
      )
    }
  }

  const checkpoint: MidBlockCheckpoint = {
    checkedAt: new Date().toISOString(),
    blockStartDate,
    blockWeeks: plan.weeks.length,
    checkpointWeek: currentWeekIndex + 1, // 1-based
    completedWeeks,
    overallAdherencePct,
    isWayOff,
    direction,
    adjustmentApplied,
    adjustmentNote,
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
