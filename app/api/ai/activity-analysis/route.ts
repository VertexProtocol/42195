import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { checkAiRateLimit, rateLimitExceededResponse } from "@/lib/ai-rate-limit"

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const activityId = req.nextUrl.searchParams.get("activityId")
  if (!activityId) return NextResponse.json({ error: "activityId is required" }, { status: 400 })

  const { data } = await supabase
    .from("activity_analyses")
    .select("analysis")
    .eq("activity_id", activityId)
    .eq("user_id", user.id)
    .single()

  if (!data) return NextResponse.json({ analysis: null })
  return NextResponse.json({ analysis: data.analysis })
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const ANALYSIS_SYSTEM_PROMPT = `You are a concise running coach reviewing a runner's completed activity. Provide a brief, actionable analysis in 3-5 short sentences. Be specific about the data — reference actual numbers. Be encouraging but honest.

Structure your response as:
1. Overall assessment (one sentence)
2. What went well (one sentence)
3. What to watch or improve (one sentence)
4. Suggestion for next session (one sentence)

Keep it under 100 words total. Do not use bullet points or headers — write flowing text.`

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const rateLimit = await checkAiRateLimit(user.id)
  if (!rateLimit.allowed) return rateLimitExceededResponse(rateLimit)

  let activityId: string
  try {
    const body = await req.json()
    activityId = body.activityId
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  if (!activityId) return NextResponse.json({ error: "activityId is required" }, { status: 400 })

  // Fetch the activity
  const { data: activity } = await supabase
    .from("activities")
    .select("name, type, date, distance_km, duration_seconds, pace_min_per_km, avg_heart_rate, elevation_gain_m")
    .eq("id", activityId)
    .eq("user_id", user.id)
    .single()

  if (!activity) return NextResponse.json({ error: "Activity not found" }, { status: 404 })

  // Fetch recent context (last 14 days excluding this activity)
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 14)
  const { data: recentActivities } = await supabase
    .from("activities")
    .select("distance_km, duration_seconds, pace_min_per_km, avg_heart_rate, date")
    .eq("user_id", user.id)
    .neq("id", activityId)
    .gte("date", cutoff.toISOString())
    .order("date", { ascending: false })
    .limit(10)

  // Fetch active goals for context
  const { data: goals } = await supabase
    .from("goals")
    .select("name, target_distance_km, target_date")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(3)

  // Build context for the analysis
  const pace = activity.pace_min_per_km
    ? `${Math.floor(activity.pace_min_per_km)}:${String(Math.round((activity.pace_min_per_km % 1) * 60)).padStart(2, "0")} min/km`
    : "unknown"

  const recentAvgPace = recentActivities && recentActivities.length > 0
    ? recentActivities
        .filter((a) => a.pace_min_per_km)
        .reduce((s, a) => s + Number(a.pace_min_per_km), 0) / recentActivities.filter((a) => a.pace_min_per_km).length
    : null

  const recentAvgDistance = recentActivities && recentActivities.length > 0
    ? recentActivities.reduce((s, a) => s + Number(a.distance_km), 0) / recentActivities.length
    : null

  const prompt = `Analyze this run:
- Activity: ${activity.name} (${activity.type})
- Date: ${activity.date}
- Distance: ${Number(activity.distance_km).toFixed(2)} km
- Duration: ${Math.floor(activity.duration_seconds / 60)}min ${activity.duration_seconds % 60}s
- Pace: ${pace}${activity.avg_heart_rate ? `\n- Avg HR: ${activity.avg_heart_rate} bpm` : ""}${activity.elevation_gain_m ? `\n- Elevation: ${activity.elevation_gain_m}m` : ""}

Recent context (last 2 weeks): ${recentActivities?.length ?? 0} runs${recentAvgPace ? `, avg pace ${Math.floor(recentAvgPace)}:${String(Math.round((recentAvgPace % 1) * 60)).padStart(2, "0")} min/km` : ""}${recentAvgDistance ? `, avg distance ${recentAvgDistance.toFixed(1)} km` : ""}${goals && goals.length > 0 ? `\nActive goals: ${goals.map((g) => `${g.name} (${g.target_distance_km}km on ${g.target_date})`).join(", ")}` : ""}`

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: [
        {
          type: "text" as const,
          text: ANALYSIS_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      messages: [{ role: "user", content: prompt }],
    })

    const textBlock = response.content.find((b) => b.type === "text")
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json({ error: "No response from AI" }, { status: 500 })
    }

    // Persist so the user sees the same analysis on future visits
    await supabase
      .from("activity_analyses")
      .upsert({ user_id: user.id, activity_id: activityId, analysis: textBlock.text }, { onConflict: "activity_id" })

    return NextResponse.json({ analysis: textBlock.text })
  } catch (err) {
    console.error("Activity analysis error:", err)
    return NextResponse.json({ error: "Failed to analyze activity" }, { status: 500 })
  }
}
