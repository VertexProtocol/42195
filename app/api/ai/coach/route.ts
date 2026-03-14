import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { classifyAthleteLevel, detectFatigue, type SafetyActivity } from "@/lib/training-safety"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const COACH_SYSTEM_PROMPT = `You are an expert running coach assistant embedded in a training app. You help runners with questions about their training, goals, pacing, recovery, and race preparation.

Key principles:
- Be concise and specific — runners want actionable advice, not essays
- Reference the runner's actual data when answering (use your tools to look it up)
- Be encouraging but honest about areas for improvement
- Prioritise safety — always flag injury risk or overtraining signals
- When you don't have enough data, say so rather than guessing

You have access to tools that fetch the runner's real training data. Use them when the question relates to their specific situation. Do not make up numbers — always fetch data first.`

// Tool definitions for the coach
const tools: Anthropic.Tool[] = [
  {
    name: "get_recent_activities",
    description: "Fetch the runner's recent activities. Returns distance, duration, pace, heart rate, and date for each run. Use this to answer questions about recent training, trends, or specific workouts.",
    input_schema: {
      type: "object" as const,
      properties: {
        days: {
          type: "number",
          description: "Number of days to look back. Default 30.",
        },
        limit: {
          type: "number",
          description: "Maximum number of activities to return. Default 20.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_weekly_summaries",
    description: "Fetch weekly training summaries showing total distance, run count, longest run, and average pace per week. Use this for volume trend analysis and training consistency questions.",
    input_schema: {
      type: "object" as const,
      properties: {
        weeks: {
          type: "number",
          description: "Number of weeks to look back. Default 8.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_goals",
    description: "Fetch the runner's active goals including race targets, dates, and distances. Use this to understand what the runner is training for.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_training_plan",
    description: "Fetch the current AI training plan for a specific goal, including weekly targets and session details. Use this when the runner asks about their plan or upcoming sessions.",
    input_schema: {
      type: "object" as const,
      properties: {
        goal_id: {
          type: "string",
          description: "The goal ID to fetch the plan for. If not provided, fetches plans for all active goals.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_personal_records",
    description: "Fetch the runner's personal records for standard distances (1K, 5K, 10K, Half Marathon, Marathon). Use this for pace-related questions or goal feasibility assessment.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_training_load",
    description: "Fetch the runner's current training load metrics: ACWR (injury risk), acute training load (fatigue), chronic training load (fitness), and training stress balance (form). Use this for recovery and fatigue questions.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_session_completions",
    description: "Fetch which planned training sessions the runner has completed, skipped, or not yet done for a specific goal. Use this to assess plan adherence.",
    input_schema: {
      type: "object" as const,
      properties: {
        goal_id: {
          type: "string",
          description: "The goal ID to check completions for.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_test_runs",
    description: "Fetch the runner's test run benchmarks — user-tagged high-effort runs used for fitness calibration. Returns estimated VO2max, threshold pace, threshold HR, and running efficiency. Use this for fitness assessment, pace recommendations, or training calibration questions.",
    input_schema: {
      type: "object" as const,
      properties: {
        test_type: {
          type: "string",
          description: "Optional filter: '5k_time_trial', '10k_time_trial', 'max_effort', 'threshold_test', or 'custom'.",
        },
      },
      required: [],
    },
  },
]

// Tool implementations
async function executeToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  userId: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string> {
  switch (toolName) {
    case "get_recent_activities": {
      const days = (toolInput.days as number) || 30
      const limit = (toolInput.limit as number) || 20
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - days)

      const { data } = await supabase
        .from("activities")
        .select("name, type, date, distance_km, duration_seconds, pace_min_per_km, avg_heart_rate, elevation_gain_m")
        .eq("user_id", userId)
        .gte("date", cutoff.toISOString())
        .order("date", { ascending: false })
        .limit(limit)

      if (!data || data.length === 0) return "No activities found in this period."
      return JSON.stringify(data.map((a) => ({
        ...a,
        pace: a.pace_min_per_km ? `${Math.floor(a.pace_min_per_km)}:${String(Math.round((a.pace_min_per_km % 1) * 60)).padStart(2, "0")} min/km` : null,
        duration: `${Math.floor(a.duration_seconds / 60)}min`,
      })))
    }

    case "get_weekly_summaries": {
      const weeks = (toolInput.weeks as number) || 8
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - weeks * 7)

      const { data } = await supabase
        .from("activities")
        .select("date, distance_km, duration_seconds, pace_min_per_km")
        .eq("user_id", userId)
        .gte("date", cutoff.toISOString())
        .order("date", { ascending: false })

      if (!data || data.length === 0) return "No activities found."

      // Group by ISO week
      const weekMap = new Map<string, { totalKm: number; count: number; longestKm: number; totalSec: number }>()
      for (const a of data) {
        const d = new Date(a.date)
        const day = d.getUTCDay()
        const diff = day === 0 ? -6 : 1 - day
        const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff))
        const key = monday.toISOString().split("T")[0]
        const existing = weekMap.get(key)
        const km = Number(a.distance_km)
        if (existing) {
          existing.totalKm += km
          existing.count++
          existing.totalSec += a.duration_seconds
          if (km > existing.longestKm) existing.longestKm = km
        } else {
          weekMap.set(key, { totalKm: km, count: 1, longestKm: km, totalSec: a.duration_seconds })
        }
      }

      const summaries = [...weekMap.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([week, s]) => ({
          week,
          totalKm: Math.round(s.totalKm * 10) / 10,
          runs: s.count,
          longestRunKm: Math.round(s.longestKm * 10) / 10,
          avgPace: s.totalKm > 0 ? `${Math.floor((s.totalSec / 60) / s.totalKm)}:${String(Math.round(((s.totalSec / 60) / s.totalKm % 1) * 60)).padStart(2, "0")} min/km` : null,
        }))

      return JSON.stringify(summaries)
    }

    case "get_goals": {
      const { data } = await supabase
        .from("goals")
        .select("id, name, goal_category, target_distance_km, target_date, start_date, target_time_seconds, is_active")
        .eq("user_id", userId)
        .eq("is_active", true)
        .order("target_date", { ascending: true })

      if (!data || data.length === 0) return "No active goals found."
      return JSON.stringify(data.map((g) => ({
        ...g,
        daysUntil: Math.ceil((new Date(g.target_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
      })))
    }

    case "get_training_plan": {
      const goalId = toolInput.goal_id as string | undefined

      if (goalId) {
        const { data } = await supabase
          .from("ai_training_plans")
          .select("plan, block_start_date, generated_at")
          .eq("goal_id", goalId)
          .eq("user_id", userId)
          .maybeSingle()

        if (!data) return "No training plan found for this goal."
        return JSON.stringify(data)
      }

      // Fetch plans for all active goals
      const { data: goals } = await supabase
        .from("goals")
        .select("id, name")
        .eq("user_id", userId)
        .eq("is_active", true)

      if (!goals || goals.length === 0) return "No active goals."

      const plans = []
      for (const g of goals) {
        const { data } = await supabase
          .from("ai_training_plans")
          .select("plan, block_start_date, generated_at")
          .eq("goal_id", g.id)
          .eq("user_id", userId)
          .maybeSingle()

        if (data) plans.push({ goalName: g.name, goalId: g.id, ...data })
      }

      return plans.length === 0 ? "No training plans generated yet." : JSON.stringify(plans)
    }

    case "get_personal_records": {
      const { data } = await supabase
        .from("activities")
        .select("date, distance_km, duration_seconds, pace_min_per_km, name")
        .eq("user_id", userId)
        .order("date", { ascending: false })
        .limit(500)

      if (!data || data.length === 0) return "No activities found."

      const prDistances = [
        { label: "1 km", km: 1 },
        { label: "5 km", km: 5 },
        { label: "10 km", km: 10 },
        { label: "Half Marathon", km: 21.0975 },
        { label: "Marathon", km: 42.195 },
      ]

      const records = []
      for (const { label, km } of prDistances) {
        const qualifying = data.filter(
          (a) => a.distance_km >= km * 0.95 && a.distance_km <= km * 1.05 && a.duration_seconds > 0,
        )
        if (qualifying.length === 0) continue

        let best = qualifying[0]
        let bestTime = (km / best.distance_km) * best.duration_seconds
        for (const a of qualifying) {
          const adjusted = (km / a.distance_km) * a.duration_seconds
          if (adjusted < bestTime) {
            best = a
            bestTime = adjusted
          }
        }

        const mins = Math.floor(bestTime / 60)
        const secs = Math.round(bestTime % 60)
        records.push({
          distance: label,
          time: `${mins}:${String(secs).padStart(2, "0")}`,
          pace: `${Math.floor(bestTime / 60 / km)}:${String(Math.round((bestTime / 60 / km % 1) * 60)).padStart(2, "0")} min/km`,
          date: best.date,
        })
      }

      return records.length === 0 ? "No qualifying runs for standard distances yet." : JSON.stringify(records)
    }

    case "get_training_load": {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - 42)

      const { data } = await supabase
        .from("activities")
        .select("date, distance_km")
        .eq("user_id", userId)
        .gte("date", cutoff.toISOString())
        .order("date", { ascending: false })

      if (!data || data.length === 0) return "No recent activities for load calculation."

      const now = Date.now()
      const day7 = now - 7 * 24 * 60 * 60 * 1000
      const day28 = now - 28 * 24 * 60 * 60 * 1000

      const acuteLoad = data
        .filter((a) => new Date(a.date).getTime() >= day7)
        .reduce((s, a) => s + Number(a.distance_km), 0)
      const chronicTotal = data
        .filter((a) => new Date(a.date).getTime() >= day28)
        .reduce((s, a) => s + Number(a.distance_km), 0)
      const chronicLoad = chronicTotal / 4
      const acwr = chronicLoad > 0 ? acuteLoad / chronicLoad : 0
      const risk = acwr > 1.5 ? "high" : acwr > 1.3 ? "moderate" : "low"

      // TSB-like estimate
      const day42Total = data.reduce((s, a) => s + Number(a.distance_km), 0)
      const fitness = day42Total / 6 // 6-week average
      const fatigue = acuteLoad // 7-day total
      const form = fitness - fatigue

      // Fetch extended data for fatigue detection and athlete level
      const { data: extendedData } = await supabase
        .from("activities")
        .select("date, distance_km, duration_seconds, pace_min_per_km, avg_heart_rate")
        .eq("user_id", userId)
        .gte("date", new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString())
        .order("date", { ascending: false })

      const safetyActivities: SafetyActivity[] = (extendedData ?? []).map((a) => ({
        date: a.date,
        distance_km: Number(a.distance_km),
        duration_seconds: a.duration_seconds,
        pace_min_per_km: a.pace_min_per_km ? Number(a.pace_min_per_km) : null,
        avg_heart_rate: a.avg_heart_rate ? Number(a.avg_heart_rate) : null,
      }))

      const fatigueResult = detectFatigue(safetyActivities)
      const athleteLevel = classifyAthleteLevel(safetyActivities)

      return JSON.stringify({
        acwr: { ratio: Math.round(acwr * 100) / 100, risk },
        weeklyKm: { last7days: Math.round(acuteLoad * 10) / 10, avg28days: Math.round(chronicLoad * 10) / 10 },
        fitness: Math.round(fitness * 10) / 10,
        fatigue: Math.round(fatigue * 10) / 10,
        form: Math.round(form * 10) / 10,
        interpretation: form > 5 ? "Fresh — good for hard sessions or racing" : form > -5 ? "Neutral — normal training load" : "Fatigued — consider easy days or rest",
        athleteLevel,
        fatigueSignals: fatigueResult.signal !== "none"
          ? { detected: true, signal: fatigueResult.signal, description: fatigueResult.description, intensityMultiplier: fatigueResult.intensityMultiplier }
          : { detected: false },
      })
    }

    case "get_session_completions": {
      const goalId = toolInput.goal_id as string
      if (!goalId) return "goal_id is required."

      const { data } = await supabase
        .from("session_completions")
        .select("session_key, status")
        .eq("goal_id", goalId)
        .eq("user_id", userId)

      if (!data || data.length === 0) return "No session completion data found."

      const completed = data.filter((r) => r.status === "completed").length
      const skipped = data.filter((r) => r.status === "skipped").length
      const total = data.length
      return JSON.stringify({
        total,
        completed,
        skipped,
        planned: total - completed - skipped,
        adherence: total > 0 ? `${Math.round((completed / total) * 100)}%` : "N/A",
        details: data,
      })
    }

    case "get_test_runs": {
      const testType = toolInput.test_type as string | undefined

      let query = supabase
        .from("test_runs")
        .select("test_type, distance_km, time_seconds, avg_pace, avg_hr, max_hr, derived_metrics, created_at, notes")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20)

      if (testType) {
        query = query.eq("test_type", testType)
      }

      const { data } = await query

      if (!data || data.length === 0) return "No test runs found. The runner has not tagged any activities as benchmark/test runs yet."

      return JSON.stringify(data.map((tr) => ({
        type: tr.test_type,
        date: tr.created_at.split("T")[0],
        distance_km: Number(tr.distance_km).toFixed(1),
        time_minutes: Math.round(tr.time_seconds / 60),
        avg_pace: tr.avg_pace ? `${Math.floor(Number(tr.avg_pace))}:${String(Math.round((Number(tr.avg_pace) % 1) * 60)).padStart(2, "0")} min/km` : null,
        avg_hr: tr.avg_hr,
        max_hr: tr.max_hr,
        derived_metrics: tr.derived_metrics,
        notes: tr.notes,
      })))
    }

    default:
      return `Unknown tool: ${toolName}`
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let messages: Anthropic.MessageParam[]
  try {
    const body = await req.json()
    messages = body.messages
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages array is required" }, { status: 400 })
  }

  // Limit conversation length to prevent abuse
  if (messages.length > 20) {
    return NextResponse.json({ error: "Conversation too long. Please start a new chat." }, { status: 400 })
  }

  const encoder = new TextEncoder()

  const readable = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        // Tool-calling loop: keep calling Claude until it produces a final text response
        let currentMessages = [...messages]
        let iterations = 0
        const maxIterations = 5

        while (iterations < maxIterations) {
          iterations++

          const response = await anthropic.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 2048,
            system: [
              {
                type: "text" as const,
                text: COACH_SYSTEM_PROMPT,
                cache_control: { type: "ephemeral" as const },
              },
            ],
            tools,
            messages: currentMessages,
          })

          // Check if there are tool uses
          const toolUses = response.content.filter(
            (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
          )

          if (toolUses.length > 0) {
            // Execute tools and build tool results
            send({ status: "thinking", detail: `Looking up your ${toolUses.map((t) => t.name.replace(/_/g, " ").replace("get ", "")).join(", ")}…` })

            const toolResults: Anthropic.ToolResultBlockParam[] = []
            for (const toolUse of toolUses) {
              const result = await executeToolCall(
                toolUse.name,
                toolUse.input as Record<string, unknown>,
                user.id,
                supabase,
              )
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: result,
              })
            }

            // Add assistant message and tool results to continue the conversation
            currentMessages = [
              ...currentMessages,
              { role: "assistant", content: response.content },
              { role: "user", content: toolResults },
            ]
          } else {
            // Final text response — extract and send it
            const textBlock = response.content.find(
              (block): block is Anthropic.TextBlock => block.type === "text",
            )
            const text = textBlock?.text ?? "I couldn't generate a response. Please try again."
            send({ status: "done", text })
            break
          }
        }

        if (iterations >= maxIterations) {
          send({ status: "done", text: "I needed too many steps to answer that. Could you try a simpler question?" })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error("Coach API error:", msg)
        send({ status: "error", error: `Failed to get response: ${msg}` })
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
