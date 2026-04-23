import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"

/**
 * POST /api/goal-shares/[id]/invite
 *   Invite a user to the shared goal by email or display_name.
 *   Owner-only. Body: { query: string }
 *
 *   The server resolves the query to a single user and inserts a
 *   pending membership row. Returns 409 if the user is already
 *   a member (any status).
 */

interface Ctx {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id: shareId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: { query?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const query = body.query?.trim()
  if (!query) return NextResponse.json({ error: "query is required" }, { status: 400 })

  // Owner check
  const { data: me } = await supabase
    .from("goal_share_members")
    .select("role")
    .eq("goal_share_id", shareId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!me || me.role !== "owner") {
    return NextResponse.json({ error: "Only the owner can invite members" }, { status: 403 })
  }

  // Resolve the invitee via service client (profiles are private per-user in RLS;
  // this lookup is the only blessed way to find someone by email or name).
  const service = createServiceClient()

  // Prefer exact email match, fall back to case-insensitive display_name.
  const isEmailLike = query.includes("@")
  let match: { id: string; display_name: string | null; email: string | null } | null = null

  if (isEmailLike) {
    const { data } = await service
      .from("profiles")
      .select("id, display_name, email")
      .ilike("email", query)
      .maybeSingle()
    match = data ?? null
  }

  if (!match) {
    const { data } = await service
      .from("profiles")
      .select("id, display_name, email")
      .ilike("display_name", query)
      .limit(2)
    if (data && data.length === 1) match = data[0]
    else if (data && data.length > 1) {
      return NextResponse.json(
        { error: "Multiple users match — try inviting by email instead" },
        { status: 409 },
      )
    }
  }

  if (!match) {
    return NextResponse.json({ error: "No user found with that email or name" }, { status: 404 })
  }

  if (match.id === user.id) {
    return NextResponse.json({ error: "You're already a member" }, { status: 409 })
  }

  // Already a member?
  const { data: existing } = await supabase
    .from("goal_share_members")
    .select("id, status")
    .eq("goal_share_id", shareId)
    .eq("user_id", match.id)
    .maybeSingle()

  if (existing) {
    return NextResponse.json(
      { error: `User already ${existing.status}`, member_id: existing.id, status: existing.status },
      { status: 409 },
    )
  }

  const { data: invited, error: iErr } = await supabase
    .from("goal_share_members")
    .insert({
      goal_share_id: shareId,
      user_id: match.id,
      status: "pending",
      role: "member",
      invited_by: user.id,
    })
    .select()
    .single()

  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 })

  return NextResponse.json(
    {
      member: invited,
      invited_user: {
        id: match.id,
        display_name: match.display_name,
        email: match.email,
      },
    },
    { status: 201 },
  )
}
