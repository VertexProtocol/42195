import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { anthropic } from "@/lib/anthropic"
import { createClient } from "@/lib/supabase/server"
import { checkAiRateLimit, rateLimitExceededResponse } from "@/lib/ai-rate-limit"
import { logAiUsage } from "@/lib/ai-usage"

const RUN_TYPES = ["Run", "Trail Run", "Virtual Run", "Treadmill", "Race"]

/** Weekly review JSON shape enforced on Claude's response. */
const WeeklyReviewSchema = z.object({
  grade: z.enum(["A", "B", "C", "D"]),
  summary: z.string().min(1),
  highlights: z.array(z.string().min(1)),
  concerns: z.array(z.string()).optional().default([]),
  nextWeekAdvice: z.string().min(1),
})

/**
 * JSON Schema mirror of WeeklyReviewSchema, for structured outputs.
 * Hand-maintained: the SDK's zodOutputFormat() needs zod v4 and this project
 * is on zod 3. Length constraints from the zod schema are absent because
 * structured outputs does not support them — zod still enforces them below.
 */
const WEEKLY_REVIEW_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["grade", "summary", "highlights", "concerns", "nextWeekAdvice"],
  properties: {
    grade: { type: "string", enum: ["A", "B", "C", "D"] },
    summary: { type: "string", description: "1-2 sentence overview of the week" },
    highlights: { type: "array", items: { type: "string" }, description: "1-3 positive things" },
    concerns: { type: "array", items: { type: "string" }, description: "0-2 things to watch; empty if none" },
    nextWeekAdvice: { type: "string", description: "One sentence of advice for next week" },
  },
} as const

const REVIEW_SYSTEM_PROMPT = `You are a concise running coach doing a weekly training review. Compare the runner's actual training against their plan and give feedback they can act on.

Grading: A = exceeded plan, B = completed plan well, C = partially completed, D = significantly below plan.
Be specific — reference actual numbers. Keep each field brief.`

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const rateLimit = await checkAiRateLimit(user.id)
  if (!rateLimit.allowed) return rateLimitExceededResponse(rateLimit)

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

  // Fetch running activities for this week — comparing bike km against a
  // running target would understate the grade and confuse the review.
  const { data: activities } = await supabase
    .from("activities")
    .select("name, type, date, distance_km, duration_seconds, pace_min_per_km, avg_heart_rate, elevation_gain_m")
    .eq("user_id", user.id)
    .in("type", RUN_TYPES)
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
      model: "claude-haiku-4-5",
      // Grading a completed week should be deterministic — the same week
      // shouldn't get different grades on refresh.
      temperature: 0,
      max_tokens: 1500,
      output_config: {
        format: { type: "json_schema" as const, schema: WEEKLY_REVIEW_JSON_SCHEMA },
      },
      // No cache_control: measured at 432 tokens including the output schema,
      // against Haiku 4.5's 4096-token minimum cacheable prefix. Below the
      // minimum the API caches nothing and says nothing.
      // See scripts/smoke/smoke.mjs tokens.
      system: [
        {
          type: "text" as const,
          text: REVIEW_SYSTEM_PROMPT,
        },
      ],
      messages: [{ role: "user", content: prompt }],
    })

    logAiUsage("weekly-review", response.usage)

    const textBlock = response.content.find((b) => b.type === "text")
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json({ error: "No response" }, { status: 500 })
    }

    // Structured outputs guarantees valid JSON matching the schema, so zod is a
    // type guard for the UI that renders grade/highlights/concerns rather than
    // the last line of defence against a malformed response.
    const reviewResult = WeeklyReviewSchema.safeParse(JSON.parse(textBlock.text))
    if (!reviewResult.success) {
      console.error(
        "[weekly-review] Response failed schema validation:",
        reviewResult.error.issues,
        "raw:",
        textBlock.text.slice(0, 500),
      )
      return NextResponse.json({ error: "Response failed validation" }, { status: 502 })
    }

    return NextResponse.json({ review: reviewResult.data })
  } catch (err) {
    console.error("Weekly review error:", err)
    return NextResponse.json({ error: "Failed to generate review" }, { status: 500 })
  }
}
