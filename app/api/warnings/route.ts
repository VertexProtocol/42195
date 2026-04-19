/**
 * Proactive training warnings endpoint.
 *
 * GET  /api/warnings          → returns warnings currently worth surfacing
 * POST /api/warnings/dismiss  → (see dismiss/route.ts) marks a warning dismissed
 *
 * GET is side-effect-free: it computes the context from recent activities and
 * calls evaluateWarnings against the user's persisted cooldown state, but it
 * does NOT update that state. Only explicit user dismissal bumps the cooldown,
 * so a warning that's genuinely actionable keeps showing until the user
 * acknowledges it.
 */

import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  deriveWarningContext,
  evaluateWarnings,
  type WarningActivity,
  type WarningState,
} from "@/lib/training-warnings"

const RUN_TYPES = new Set(["Run", "Trail Run", "Virtual Run", "Treadmill", "Race"])

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // 10 weeks of activity history is plenty for ACWR (7/28-day windows) and
  // trailing-fatigue week counting (caps at 12 weeks in the helper anyway).
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 70)

  const [{ data: profileRow }, { data: activitiesRaw }] = await Promise.all([
    supabase
      .from("profiles")
      .select("warning_state")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("activities")
      .select("type, date, distance_km, duration_seconds, pace_min_per_km, avg_heart_rate, elevation_gain_m")
      .eq("user_id", user.id)
      .gte("date", cutoff.toISOString())
      .order("date", { ascending: false })
      .limit(300),
  ])

  const state = ((profileRow?.warning_state as WarningState | null) ?? {}) as WarningState

  const activities: WarningActivity[] = (activitiesRaw ?? [])
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

  const context = deriveWarningContext(activities)
  const { newWarnings } = evaluateWarnings(context, state)

  return NextResponse.json({
    warnings: newWarnings,
    context: {
      acwr: Number(context.acwr.toFixed(2)),
      acwrOneWeekAgo: Number(context.acwrOneWeekAgo.toFixed(2)),
      fatigueSignal: context.fatigueSignal,
      tsbBelowThresholdWeeks: context.tsbBelowThresholdWeeks,
    },
  })
}
