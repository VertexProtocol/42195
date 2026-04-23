import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * DELETE /api/goal-shares/[id]/members?user_id=<uuid>
 *   Leave a shared goal (user_id omitted or equals auth.uid()), or —
 *   if caller is owner — remove another member.
 */

interface Ctx {
  params: Promise<{ id: string }>
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { id: shareId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const targetUserId = req.nextUrl.searchParams.get("user_id") ?? user.id

  // RLS handles the authorization (self-leave or owner-remove).
  const { error } = await supabase
    .from("goal_share_members")
    .delete()
    .eq("goal_share_id", shareId)
    .eq("user_id", targetUserId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
