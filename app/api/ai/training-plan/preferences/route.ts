import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import type { NoteHistoryEntry } from "@/lib/notes-history"

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
      injury_notes: (data as any).injury_notes ?? null,
      notes_history: (data as any).notes_history ?? [],
      weekly_increase_pct: data.weekly_increase_pct ?? 10,
      block_weeks: data.block_weeks ?? 4,
      regenerate_every_weeks: data.regenerate_every_weeks ?? 4,
      plan_mode: data.plan_mode ?? "block",
      intensity_metric: (data as any).intensity_metric ?? "auto",
    },
  })
}

// PATCH — mark a specific notes_history entry as resolved
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: { goalId?: string; entry_added_at?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { goalId, entry_added_at } = body
  if (!goalId || !entry_added_at) {
    return NextResponse.json({ error: "goalId and entry_added_at are required" }, { status: 400 })
  }

  const { data: row } = await supabase
    .from("goal_preferences")
    .select("notes_history")
    .eq("goal_id", goalId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!row) return NextResponse.json({ error: "Preferences not found" }, { status: 404 })

  const history: NoteHistoryEntry[] = (row as any).notes_history ?? []
  const updated = history.map((e) =>
    e.added_at === entry_added_at && !e.resolved_at
      ? { ...e, resolved_at: new Date().toISOString() }
      : e,
  )

  const { error } = await supabase
    .from("goal_preferences")
    .update({ notes_history: updated })
    .eq("goal_id", goalId)
    .eq("user_id", user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ notes_history: updated })
}
