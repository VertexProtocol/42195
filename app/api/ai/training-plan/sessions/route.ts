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

  return NextResponse.json({ statuses }, {
    headers: { "Cache-Control": "no-store" },
  })
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

  // "Planned" is the absence of an answer, not one of them — storing it pins
  // the session open against a run that matches it, with no way back from the
  // screen because the control cycles round to this very value. Clearing the
  // row is what hands the session back to the matcher.
  //
  // Done here rather than only in the client because this is an installed PWA:
  // a service worker can serve yesterday's bundle for a long time, and those
  // clients go on sending PUT "planned". They get the right behaviour too.
  if (status === "planned") {
    const { error: deleteError } = await supabase
      .from("session_completions")
      .delete()
      .eq("goal_id", goalId)
      .eq("user_id", user.id)
      .eq("session_key", sessionKey)

    if (deleteError) {
      return NextResponse.json({ error: "Failed to clear session status" }, { status: 500 })
    }
    return NextResponse.json({ ok: true, cleared: true })
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

  // Same rule as PUT: only real answers are stored. A localStorage backup
  // written by an older build can carry "planned" entries, and importing them
  // would recreate exactly the rows this release exists to stop making.
  const rows = Object.entries(statuses)
    .filter(([, status]) => status === "completed" || status === "skipped")
    .map(([sessionKey, status]) => ({
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
