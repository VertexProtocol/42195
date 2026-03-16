import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const REVIEW_SYSTEM_PROMPT = `You are a concise running coach doing a weekly training review. Compare the runner's actual training against their plan and provide actionable feedback.

Respond in this exact JSON format:
{
  "grade": "A" | "B" | "C" | "D",
  "summary": "1-2 sentence overview of the week",
  "highlights": ["1-3 positive things"],
  "concerns": ["0-2 things to watch"],
  "nextWeekAdvice": "1 sentence of advice for next week"
}

Grading: A = exceeded plan, B = completed plan well, C = partially completed, D = significantly below plan.
Be specific — reference actual numbers. Keep each field brief.`

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let goalId: string
  let weekNumber: number
  try {
    const body = await req.json()
    goalId = body.goalId
    weekNumber = body.weekNumber
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  if (!goalId || !weekNumber) {
    return NextResponse.json({ error: "goalId and weekNumber are required" }, { status: 400 })
  }

  // Fetch the training plan
  const { data: planRow } = await supabase
    .from("ai_training_plans")
    .select("plan, block_start_date")
    .eq("goal_id", goalId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!planRow?.plan) {
    return NextResponse.json({ error: "No training plan found" }, { status: 404 })
  }

  const plan = planRow.plan as { weeks: Array<{ weekNumber: number; theme: string; targetKm: number; sessions: Array<{ type: string; distance: string; effort: string }> }> }
  const week = plan.weeks.find((w) => w.weekNumber === weekNumber)
  if (!week) {
    return NextResponse.json({ error: "Week not found in plan" }, { status: 404 })
  }

  // Calculate the date range for this week
  const blockStart = new Date(planRow.block_start_date)
  // Snap to Monday
  const day = blockStart.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  blockStart.setDate(blockStart.getDate() + diff)
  const weekStart = new Date(blockStart)
  weekStart.setDate(weekStart.getDate() + (weekNumber - 1) * 7)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 7)

  // Fetch activities for this week
  const { data: activities } = await supabase
    .from("activities")
    .select("name, type, date, distance_km, duration_seconds, pace_min_per_km, avg_heart_rate, elevation_gain_m")
    .eq("user_id", user.id)
    .gte("date", weekStart.toISOString())
    .lt("date", weekEnd.toISOString())
    .order("date", { ascending: true })

  // Fetch session completions
  const { data: completions } = await supabase
    .from("session_completions")
    .select("session_key, status")
    .eq("goal_id", goalId)
    .eq("user_id", user.id)

  const weekCompletions = (completions ?? []).filter((c) => c.session_key.startsWith(`W${weekNumber}-`))

  const acts = activities ?? []
  const totalKm = acts.reduce((s, a) => s + Number(a.distance_km), 0)
  const totalRuns = acts.length

  const prompt = `Review week ${weekNumber} of this runner's training:

PLANNED:
- Theme: ${week.theme}
- Target: ${week.targetKm} km across ${week.sessions.length} sessions
- Sessions: ${week.sessions.map((s) => `${s.type} (${s.distance}, ${s.effort})`).join("; ")}

ACTUAL:
- Runs completed: ${totalRuns}
- Total distance: ${totalKm.toFixed(1)} km (target: ${week.targetKm} km)
${acts.map((a) => `- ${a.name}: ${Number(a.distance_km).toFixed(1)} km, ${Math.floor(a.duration_seconds / 60)}min${a.avg_heart_rate ? `, HR ${a.avg_heart_rate}` : ""}${a.elevation_gain_m ? `, +${Math.round(Number(a.elevation_gain_m))} m elevation` : ""}`).join("\n")}

Session completion: ${weekCompletions.filter((c) => c.status === "completed").length}/${week.sessions.length} marked completed, ${weekCompletions.filter((c) => c.status === "skipped").length} skipped`

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system: [
        {
          type: "text" as const,
          text: REVIEW_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      messages: [{ role: "user", content: prompt }],
    })

    const textBlock = response.content.find((b) => b.type === "text")
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json({ error: "No response" }, { status: 500 })
    }

    // Parse JSON from response
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: "Invalid response format" }, { status: 500 })
    }

    const review = JSON.parse(jsonMatch[0])
    return NextResponse.json({ review })
  } catch (err) {
    console.error("Weekly review error:", err)
    return NextResponse.json({ error: "Failed to generate review" }, { status: 500 })
  }
}
