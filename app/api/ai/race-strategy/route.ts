import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { anthropic } from "@/lib/anthropic"
import { createClient } from "@/lib/supabase/server"
import { checkAiRateLimit, rateLimitExceededResponse } from "@/lib/ai-rate-limit"

const RUN_TYPES = ["Run", "Trail Run", "Virtual Run", "Treadmill", "Race"]

/** Race-strategy JSON shape Claude is asked to return. */
const RaceStrategySchema = z.object({
  targetTime: z.string().min(1),
  pacingStrategy: z.object({
    overall: z.string().min(1),
    segments: z.array(
      z.object({
        name: z.string().min(1),
        pace: z.string().min(1),
        notes: z.string().min(1),
      }),
    ),
  }),
  preRace: z.object({
    week: z.string().min(1),
    dayBefore: z.string().min(1),
    morning: z.string().min(1),
  }),
  nutrition: z.object({
    before: z.string().min(1),
    during: z.string().min(1),
    hydration: z.string().min(1),
  }),
  mentalStrategy: z.string().min(1),
  keyReminders: z.array(z.string().min(1)).min(1),
})

const STRATEGY_SYSTEM_PROMPT = `You are an expert running coach creating a race-day strategy. Based on the runner's training data, goal, and fitness level, create a detailed pacing and preparation plan.

Respond with ONLY a valid JSON object:
{
  "targetTime": "predicted finish time based on training (e.g. '3:45:00')",
  "pacingStrategy": {
    "overall": "target pace per km (e.g. '5:20 min/km')",
    "segments": [
      {
        "name": "segment name (e.g. 'First 5km', 'Middle 10-30km', 'Final 5km')",
        "pace": "target pace",
        "notes": "specific instructions"
      }
    ]
  },
  "preRace": {
    "week": "what to do in the final week",
    "dayBefore": "day-before instructions",
    "morning": "race morning routine"
  },
  "nutrition": {
    "before": "pre-race nutrition",
    "during": "during-race fueling plan",
    "hydration": "hydration strategy"
  },
  "mentalStrategy": "1-2 sentences on mental approach",
  "keyReminders": ["3-5 concise race-day reminders"]
}

Be specific to the runner's actual fitness level and race distance. Do not suggest paces faster than their training supports.`

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

  // Fetch goal
  const { data: goal } = await supabase
    .from("goals")
    .select("name, target_distance_km, target_date, target_time_seconds")
    .eq("id", goalId)
    .eq("user_id", user.id)
    .single()

  if (!goal) return NextResponse.json({ error: "Goal not found" }, { status: 404 })

  // Fetch recent activities (last 8 weeks)
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 56)

  // Race strategy is running-only — cycling/hiking pace would corrupt the
  // avgPace/longestRun stats passed to Claude and produce hallucinated
  // target times.
  const { data: activities } = await supabase
    .from("activities")
    .select("name, type, date, distance_km, duration_seconds, pace_min_per_km, avg_heart_rate")
    .eq("user_id", user.id)
    .in("type", RUN_TYPES)
    .gte("date", cutoff.toISOString())
    .order("date", { ascending: false })
    .limit(100)

  const acts = activities ?? []
  const totalRuns = acts.length
  const avgPace = acts.filter((a) => a.pace_min_per_km).length > 0
    ? acts.filter((a) => a.pace_min_per_km).reduce((s, a) => s + Number(a.pace_min_per_km), 0) / acts.filter((a) => a.pace_min_per_km).length
    : null
  const bestPace = acts.filter((a) => a.pace_min_per_km).length > 0
    ? Math.min(...acts.filter((a) => a.pace_min_per_km).map((a) => Number(a.pace_min_per_km)))
    : null
  const longestRun = acts.length > 0
    ? Math.max(...acts.map((a) => Number(a.distance_km)))
    : 0
  const avgWeeklyKm = acts.reduce((s, a) => s + Number(a.distance_km), 0) / 8

  // Fetch current plan if exists
  const { data: planRow } = await supabase
    .from("ai_training_plans")
    .select("plan")
    .eq("goal_id", goalId)
    .eq("user_id", user.id)
    .maybeSingle()

  const formatPace = (minPerKm: number) => {
    const min = Math.floor(minPerKm)
    const sec = Math.round((minPerKm - min) * 60)
    return `${min}:${String(sec).padStart(2, "0")} min/km`
  }

  const daysUntilRace = Math.ceil((new Date(goal.target_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))

  const targetTimeStr = goal.target_time_seconds
    ? `${Math.floor(goal.target_time_seconds / 3600)}:${String(Math.floor((goal.target_time_seconds % 3600) / 60)).padStart(2, "0")}:${String(goal.target_time_seconds % 60).padStart(2, "0")}`
    : null

  // Riegel-based prediction from best recent run
  let riegelPrediction: string | null = null
  const recentBest = acts.filter((a) => a.distance_km >= 3 && a.duration_seconds > 0).sort((a, b) => {
    const equivA = (5 / a.distance_km) ** 1.06 * a.duration_seconds
    const equivB = (5 / b.distance_km) ** 1.06 * b.duration_seconds
    return equivA - equivB
  })[0]

  if (recentBest) {
    const predictedSeconds = recentBest.duration_seconds * (goal.target_distance_km / recentBest.distance_km) ** 1.06
    const hrs = Math.floor(predictedSeconds / 3600)
    const mins = Math.floor((predictedSeconds % 3600) / 60)
    const secs = Math.round(predictedSeconds % 60)
    riegelPrediction = `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
  }

  const prompt = `Create a race-day strategy for this runner:

RACE: ${goal.name} (${goal.target_distance_km} km)
DATE: ${goal.target_date} (${daysUntilRace} days away)${targetTimeStr ? `\nTARGET TIME: ${targetTimeStr}` : ""}${riegelPrediction ? `\nPREDICTED TIME (Riegel): ${riegelPrediction}` : ""}

TRAINING (last 8 weeks):
- ${totalRuns} runs, avg ${avgWeeklyKm.toFixed(1)} km/week
- Longest run: ${longestRun.toFixed(1)} km${avgPace ? `\n- Average pace: ${formatPace(avgPace)}` : ""}${bestPace ? `\n- Best pace: ${formatPace(bestPace)}` : ""}

${planRow?.plan ? `CURRENT PLAN SUMMARY: ${(planRow.plan as { summary: string }).summary}` : "No structured training plan."}`

  const encoder = new TextEncoder()

  const readable = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        send({ status: "thinking" })

        const stream = anthropic.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 3000,
          thinking: { type: "enabled", budget_tokens: 1500 },
          system: [
            {
              type: "text" as const,
              text: STRATEGY_SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" as const },
            },
          ],
          messages: [{ role: "user", content: prompt }],
        })

        let sentGenerating = false
        stream.on("text", () => {
          if (!sentGenerating) {
            sentGenerating = true
            send({ status: "generating" })
          }
        })

        const message = await stream.finalMessage()
        const textBlock = message.content.find((b: { type: string }) => b.type === "text")
        if (!textBlock || textBlock.type !== "text") throw new Error("No text block")

        const rawText = (textBlock as { type: "text"; text: string }).text
        const jsonMatch = rawText.match(/\{[\s\S]*\}/)
        if (!jsonMatch) throw new Error("No JSON found in response")

        let parsed: unknown
        try {
          parsed = JSON.parse(jsonMatch[0])
        } catch {
          console.error("[race-strategy] Claude returned invalid JSON:", rawText.slice(0, 500))
          throw new Error("Response was not valid JSON")
        }

        const strategyResult = RaceStrategySchema.safeParse(parsed)
        if (!strategyResult.success) {
          console.error(
            "[race-strategy] Response failed schema validation:",
            strategyResult.error.issues,
            "raw:",
            rawText.slice(0, 500),
          )
          throw new Error("Response missing required fields")
        }

        send({ status: "done", strategy: strategyResult.data })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error("Race strategy error:", msg)
        send({ status: "error", error: `Failed to generate strategy: ${msg}` })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
