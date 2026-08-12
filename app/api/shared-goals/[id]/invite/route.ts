/**
 * Make an invite link.
 *
 * POST   /api/shared-goals/[id]/invite                → { token }
 * DELETE /api/shared-goals/[id]/invite    { inviteId } revoke an unused link
 *
 * The owner hands the link over themselves. This app sends no mail of its
 * own, and a link needs no address, so nothing here can be used to find out
 * whether someone has an account.
 *
 * A group has at most one live link, and it lasts a week. Anyone holding it
 * can join while it lasts, so inviting a running club is one message rather
 * than one per runner, and a link that leaks stops mattering on its own.
 *
 * Making a new one revokes the last. The owner who presses "New link" a
 * second time has told us the first one is not the link they are handing
 * over — and until the clock runs out, that first one still works.
 */

/** How long a new link lasts. Long enough to be answered, short enough to forget. */
const INVITE_TTL_DAYS = 7

import { NextRequest, NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { createClient } from "@/lib/supabase/server"

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: goal } = await supabase
    .from("shared_goals")
    .select("owner_id")
    .eq("id", id)
    .maybeSingle()

  if (!goal) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (goal.owner_id !== user.id) {
    return NextResponse.json({ error: "Only the owner can invite" }, { status: 403 })
  }

  // Out with the last one. Before the insert rather than after, so a failure
  // here leaves the old link working rather than leaving two that do.
  const { error: revokeError } = await supabase
    .from("shared_goal_invites")
    .delete()
    .eq("shared_goal_id", id)

  if (revokeError) {
    return NextResponse.json({ error: revokeError.message }, { status: 500 })
  }

  // 32 bytes of urlsafe randomness. The token is the whole credential, so it
  // has to be long enough that guessing one is not a strategy.
  const token = randomBytes(32).toString("base64url")

  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)

  const { error } = await supabase.from("shared_goal_invites").insert({
    shared_goal_id: id,
    token,
    invited_by: user.id,
    // Written rather than left to the column default, so the window is
    // decided by the app and reads in one place with the copy that states it.
    expires_at: expiresAt.toISOString(),
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ token, expiresAt: expiresAt.toISOString() })
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
