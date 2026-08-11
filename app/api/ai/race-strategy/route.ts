import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { anthropic } from "@/lib/anthropic"
import { createClient } from "@/lib/supabase/server"
import { checkAiRateLimit, rateLimitExceededResponse } from "@/lib/ai-rate-limit"
import { hasActiveInjury, type NoteHistoryEntry } from "@/lib/notes-history"
import { assessComeback } from "@/lib/training-comeback"
import { logAiUsage } from "@/lib/ai-usage"

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

/**
 * JSON Schema mirror of RaceStrategySchema, for structured outputs.
 *
 * Hand-maintained rather than derived. The SDK ships zodOutputFormat(), which
 * would generate this, but it calls z.toJSONSchema() — a zod v4 API, and this
 * project is on zod 3. Upgrading zod is the change that deletes this constant
 * and its siblings in the other AI routes.
 *
 * The `.min(1)` constraints from the zod schema are deliberately absent:
 * structured outputs does not support length constraints. Zod still enforces
 * them when the response is validated below.
 */
const RACE_STRATEGY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["targetTime", "pacingStrategy", "preRace", "nutrition", "mentalStrategy", "keyReminders"],
  properties: {
    targetTime: { type: "string", description: "Predicted finish time based on training, e.g. 3:45:00" },
    pacingStrategy: {
      type: "object",
      additionalProperties: false,
      required: ["overall", "segments"],
      properties: {
        overall: { type: "string", description: "Target pace per km, e.g. 5:20 min/km" },
        segments: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "pace", "notes"],
            properties: {
              name: { type: "string", description: "Segment name, e.g. First 5 km" },
              pace: { type: "string" },
              notes: { type: "string", description: "Specific instructions for this segment" },
            },
          },
        },
      },
    },
    preRace: {
      type: "object",
      additionalProperties: false,
      required: ["week", "dayBefore", "morning"],
      properties: {
        week: { type: "string", description: "What to do in the final week" },
        dayBefore: { type: "string" },
        morning: { type: "string", description: "Race morning routine" },
      },
    },
    nutrition: {
      type: "object",
      additionalProperties: false,
      required: ["before", "during", "hydration"],
      properties: {
        before: { type: "string" },
        during: { type: "string", description: "During-race fuelling plan" },
        hydration: { type: "string" },
      },
    },
    mentalStrategy: { type: "string", description: "1-2 sentences on mental approach" },
    keyReminders: { type: "array", items: { type: "string" }, description: "3-5 concise race-day reminders" },
  },
} as const

const STRATEGY_SYSTEM_PROMPT = `You are an expert running coach creating a race-day strategy. Based on the runner's training data, goal and fitness level, write a pacing and preparation plan for the day.

Break the race into segments that suit the distance — a 10K wants a different breakdown than a marathon. Pace targets, fuelling and the mental approach should all follow from what this runner has actually been doing in training.

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

  // Runner-state context — active injury + comeback status. Without this,
  // Claude's strategy assumed a healthy, fully-trained runner and could
  // prescribe race-pace work on top of an active injury or a fresh return.
  const { data: prefsRow } = await supabase
    .from("goal_preferences")
    .select("notes_history")
    .eq("goal_id", goalId)
    .eq("user_id", user.id)
    .maybeSingle()

  const notesHistory = (prefsRow?.notes_history as NoteHistoryEntry[] | null) ?? []
  const activeInjury = hasActiveInjury(notesHistory)
  const comeback = assessComeback(
    acts.map((a) => ({ date: a.date, distance_km: Number(a.distance_km) })),
    activeInjury,
  )

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

  const runnerStateLines: string[] = []
  runnerStateLines.push(
    `- Active injury: ${activeInjury ? "YES — bias the strategy toward conservative pacing and cap mid-race intensity" : "no"}`,
  )
  if (comeback.needsRamp) {
    runnerStateLines.push(
      `- Return-from-pause: ${comeback.pauseDays}-day gap since last run (${comeback.category}). Treat target paces as ceilings, not goals, and include explicit fallback cues if HR drifts early.`,
    )
  }

  const prompt = `Create a race-day strategy for this runner:

RACE: ${goal.name} (${goal.target_distance_km} km)
DATE: ${goal.target_date} (${daysUntilRace} days away)${targetTimeStr ? `\nTARGET TIME: ${targetTimeStr}` : ""}${riegelPrediction ? `\nPREDICTED TIME (Riegel): ${riegelPrediction}` : ""}

RUNNER STATE:
${runnerStateLines.join("\n")}

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
          model: "claude-opus-5",
          // Thinking counts against max_tokens, so this ceiling covers reasoning
          // plus the strategy itself. 3000 was sized for the strategy alone.
          max_tokens: 16000,
          thinking: { type: "adaptive" },
          output_config: {
            effort: "high",
            format: {
              type: "json_schema" as const,
              schema: RACE_STRATEGY_JSON_SCHEMA,
            },
          },
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
        logAiUsage("race-strategy", message.usage, { goalId })

        if (message.stop_reason === "max_tokens") {
          throw new Error("Response hit the output token limit before the strategy was complete")
        }

        const textBlock = message.content.find((b: { type: string }) => b.type === "text")
        if (!textBlock || textBlock.type !== "text") throw new Error("No text block")

        const rawText = (textBlock as { type: "text"; text: string }).text
        // Structured outputs guarantees the response matches the schema, so zod
        // is a type guard here rather than the parse-and-hope it replaced.
        const strategyResult = RaceStrategySchema.safeParse(JSON.parse(rawText))
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
