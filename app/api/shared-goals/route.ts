/**
 * Shared goals a runner belongs to.
 *
 * GET  /api/shared-goals?goal=<goalId>   the group attached to one of my goals
 * POST /api/shared-goals                 create a group from one of my goals
 *
 * The group screen reads positions that were written by each member's own
 * sync. Nothing here computes anyone else's number, and nothing here reads
 * anyone else's activities — those stay behind select-own policies, which is
 * the whole reason the positions are denormalised onto the member rows.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import type { SharedGoalMetric } from "@/lib/types"
import { refreshSharedGoalPositions } from "@/lib/shared-goal-sync"

/** What the entry row on a goal's detail screen needs. */
export interface SharedGoalSummary {
  id: string
  name: string
  race_date: string
  metric: SharedGoalMetric
  memberCount: number
  /** Initials for the stacked avatars, other members first. */
  initials: string[]
  /** The reader's own position, or null when it has not been measured. */
  myPositionPct: number | null
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const goalId = req.nextUrl.searchParams.get("goal")

  // The page render seeds these, so this route exists to re-read them after a
  // group is created, joined or left — not on every visit to a goal.
  let query = supabase
    .from("shared_goal_members")
    .select("goal_id, position_pct, shared_goals(id, name, race_date, metric)")
    .eq("user_id", user.id)
  if (goalId) query = query.eq("goal_id", goalId)

  const { data: rows, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const groups: Record<string, SharedGoalSummary> = {}

  await Promise.all(
    (rows ?? []).map(async (row) => {
      const embed = row.shared_goals as unknown
      const goal = (Array.isArray(embed) ? embed[0] : embed) as {
        id: string
        name: string
        race_date: string
        metric: SharedGoalMetric
      } | null
      if (!goal) return

      const { data: names } = await supabase.rpc("shared_goal_member_names", { g: goal.id })
      const members = (names ?? []) as Array<{ user_id: string; display_name: string | null }>

      groups[row.goal_id as string] = {
        id: goal.id,
        name: goal.name,
        race_date: goal.race_date,
        metric: goal.metric,
        memberCount: members.length,
        initials: members
          .filter((m) => m.user_id !== user.id)
          .map((m) => initialOf(m.display_name))
          .slice(0, 3),
        myPositionPct: row.position_pct == null ? null : Number(row.position_pct),
      }
    }),
  )

  // Asking about one goal answers about that goal; asking about none answers
  // about all of them, which is what the client-side refresh wants.
  if (goalId) {
    return NextResponse.json({ group: groups[goalId] ?? null, groups })
  }
  return NextResponse.json({ groups })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let goalId: string
  let name: string
  try {
    const body = await req.json()
    goalId = String(body.goalId ?? "")
    name = String(body.name ?? "").trim()
    if (!goalId) return NextResponse.json({ error: "Missing goalId" }, { status: 400 })
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  // The race and the date come from the runner's own goal, so a group cannot
  // be created against a date its owner is not actually training for.
  const { data: goal } = await supabase
    .from("goals")
    .select("id, name, target_date, target_distance_km")
    .eq("user_id", user.id)
    .eq("id", goalId)
    .maybeSingle()

  if (!goal) return NextResponse.json({ error: "Goal not found" }, { status: 404 })

  const { data: existing } = await supabase
    .from("shared_goal_members")
    .select("shared_goal_id")
    .eq("user_id", user.id)
    .eq("goal_id", goalId)
    .maybeSingle()

  if (existing) {
    return NextResponse.json(
      { error: "That goal is already in a group", id: existing.shared_goal_id },
      { status: 409 },
    )
  }

  const { data: created, error: createError } = await supabase
    .from("shared_goals")
    .insert({
      owner_id: user.id,
      name: name || goal.name,
      race_date: goal.target_date,
      distance_km: goal.target_distance_km,
      // Left at the column default. Adherence is the measure every group runs
      // on; the column exists for the day a denser-logging group can carry
      // progress, not as a question to put to whoever creates this one.
    })
    .select("id")
    .single()

  if (createError || !created) {
    return NextResponse.json({ error: createError?.message ?? "Could not create" }, { status: 500 })
  }

  const { error: joinError } = await supabase.from("shared_goal_members").insert({
    shared_goal_id: created.id,
    user_id: user.id,
    goal_id: goalId,
  })

  if (joinError) {
    // A group with no members is not a group. Roll it back rather than leave
    // an orphan the owner cannot see or delete.
    await supabase.from("shared_goals").delete().eq("id", created.id)
    return NextResponse.json({ error: joinError.message }, { status: 500 })
  }

  // The owner's own position, so the group has a number on its first paint
  // instead of waiting for the next sync.
  await refreshSharedGoalPositions(user.id)

  return NextResponse.json({ id: created.id })
}

/** First character of a display name, upper-cased. "?" when there is none. */
export function initialOf(displayName: string | null | undefined): string {
  const trimmed = (displayName ?? "").trim()
  return trimmed ? trimmed[0].toUpperCase() : "?"
}
