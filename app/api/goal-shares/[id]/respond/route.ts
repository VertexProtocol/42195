import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * POST /api/goal-shares/[id]/respond
 *   Accept or decline a pending invitation.
 *   Body: { action: "accept" | "decline", goal_id?: string }
 *   `goal_id` is required when accepting — it's the caller's personal goal
 *   that will be linked to the shared container.
 */

interface Ctx {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id: shareId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: { action?: "accept" | "decline"; goal_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { action, goal_id } = body
  if (action !== "accept" && action !== "decline") {
    return NextResponse.json({ error: "action must be 'accept' or 'decline'" }, { status: 400 })
  }

  // Fetch my pending invite
  const { data: membership } = await supabase
    .from("goal_share_members")
    .select("id, status")
    .eq("goal_share_id", shareId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: "No invitation found" }, { status: 404 })
  if (membership.status !== "pending") {
    return NextResponse.json({ error: `Already ${membership.status}` }, { status: 409 })
  }

  if (action === "accept") {
    if (!goal_id) {
      return NextResponse.json({ error: "goal_id is required when accepting" }, { status: 400 })
    }
    // Verify the goal belongs to the caller
    const { data: goal } = await supabase
      .from("goals")
      .select("id")
      .eq("id", goal_id)
      .eq("user_id", user.id)
      .maybeSingle()
    if (!goal) return NextResponse.json({ error: "Goal not found" }, { status: 404 })
  }

  const { data: updated, error } = await supabase
    .from("goal_share_members")
    .update({
      status: action === "accept" ? "accepted" : "declined",
      goal_id: action === "accept" ? goal_id! : null,
      responded_at: new Date().toISOString(),
    })
    .eq("id", membership.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ member: updated })
}
