import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const goalId = req.nextUrl.searchParams.get("goalId")
  if (!goalId) return NextResponse.json({ error: "goalId is required" }, { status: 400 })

  const { data } = await supabase
    .from("goal_preferences")
    .select("*")
    .eq("goal_id", goalId)
    .maybeSingle()

  if (!data) return NextResponse.json({ preferences: null })

  return NextResponse.json({
    preferences: {
      goal_id: data.goal_id,
      sessions_per_week: data.sessions_per_week,
      focus: data.focus,
      notes: data.notes ?? null,
      weekly_increase_pct: data.weekly_increase_pct ?? 10,
      block_weeks: data.block_weeks ?? 4,
      regenerate_every_weeks: data.regenerate_every_weeks ?? 4,
      plan_mode: data.plan_mode ?? "block",
    },
  })
}
