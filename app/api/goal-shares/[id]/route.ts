import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"

/**
 * GET /api/goal-shares/[id]
 *   Fetch shared-goal dashboard data: the share, all members (with display
 *   name + avatar), and each accepted member's linked goal progress and
 *   recent-week activity summary.
 *
 * DELETE /api/goal-shares/[id]
 *   Owner deletes the whole shared goal. Members should leave via
 *   DELETE /api/goal-shares/[id]/members.
 */

interface Ctx {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // RLS enforces membership — if not a member, this returns null
  const { data: share, error: sErr } = await supabase
    .from("goal_shares")
    .select("*")
    .eq("id", id)
    .maybeSingle()

  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })
  if (!share) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Pull members (RLS lets members see each other)
  const { data: members, error: mErr } = await supabase
    .from("goal_share_members")
    .select("*")
    .eq("goal_share_id", id)
    .order("invited_at", { ascending: true })

  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 })

  // Join profile data via the service client so member names/avatars are
  // always visible within a share (profiles RLS restricts to self otherwise).
  // We scope to exactly the user_ids on this share, so no data leaks.
  const service = createServiceClient()
  const memberIds = (members ?? []).map((m) => m.user_id)
  const goalIds = (members ?? []).map((m) => m.goal_id).filter(Boolean) as string[]

  const [profilesRes, goalsRes, activitiesRes] = await Promise.all([
    memberIds.length
      ? service.from("profiles").select("id, display_name, avatar_url, email").in("id", memberIds)
      : Promise.resolve({ data: [] as any[] }),
    goalIds.length
      ? service.from("goals").select("id, user_id, name, target_distance_km, current_distance_km, target_date, start_date")
          .in("id", goalIds)
      : Promise.resolve({ data: [] as any[] }),
    // Activities for the last 28 days per member (small window for dashboard)
    memberIds.length
      ? service.from("activities")
          .select("id, user_id, type, name, date, distance_km, duration_seconds, pace_min_per_km")
          .in("user_id", memberIds)
          .gte("date", new Date(Date.now() - 28 * 86400_000).toISOString())
          .order("date", { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
  ])

  const profilesById = new Map<string, any>()
  for (const p of profilesRes.data ?? []) profilesById.set(p.id, p)

  const goalsById = new Map<string, any>()
  for (const g of goalsRes.data ?? []) goalsById.set(g.id, g)

  const activitiesByUser = new Map<string, any[]>()
  for (const a of activitiesRes.data ?? []) {
    const arr = activitiesByUser.get(a.user_id) ?? []
    arr.push(a)
    activitiesByUser.set(a.user_id, arr)
  }

  const enriched = (members ?? []).map((m) => {
    const profile = profilesById.get(m.user_id)
    const goal = m.goal_id ? goalsById.get(m.goal_id) : null
    const activities = activitiesByUser.get(m.user_id) ?? []

    // Current-week metrics (Monday 00:00 local → now)
    const now = new Date()
    const day = now.getDay() || 7
    const monday = new Date(now)
    monday.setDate(now.getDate() - day + 1)
    monday.setHours(0, 0, 0, 0)

    const weekActivities = activities.filter((a) => new Date(a.date) >= monday)
    const weekDistance = weekActivities.reduce((s, a) => s + Number(a.distance_km ?? 0), 0)
    const weekSessions = weekActivities.length

    return {
      id: m.id,
      goal_share_id: m.goal_share_id,
      user_id: m.user_id,
      goal_id: m.goal_id,
      status: m.status,
      role: m.role,
      invited_by: m.invited_by,
      invited_at: m.invited_at,
      responded_at: m.responded_at,
      display_name: profile?.display_name ?? profile?.email ?? "Runner",
      avatar_url: profile?.avatar_url ?? null,
      linked_goal: goal
        ? {
            id: goal.id,
            name: goal.name,
            target_distance_km: Number(goal.target_distance_km),
            current_distance_km: Number(goal.current_distance_km),
            target_date: goal.target_date,
            start_date: goal.start_date,
          }
        : null,
      week_distance_km: Number(weekDistance.toFixed(2)),
      week_sessions: weekSessions,
      recent_activities: activities.slice(0, 3).map((a) => ({
        id: a.id,
        type: a.type,
        name: a.name,
        date: a.date,
        distance_km: Number(a.distance_km),
        duration_seconds: a.duration_seconds,
        pace_min_per_km: a.pace_min_per_km ? Number(a.pace_min_per_km) : null,
      })),
    }
  })

  const myMembership = enriched.find((m) => m.user_id === user.id) ?? null

  return NextResponse.json({
    share: { ...share, target_distance_km: Number(share.target_distance_km) },
    members: enriched,
    my_membership: myMembership,
  })
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // RLS: only owner can delete — but check explicitly for a nicer error
  const { data: me } = await supabase
    .from("goal_share_members")
    .select("role, status")
    .eq("goal_share_id", id)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!me || me.role !== "owner") {
    return NextResponse.json({ error: "Only the owner can delete a shared goal" }, { status: 403 })
  }

  const { error } = await supabase.from("goal_shares").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
