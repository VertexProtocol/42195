import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { anthropic } from "@/lib/anthropic"
import { createClient } from "@/lib/supabase/server"
import { checkAiRateLimit, rateLimitExceededResponse } from "@/lib/ai-rate-limit"
import { logAiUsage } from "@/lib/ai-usage"

const RUN_TYPES = ["Run", "Trail Run", "Virtual Run", "Treadmill", "Race"]

/**
 * Shape Claude must return. We validate via safeParse so an out-of-range
 * confidence, a typo'd recommendation, or a missing reason produces a 502
 * rather than a silent frontend crash on `check.recommendation`.
 */
const PlanCheckResponseSchema = z.object({
  recommendation: z.enum(["keep", "adjust", "regenerate"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  adjustments: z.array(z.string()).optional().default([]),
})

/**
 * Adaptive plan check — analyzes whether the current plan needs adjustment.
 *
 * Called periodically (e.g. end of week) or on-demand. Compares actual training
 * against the plan and returns a recommendation: keep, adjust, or regenerate.
 */

/**
 * JSON Schema mirror of PlanCheckResponseSchema, for structured outputs.
 * Hand-maintained: the SDK's zodOutputFormat() needs zod v4 and this project
 * is on zod 3. The 0-1 bound on confidence is absent because structured
 * outputs does not support numeric constraints — zod still enforces it below.
 */
const PLAN_CHECK_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["recommendation", "confidence", "reason", "adjustments"],
  properties: {
    recommendation: { type: "string", enum: ["keep", "adjust", "regenerate"] },
    confidence: { type: "number", description: "How sure you are, from 0 to 1" },
    reason: { type: "string", description: "1-2 sentences explaining the recommendation" },
    adjustments: {
      type: "array",
      items: { type: "string" },
      description: "Specific changes when recommending 'adjust'; empty otherwise",
    },
  },
} as const

const CHECK_SYSTEM_PROMPT = `You are a running coach evaluating whether a training plan needs adjustment. Analyse the runner's actual training against their plan.

Guidelines:
- "keep": Plan is on track (within 20% of targets), no changes needed
- "adjust": Minor deviations — suggest specific tweaks for upcoming weeks
- "regenerate": Major deviations (>40% off targets, missed multiple weeks, significant fitness change) — full replanning needed

Be conservative — only recommend changes when clearly warranted.`

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const rateLimit = await checkAiRateLimit(user.id)
  if (!rateLimit.allowed) return rateLimitExceededResponse(rateLimit)

  let goalId: string
  try {
    const body = await req.json()
    goalId = body.goalId
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  if (!goalId) return NextResponse.json({ error: "goalId is required" }, { status: 400 })

  // Fetch plan
  const { data: planRow } = await supabase
    .from("ai_training_plans")
    .select("plan, block_start_date, generated_at")
    .eq("goal_id", goalId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!planRow?.plan) {
    return NextResponse.json({ error: "No training plan found" }, { status: 404 })
  }

  const plan = planRow.plan as {
    summary: string
    weeks: Array<{
      weekNumber: number
      theme: string
      targetKm: number
      sessions: Array<{ type: string; distance: string }>
    }>
  }

  // Fetch goal
  const { data: goal } = await supabase
    .from("goals")
    .select("name, target_distance_km, target_date")
    .eq("id", goalId)
    .eq("user_id", user.id)
    .single()

  if (!goal) return NextResponse.json({ error: "Goal not found" }, { status: 404 })

  // Calculate which week we're in
  const blockStart = new Date(planRow.block_start_date)
  const dayOfBlock = Math.floor((Date.now() - blockStart.getTime()) / (1000 * 60 * 60 * 24))
  const currentWeekIndex = Math.floor(dayOfBlock / 7)

  // Fetch running activities since block start. Cycling/hiking would inflate
  // the ACWR computed downstream and produce false "regenerate" recommendations.
  const { data: activities } = await supabase
    .from("activities")
    .select("date, distance_km, duration_seconds, pace_min_per_km, avg_heart_rate")
    .eq("user_id", user.id)
    .in("type", RUN_TYPES)
    .gte("date", blockStart.toISOString())
    .order("date", { ascending: true })

  // Compute actual vs planned for each completed week
  const weekComparisons = []
  for (let i = 0; i <= Math.min(currentWeekIndex, plan.weeks.length - 1); i++) {
    const weekStart = new Date(blockStart)
    weekStart.setDate(weekStart.getDate() + i * 7)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 7)

    const weekActs = (activities ?? []).filter((a) => {
      const d = new Date(a.date)
      return d >= weekStart && d < weekEnd
    })

    const actualKm = weekActs.reduce((s, a) => s + Number(a.distance_km), 0)
    const actualRuns = weekActs.length
    const plannedWeek = plan.weeks[i]
    const deviation = plannedWeek.targetKm > 0
      ? Math.round(((actualKm - plannedWeek.targetKm) / plannedWeek.targetKm) * 100)
      : 0

    weekComparisons.push({
      week: i + 1,
      planned: plannedWeek.targetKm,
      actual: Math.round(actualKm * 10) / 10,
      deviation: `${deviation > 0 ? "+" : ""}${deviation}%`,
      runs: `${actualRuns}/${plannedWeek.sessions.length}`,
      avgHr: weekActs.filter((a) => a.avg_heart_rate).length > 0
        ? Math.round(weekActs.filter((a) => a.avg_heart_rate).reduce((s, a) => s + Number(a.avg_heart_rate), 0) / weekActs.filter((a) => a.avg_heart_rate).length)
        : null,
    })
  }

  // ACWR
  const now = Date.now()
  const day7 = now - 7 * 24 * 60 * 60 * 1000
  const day28 = now - 28 * 24 * 60 * 60 * 1000
  const allActs = activities ?? []
  const acute = allActs.filter((a) => new Date(a.date).getTime() >= day7).reduce((s, a) => s + Number(a.distance_km), 0)
  const chronic = allActs.filter((a) => new Date(a.date).getTime() >= day28).reduce((s, a) => s + Number(a.distance_km), 0) / 4
  const acwr = chronic > 0 ? (acute / chronic).toFixed(2) : "N/A"

  const daysUntilRace = Math.ceil((new Date(goal.target_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))

  const prompt = `Evaluate this training plan's status:

GOAL: ${goal.name} (${goal.target_distance_km} km) — ${daysUntilRace} days away
PLAN: ${plan.weeks.length}-week block, generated ${planRow.generated_at?.split("T")[0]}
CURRENT: Week ${currentWeekIndex + 1} of ${plan.weeks.length}

WEEKLY COMPARISON (planned vs actual):
${weekComparisons.map((w) => `  Week ${w.week}: ${w.actual} km / ${w.planned} km (${w.deviation}), ${w.runs} sessions${w.avgHr ? `, avg HR ${w.avgHr}` : ""}`).join("\n")}

ACWR (injury risk): ${acwr}
REMAINING WEEKS: ${plan.weeks.length - currentWeekIndex - 1}

Should this plan be kept as-is, adjusted, or fully regenerated?`

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      // Safety-adjacent decision (keep/adjust/regenerate) — determinism matters
      // more than creative variation. Same state should yield same recommendation.
      temperature: 0,
      max_tokens: 1500,
      output_config: {
        format: { type: "json_schema" as const, schema: PLAN_CHECK_JSON_SCHEMA },
      },
      // No cache_control: measured at 412 tokens including the output schema,
      // against Haiku 4.5's 4096-token minimum cacheable prefix. Below the
      // minimum the API caches nothing and says nothing, so a breakpoint here
      // reads as an optimisation while doing exactly zero.
      // See scripts/smoke/smoke.mjs tokens.
      system: [
        {
          type: "text" as const,
          text: CHECK_SYSTEM_PROMPT,
        },
      ],
      messages: [{ role: "user", content: prompt }],
    })

    logAiUsage("plan-check", response.usage, { goalId })

    const textBlock = response.content.find((b) => b.type === "text")
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json({ error: "No response" }, { status: 500 })
    }

    // Structured outputs guarantees valid JSON matching the schema; zod is the
    // type guard, not the parser-of-last-resort it used to be.
    const checkResult = PlanCheckResponseSchema.safeParse(JSON.parse(textBlock.text))
    if (!checkResult.success) {
      console.error(
        "[plan-check] Claude returned malformed plan check:",
        checkResult.error.issues,
        "raw:",
        textBlock.text.slice(0, 500),
      )
      return NextResponse.json({ error: "Response failed validation" }, { status: 502 })
    }

    return NextResponse.json({
      check: checkResult.data,
      context: {
        currentWeek: currentWeekIndex + 1,
        totalWeeks: plan.weeks.length,
        daysUntilRace,
        weekComparisons,
      },
    })
  } catch (err) {
    console.error("Plan check error:", err)
    return NextResponse.json({ error: "Failed to check plan" }, { status: 500 })
  }
}
