/**
 * One group, as its members see it.
 *
 * GET    /api/shared-goals/[id]   the lane and the rows
 * DELETE /api/shared-goals/[id]   leave, or — for the owner — disband
 *
 * Every number here was written by the runner it belongs to, during their own
 * sync. This route reads member rows and display names and nothing else: no
 * activities, no paces, no heart rates. That boundary is enforced by RLS and
 * by the two security-definer functions, not by this file remembering to be
 * careful.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import type { SharedGoalMetric } from "@/lib/types"
import { initialOf } from "../route"

export interface SharedGoalMemberView {
  userId: string
  name: string
  initial: string
  isSelf: boolean
  /** Null means not measured — the row shows a dash, never a zero. */
  positionPct: number | null
  adherenceDone: number | null
  adherenceTarget: number | null
  /** When this member's own sync last wrote a position. */
  updatedAt: string | null
}

export interface SharedGoalView {
  id: string
  name: string
  raceDate: string
  distanceKm: number
  metric: SharedGoalMetric
  isOwner: boolean
  members: SharedGoalMemberView[]
  /** Unaccepted invite links. Owner only; empty for everyone else. */
  pendingInvites: Array<{ id: string; label: string | null; token: string }>
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // RLS decides this: a non-member simply sees no row, which is the same
  // answer as a group that does not exist.
  const { data: goal } = await supabase
    .from("shared_goals")
    .select("id, name, race_date, distance_km, metric, owner_id")
    .eq("id", id)
    .maybeSingle()

  if (!goal) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const [{ data: memberRows }, { data: nameRows }] = await Promise.all([
    supabase
      .from("shared_goal_members")
      .select("user_id, position_pct, adherence_done, adherence_target, updated_at")
      .eq("shared_goal_id", id),
    supabase.rpc("shared_goal_member_names", { g: id }),
  ])

  const names = new Map(
    ((nameRows ?? []) as Array<{ user_id: string; display_name: string | null }>).map((r) => [
      r.user_id,
      r.display_name,
    ]),
  )

  const members: SharedGoalMemberView[] = ((memberRows ?? []) as Array<{
    user_id: string
    position_pct: number | null
    adherence_done: number | null
    adherence_target: number | null
    updated_at: string | null
  }>).map((m) => {
    const name = names.get(m.user_id) ?? null
    return {
      userId: m.user_id,
      name: name ?? "Runner",
      initial: initialOf(name),
      isSelf: m.user_id === user.id,
      positionPct: m.position_pct == null ? null : Number(m.position_pct),
      adherenceDone: m.adherence_done == null ? null : Number(m.adherence_done),
      adherenceTarget: m.adherence_target == null ? null : Number(m.adherence_target),
      updatedAt: m.updated_at,
    }
  })

  // Sorted by position, with the unmeasured last: a dash is not a score, and
  // putting it above someone who has a real number would read as one.
  members.sort((a, b) => {
    if (a.positionPct == null && b.positionPct == null) return a.name.localeCompare(b.name)
    if (a.positionPct == null) return 1
    if (b.positionPct == null) return -1
    return b.positionPct - a.positionPct
  })

  const isOwner = goal.owner_id === user.id
  let pendingInvites: SharedGoalView["pendingInvites"] = []
  if (isOwner) {
    const { data: invites } = await supabase
      .from("shared_goal_invites")
      .select("id, label, token")
      .eq("shared_goal_id", id)
      .is("accepted_at", null)
    pendingInvites = (invites ?? []) as SharedGoalView["pendingInvites"]
  }

  const view: SharedGoalView = {
    id: goal.id,
    name: goal.name,
    raceDate: goal.race_date,
    distanceKm: Number(goal.distance_km),
    metric: goal.metric as SharedGoalMetric,
    isOwner,
    members,
    pendingInvites,
  }

  return NextResponse.json(view)
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

  // Leaving is quiet and unremarkable, and nobody is told. The owner leaving
  // takes the group with them — a group whose race nobody owns has no date.
  if (goal.owner_id === user.id) {
    const { error } = await supabase.from("shared_goals").delete().eq("id", id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, disbanded: true })
  }

  const { error } = await supabase
    .from("shared_goal_members")
    .delete()
    .eq("shared_goal_id", id)
    .eq("user_id", user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, disbanded: false })
}
