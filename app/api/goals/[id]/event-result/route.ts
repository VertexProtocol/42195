import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { fetchAllActivities } from "@/lib/activities-query"
import { eventCandidates } from "@/lib/event-result"
import { refreshSharedGoalPositions } from "@/lib/shared-goal-sync"
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm"), activityId: z.string().uuid() }),
  z.object({ action: z.literal("dismiss") }),
  z.object({ action: z.literal("reset") }),
])
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const db = await createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const input = schema.safeParse(await req.json().catch(() => null))
  if (!input.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  const { id } = await params
  const { data: goal, error: readError } = await db.from("goals").select("*").eq("id", id).eq("user_id", user.id).maybeSingle()
  if (readError) return NextResponse.json({ error: "storage_unavailable" }, { status: 503 })
  if (!goal || goal.goal_category !== "event_training") return NextResponse.json({ error: "not_found" }, { status: 404 })
  if (input.data.action === "confirm") {
    const activityId = input.data.activityId
    const activities = await fetchAllActivities(db)
    if (!eventCandidates(goal, activities).some(a => a.id === activityId)) return NextResponse.json({ error: "invalid_activity" }, { status: 400 })
  }
  const patch = { event_activity_id: input.data.action === "confirm" ? input.data.activityId : null, event_match_dismissed: input.data.action === "dismiss" }
  const { data, error } = await db.from("goals").update(patch).eq("id", id).eq("user_id", user.id).select("id, event_activity_id, event_match_dismissed").single()
  if (error) return NextResponse.json({ error: "save_failed" }, { status: 503 })
  await refreshSharedGoalPositions(user.id)
  return NextResponse.json(data)
}
