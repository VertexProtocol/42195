import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

type SessionStatus = "planned" | "completed" | "skipped"

// GET — load all session statuses for a goal
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const goalId = req.nextUrl.searchParams.get("goalId")
  if (!goalId) return NextResponse.json({ error: "goalId is required" }, { status: 400 })

  const { data: rows } = await supabase
    .from("session_completions")
    .select("session_key, status")
    .eq("goal_id", goalId)
    .eq("user_id", user.id)

  // Return as a Record<string, SessionStatus>
  const statuses: Record<string, SessionStatus> = {}
  for (const row of rows ?? []) {
    statuses[row.session_key] = row.status as SessionStatus
  }

  return NextResponse.json({ statuses })
}

// PUT — upsert a single session status
export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const { goalId, sessionKey, status } = body as {
    goalId: string
    sessionKey: string
    status: SessionStatus
  }

  if (!goalId || !sessionKey || !status) {
    return NextResponse.json({ error: "goalId, sessionKey, and status are required" }, { status: 400 })
  }

  if (!["planned", "completed", "skipped"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 })
  }

  const { error } = await supabase.from("session_completions").upsert(
    {
      goal_id: goalId,
      user_id: user.id,
      session_key: sessionKey,
      status,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "goal_id,session_key" },
  )

  if (error) {
    return NextResponse.json({ error: "Failed to save session status" }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

// POST — bulk upsert session statuses (for migration from localStorage)
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const { goalId, statuses } = body as {
    goalId: string
    statuses: Record<string, SessionStatus>
  }

  if (!goalId || !statuses) {
    return NextResponse.json({ error: "goalId and statuses are required" }, { status: 400 })
  }

  const rows = Object.entries(statuses).map(([sessionKey, status]) => ({
    goal_id: goalId,
    user_id: user.id,
    session_key: sessionKey,
    status,
    updated_at: new Date().toISOString(),
  }))

  if (rows.length === 0) return NextResponse.json({ ok: true })

  const { error } = await supabase
    .from("session_completions")
    .upsert(rows, { onConflict: "goal_id,session_key" })

  if (error) {
    return NextResponse.json({ error: "Failed to save session statuses" }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
