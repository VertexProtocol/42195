/**
 * Dismiss a training warning.
 *
 * POST /api/warnings/dismiss  { type: WarningType }
 *
 * Records "lastSurfacedAt = now" for the given warning type in the user's
 * profiles.warning_state column. The training-warnings evaluator reads this
 * timestamp and applies its cooldown, so the same advisory won't come back
 * for the cooldown window (default 14 days).
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import type { WarningState, WarningType } from "@/lib/training-warnings"

const VALID_TYPES: WarningType[] = [
  "elevated_acwr",
  "prolonged_fatigue",
  "hr_drift",
  "pace_drift",
]

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let type: WarningType
  try {
    const body = await req.json()
    if (!VALID_TYPES.includes(body.type)) {
      return NextResponse.json({ error: "Invalid warning type" }, { status: 400 })
    }
    type = body.type
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("warning_state")
    .eq("id", user.id)
    .maybeSingle()

  const state = ((profileRow?.warning_state as WarningState | null) ?? {}) as WarningState
  const nextState: WarningState = {
    ...state,
    [type]: { lastSurfacedAt: new Date().toISOString() },
  }

  const { error } = await supabase
    .from("profiles")
    .update({ warning_state: nextState })
    .eq("id", user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, dismissed: type })
}
