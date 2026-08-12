/**
 * Accepting an invite link.
 *
 * GET  /api/shared-goals/join?token=…   what the link leads to
 * POST /api/shared-goals/join           { token, goalId } — join with one of my goals
 *
 * The lookup runs through the service role because a runner holding an invite
 * is, by definition, not yet a member: no policy would let them read the
 * group or the invite. Holding the token is the authorisation.
 *
 * One link, many runners, for a week. Handing it to a running club is one
 * message rather than one per person, and what limits the damage if it leaks
 * is the clock rather than the fact that the first stranger to open it used
 * it up. accepted_at and accepted_by are left where they are but decide
 * nothing: who is in the group is shared_goal_members.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { computeBaseline, refreshSharedGoalPositions } from "@/lib/shared-goal-sync"
import type { SharedGoalMetric } from "@/lib/types"

interface InviteRow {
  id: string
  shared_goal_id: string
  expires_at: string
}

async function findOpenInvite(token: string): Promise<InviteRow | null> {
  if (!token || token.length < 16) return null
  const service = createServiceClient()
  const { data } = await service
    .from("shared_goal_invites")
    .select("id, shared_goal_id, expires_at")
    .eq("token", token)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle()
  return (data as InviteRow | null) ?? null
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? ""
  const invite = await findOpenInvite(token)
  if (!invite) return NextResponse.json({ error: "Invalid or used invite" }, { status: 404 })

  const service = createServiceClient()
  const { data: goal } = await service
    .from("shared_goals")
    .select("id, name, race_date, distance_km, metric")
    .eq("id", invite.shared_goal_id)
    .maybeSingle()

  if (!goal) return NextResponse.json({ error: "Invalid or used invite" }, { status: 404 })

  const { count } = await service
    .from("shared_goal_members")
    .select("user_id", { count: "exact", head: true })
    .eq("shared_goal_id", goal.id)

  return NextResponse.json({
    id: goal.id,
    name: goal.name,
    raceDate: goal.race_date,
    distanceKm: Number(goal.distance_km),
    memberCount: count ?? 0,
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let token: string
  let goalId: string
  try {
    const body = await req.json()
    token = String(body.token ?? "")
    goalId = String(body.goalId ?? "")
    if (!token || !goalId) {
      return NextResponse.json({ error: "Missing token or goalId" }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const invite = await findOpenInvite(token)
  if (!invite) return NextResponse.json({ error: "Invalid or used invite" }, { status: 404 })

  // The goal has to be the joiner's own — the group is a join onto a goal
  // they already keep, not a goal it creates for them.
  const { data: goal } = await supabase
    .from("goals")
    .select("id, target_date, target_distance_km")
    .eq("user_id", user.id)
    .eq("id", goalId)
    .maybeSingle()

  if (!goal) return NextResponse.json({ error: "Goal not found" }, { status: 404 })

  const service = createServiceClient()

  const { data: already } = await service
    .from("shared_goal_members")
    .select("shared_goal_id")
    .eq("user_id", user.id)
    .or(`shared_goal_id.eq.${invite.shared_goal_id},goal_id.eq.${goalId}`)
    .maybeSingle()

  if (already) {
    return NextResponse.json(
      { error: "You are already in this group, or that goal is in another one" },
      { status: 409 },
    )
  }

  const { data: sharedGoal } = await service
    .from("shared_goals")
    .select("id, metric, distance_km")
    .eq("id", invite.shared_goal_id)
    .maybeSingle()

  if (!sharedGoal) return NextResponse.json({ error: "Invalid or used invite" }, { status: 404 })

  // A starting point is only locked for groups measured on progress. Adherence
  // needs none, which is most of why it is the measure groups run on.
  let baseline: { baseline_seconds: number | null; baseline_source: string } = {
    baseline_seconds: null,
    baseline_source: "none",
  }
  if ((sharedGoal.metric as SharedGoalMetric) === "progress") {
    const { data: activities } = await service
      .from("activities")
      .select("date, distance_km, duration_seconds, elevation_gain_m")
      .eq("user_id", user.id)
    baseline = computeBaseline(
      (activities ?? []) as Parameters<typeof computeBaseline>[0],
      Number(sharedGoal.distance_km),
    )
  }

  const { error: joinError } = await supabase.from("shared_goal_members").insert({
    shared_goal_id: invite.shared_goal_id,
    user_id: user.id,
    goal_id: goalId,
    baseline_seconds: baseline.baseline_seconds,
    baseline_source: baseline.baseline_source,
  })

  // 23505: already a member. With a link that works more than once, opening
  // it twice is an ordinary thing to do — and the runner is where they were
  // trying to get to, so it is not a failure to report.
  if (joinError && joinError.code !== "23505") {
    return NextResponse.json({ error: joinError.message }, { status: 500 })
  }

  // Give the new member a number now rather than a dash until their next
  // Strava sync, which could be days away.
  await refreshSharedGoalPositions(user.id)

  return NextResponse.json({ id: invite.shared_goal_id })
}
