/**
 * Make an invite link.
 *
 * POST   /api/shared-goals/[id]/invite    { label? }  → { token }
 * DELETE /api/shared-goals/[id]/invite    { inviteId } revoke an unused link
 *
 * The owner hands the link over themselves. This app sends no mail of its
 * own, and a link needs no address, so nothing here can be used to find out
 * whether someone has an account.
 */

import { NextRequest, NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { createClient } from "@/lib/supabase/server"

/** Open links a group may have at once. Enough to invite a running club. */
const MAX_PENDING_INVITES = 20

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let label: string | null = null
  try {
    const body = await req.json().catch(() => ({}))
    const raw = typeof body?.label === "string" ? body.label.trim() : ""
    label = raw ? raw.slice(0, 60) : null
  } catch {
    label = null
  }

  const { data: goal } = await supabase
    .from("shared_goals")
    .select("owner_id")
    .eq("id", id)
    .maybeSingle()

  if (!goal) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (goal.owner_id !== user.id) {
    return NextResponse.json({ error: "Only the owner can invite" }, { status: 403 })
  }

  const { count } = await supabase
    .from("shared_goal_invites")
    .select("id", { count: "exact", head: true })
    .eq("shared_goal_id", id)
    .is("accepted_at", null)

  if ((count ?? 0) >= MAX_PENDING_INVITES) {
    return NextResponse.json({ error: "Too many open invite links" }, { status: 429 })
  }

  // 32 bytes of urlsafe randomness. The token is the whole credential, so it
  // has to be long enough that guessing one is not a strategy.
  const token = randomBytes(32).toString("base64url")

  const { error } = await supabase.from("shared_goal_invites").insert({
    shared_goal_id: id,
    token,
    label,
    invited_by: user.id,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ token })
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let inviteId: string
  try {
    const body = await req.json()
    inviteId = String(body.inviteId ?? "")
    if (!inviteId) return NextResponse.json({ error: "Missing inviteId" }, { status: 400 })
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  // The delete policy already restricts this to the owner; scoping the query
  // to the group as well means a stray id from another group cannot be used
  // to probe what exists.
  const { error } = await supabase
    .from("shared_goal_invites")
    .delete()
    .eq("id", inviteId)
    .eq("shared_goal_id", id)
    .is("accepted_at", null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
