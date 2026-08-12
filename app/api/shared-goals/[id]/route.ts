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
import { isDatePast } from "@/lib/format"
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
  /**
   * How it went, once the race has been run: the same verdict this runner's
   * own goal screen shows them. Null until their sync has recorded one —
   * which is not the same as falling short, and must not read as it.
   */
  outcome: "reached" | "ended" | null
}

export interface SharedGoalView {
  id: string
  name: string
  raceDate: string
  distanceKm: number
  metric: SharedGoalMetric
  isOwner: boolean
  /** The race has been run. The lane stops moving and the rows read as results. */
  finished: boolean
  members: SharedGoalMemberView[]
  /**
   * The group's live invite link, if it has one. Owner only; empty for
   * everyone else. At most one — making a new link revokes the last.
   */
  pendingInvites: Array<{
    id: string
    token: string
    expiresAt: string
  }>
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
      .select("user_id, position_pct, adherence_done, adherence_target, updated_at, outcome")
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
    outcome: "reached" | "ended" | null
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
      outcome: m.outcome ?? null,
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
    // Live means unexpired. It used to mean unaccepted, which stopped being
    // the question when one link started letting in more than one runner.
    const { data: invites } = await supabase
      .from("shared_goal_invites")
      .select("id, token, expires_at")
      .eq("shared_goal_id", id)
      .gt("expires_at", new Date().toISOString())
    pendingInvites = (invites ?? []).map((i) => ({
      id: i.id as string,
      token: i.token as string,
      expiresAt: i.expires_at as string,
    }))
  }

  const view: SharedGoalView = {
    id: goal.id,
    name: goal.name,
    raceDate: goal.race_date,
    distanceKm: Number(goal.distance_km),
    metric: goal.metric as SharedGoalMetric,
    isOwner,
    finished: isDatePast(goal.race_date),
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
