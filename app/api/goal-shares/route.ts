import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"

/**
 * GET /api/goal-shares
 *   List all shared goals the caller belongs to (accepted + pending).
 *
 * POST /api/goal-shares
 *   Create a new shared goal. The caller becomes the owner and is
 *   auto-added as an accepted member. Body:
 *     { name, target_date, target_distance_km, goal_id? }
 *   If `goal_id` is provided, the owner's own goal is linked to the share.
 */

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Find all shares the user belongs to via their own membership rows
  const { data: myMemberships, error: mErr } = await supabase
    .from("goal_share_members")
    .select("goal_share_id, status, role, goal_id")
    .eq("user_id", user.id)

  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 })
  if (!myMemberships?.length) return NextResponse.json({ shares: [] })

  const shareIds = myMemberships.map((m) => m.goal_share_id)
  const { data: shares, error: sErr } = await supabase
    .from("goal_shares")
    .select("*")
    .in("id", shareIds)

  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })

  // Member counts (accepted only) — a simple aggregate for the list view
  const { data: allMembers } = await supabase
    .from("goal_share_members")
    .select("goal_share_id, status")
    .in("goal_share_id", shareIds)

  const memberCounts = new Map<string, number>()
  for (const m of allMembers ?? []) {
    if (m.status === "accepted") {
      memberCounts.set(m.goal_share_id, (memberCounts.get(m.goal_share_id) ?? 0) + 1)
    }
  }

  const result = (shares ?? []).map((s) => {
    const mine = myMemberships.find((m) => m.goal_share_id === s.id)!
    return {
      ...s,
      target_distance_km: Number(s.target_distance_km),
      my_status: mine.status,
      my_role: mine.role,
      my_goal_id: mine.goal_id,
      member_count: memberCounts.get(s.id) ?? 0,
    }
  })

  return NextResponse.json({ shares: result })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: { name?: string; target_date?: string; target_distance_km?: number; goal_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { name, target_date, target_distance_km, goal_id } = body
  if (!name?.trim() || !target_date || typeof target_distance_km !== "number") {
    return NextResponse.json(
      { error: "name, target_date, and target_distance_km are required" },
      { status: 400 },
    )
  }

  // If goal_id provided, verify it belongs to the caller
  if (goal_id) {
    const { data: goal } = await supabase
      .from("goals")
      .select("id")
      .eq("id", goal_id)
      .eq("user_id", user.id)
      .maybeSingle()
    if (!goal) return NextResponse.json({ error: "Goal not found" }, { status: 404 })
  }

  // Create the share
  const { data: share, error: sErr } = await supabase
    .from("goal_shares")
    .insert({
      name: name.trim(),
      target_date,
      target_distance_km,
      created_by: user.id,
    })
    .select()
    .single()

  if (sErr || !share) {
    return NextResponse.json({ error: sErr?.message ?? "Insert failed" }, { status: 500 })
  }

  // Bootstrap self as owner (accepted)
  const { error: mErr } = await supabase
    .from("goal_share_members")
    .insert({
      goal_share_id: share.id,
      user_id: user.id,
      goal_id: goal_id ?? null,
      status: "accepted",
      role: "owner",
      invited_by: user.id,
      responded_at: new Date().toISOString(),
    })

  if (mErr) {
    // Roll back the share — service client to bypass RLS
    const service = createServiceClient()
    await service.from("goal_shares").delete().eq("id", share.id)
    return NextResponse.json({ error: mErr.message }, { status: 500 })
  }

  return NextResponse.json({ share }, { status: 201 })
}
