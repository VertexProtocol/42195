import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import type { GoalPreferences, TrainingPlan } from "@/lib/types"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface WeeklySummary {
  weekLabel: string
  totalKm: number
  runCount: number
  longestKm: number
  avgPaceMinPerKm: number | null
}

function groupActivitiesByWeek(
  activities: Array<{
    date: string
    distance_km: number
    duration_seconds: number
    pace_min_per_km: number | null
  }>
): WeeklySummary[] {
  const weeks = new Map<string, WeeklySummary>()

  for (const a of activities) {
    const d = new Date(a.date)
    // Get Monday of this week
    const day = d.getDay()
    const diff = day === 0 ? -6 : 1 - day
    const monday = new Date(d)
    monday.setDate(d.getDate() + diff)
    const key = monday.toISOString().split("T")[0]

    const existing = weeks.get(key)
    const km = Number(a.distance_km)

    if (existing) {
      existing.totalKm += km
      existing.runCount += 1
      if (km > existing.longestKm) existing.longestKm = km
    } else {
      weeks.set(key, {
        weekLabel: key,
        totalKm: km,
        runCount: 1,
        longestKm: km,
        avgPaceMinPerKm: a.pace_min_per_km ? Number(a.pace_min_per_km) : null,
      })
    }
  }

  // Sort most recent first, return last 12 weeks
  return [...weeks.values()]
    .sort((a, b) => b.weekLabel.localeCompare(a.weekLabel))
    .slice(0, 12)
}

function formatPace(minPerKm: number | null): string {
  if (!minPerKm) return "unknown"
  const min = Math.floor(minPerKm)
  const sec = Math.round((minPerKm - min) * 60)
  return `${min}:${String(sec).padStart(2, "0")} min/km`
}

function calcWeekTargets(avgWeeklyKm: number): [number, number, number, number] {
  const base = avgWeeklyKm > 0 ? avgWeeklyKm : 20
  const w1 = Math.round(base * 1.1)
  const w2 = Math.round(w1 * 1.1)
  const w3 = Math.round(w2 * 1.1)
  const w4 = Math.round(w3 * 0.8)
  return [w1, w2, w3, w4]
}

function buildPrompt(
  goal: {
    name: string
    target_distance_km: number
    target_date: string
    start_date: string | null
    created_at: string
  },
  prefs: GoalPreferences,
  weeklySummaries: WeeklySummary[],
  longestRecentRun: number,
  currentAvgWeeklyKm: number,
  daysUntilRace: number,
  adjustNote: string | null
): string {
  const focusDescription = {
    volume: "hitting weekly km targets — sessions are flexible, no fixed structure required",
    workouts: "structured sessions (long run, tempo, easy runs with clear purpose)",
    balanced: "a mix of structured sessions and flexible volume targets",
  }[prefs.focus]

  const weekSummaryText = weeklySummaries.length === 0
    ? "No recent activity data available."
    : weeklySummaries
        .map(
          (w, i) =>
            `  Week -${i + 1} (${w.weekLabel}): ${w.runCount} run${w.runCount !== 1 ? "s" : ""}, ${w.totalKm.toFixed(1)} km total, longest: ${w.longestKm.toFixed(1)} km${w.avgPaceMinPerKm ? `, avg pace: ${formatPace(w.avgPaceMinPerKm)}` : ""}`
        )
        .join("\n")

  const adjustSection = adjustNote
    ? `\n## Adjustment Request\nThe runner wants to adjust the plan with this note:\n"${adjustNote}"\nPlease take this into account when generating the new plan.\n`
    : ""

  const [w1, w2, w3, w4] = calcWeekTargets(currentAvgWeeklyKm)

  return `You are an expert running coach creating a personalised 4-week training block for a runner preparing for an upcoming race.

## The Runner's Goal
- Race: ${goal.name} (${goal.target_distance_km} km)
- Race date: ${goal.target_date} (${daysUntilRace} days away)
- Training start: ${goal.start_date ?? goal.created_at.split("T")[0]}

## Runner's Preferences
- Sessions per week: ${prefs.sessions_per_week}
- Focus: ${focusDescription}
- Notes: ${prefs.notes ? `"${prefs.notes}"` : "None provided"}
${adjustSection}
## Recent Training History (most recent first)
${weekSummaryText}

## Current Fitness Snapshot
- Avg weekly km (last 4 weeks): ${currentAvgWeeklyKm.toFixed(1)} km
- Longest recent run: ${longestRecentRun.toFixed(1)} km

## Weekly Volume Targets (use these exact numbers — pre-calculated at 10% progressive overload)
- Week 1: ${w1} km
- Week 2: ${w2} km
- Week 3: ${w3} km (peak week)
- Week 4: ${w4} km (recovery — 80% of week 3)
The targetKm field for each week MUST match these numbers exactly.

## Your Task
Generate a 4-week training block starting from today. The block should:
- Use the exact weekly volume targets listed above
- Match the runner's stated preferences (sessions/week and focus)
- NOT assign sessions to specific days — just describe what sessions to do each week
- Be appropriate for ${daysUntilRace} days out from race day

IMPORTANT: Do not specify which day of the week to run. Sessions should be described as "do these runs this week, on days that suit you."

Respond with ONLY a valid JSON object — no explanation text before or after. Use this exact structure:
{
  "summary": "2-3 sentence overview of this training block and its purpose, personalised to the runner",
  "weeks": [
    {
      "weekNumber": 1,
      "theme": "short phrase describing this week's focus",
      "targetKm": 40,
      "sessions": [
        {
          "type": "Long run",
          "distance": "18 km",
          "effort": "Easy — conversational pace, you should be able to hold a full conversation",
          "purpose": "Build endurance base"
        }
      ],
      "coachNote": "Optional specific tip or warning for this week, or null"
    }
  ],
  "keyPrinciples": ["3-4 short training principles specific to this runner and block"],
  "watchOut": "One specific thing to watch out for based on this runner's history, or null"
}`
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let goalId: string
  let adjustNote: string | null = null

  try {
    const body = await req.json()
    goalId = body.goalId
    adjustNote = body.adjustNote ?? null
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  if (!goalId) {
    return NextResponse.json({ error: "goalId is required" }, { status: 400 })
  }

  // Fetch goal (verify ownership)
  const { data: goal, error: goalError } = await supabase
    .from("goals")
    .select("*")
    .eq("id", goalId)
    .eq("user_id", user.id)
    .single()

  if (goalError || !goal) {
    return NextResponse.json({ error: "Goal not found" }, { status: 404 })
  }

  // Fetch preferences (may not exist yet — use defaults)
  const { data: prefsRow } = await supabase
    .from("goal_preferences")
    .select("*")
    .eq("goal_id", goalId)
    .maybeSingle()

  const prefs: GoalPreferences = {
    goal_id: goalId,
    sessions_per_week: prefsRow?.sessions_per_week ?? 3,
    focus: prefsRow?.focus ?? "balanced",
    notes: prefsRow?.notes ?? null,
  }

  // Fetch last 12 weeks of activities
  const twelveWeeksAgo = new Date()
  twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 84)

  const { data: activities } = await supabase
    .from("activities")
    .select("date, distance_km, duration_seconds, pace_min_per_km")
    .eq("user_id", user.id)
    .gte("date", twelveWeeksAgo.toISOString())
    .order("date", { ascending: false })

  const weeklySummaries = groupActivitiesByWeek(activities ?? [])

  // Compute derived metrics
  const recent4Weeks = weeklySummaries.slice(0, 4)
  const currentAvgWeeklyKm =
    recent4Weeks.length > 0
      ? recent4Weeks.reduce((s, w) => s + w.totalKm, 0) / recent4Weeks.length
      : 0

  const longestRecentRun =
    weeklySummaries.reduce((max, w) => Math.max(max, w.longestKm), 0)

  const daysUntilRace = Math.ceil(
    (new Date(goal.target_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  )

  const prompt = buildPrompt(
    goal,
    prefs,
    weeklySummaries,
    longestRecentRun,
    currentAvgWeeklyKm,
    daysUntilRace,
    adjustNote
  )

  // Call Claude
  let plan: TrainingPlan
  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    })

    const content = message.content[0]
    if (content.type !== "text") throw new Error("Unexpected response type from Claude")

    // Extract JSON — Claude sometimes wraps in markdown code fences
    const jsonMatch = content.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error("No JSON found in Claude response")

    plan = JSON.parse(jsonMatch[0]) as TrainingPlan
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("Claude API error:", message, err)
    return NextResponse.json(
      { error: `Failed to generate training plan: ${message}` },
      { status: 500 }
    )
  }

  // Cache in DB (upsert — one active plan per goal)
  const blockStartDate = new Date().toISOString().split("T")[0]

  const { error: upsertError } = await supabase
    .from("ai_training_plans")
    .upsert(
      {
        goal_id: goalId,
        user_id: user.id,
        plan,
        block_start_date: blockStartDate,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "goal_id" }
    )

  if (upsertError) {
    console.error("Failed to cache training plan:", upsertError)
    // Still return the plan even if caching fails
  }

  return NextResponse.json({
    plan,
    block_start_date: blockStartDate,
    generated_at: new Date().toISOString(),
  })
}

// GET — load existing cached plan for a goal
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const goalId = req.nextUrl.searchParams.get("goalId")
  if (!goalId) return NextResponse.json({ error: "goalId is required" }, { status: 400 })

  const { data: planRow } = await supabase
    .from("ai_training_plans")
    .select("plan, block_start_date, generated_at")
    .eq("goal_id", goalId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!planRow) return NextResponse.json({ plan: null })

  return NextResponse.json({
    plan: planRow.plan,
    block_start_date: planRow.block_start_date,
    generated_at: planRow.generated_at,
  })
}

// PUT — save/update preferences for a goal
export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const { goalId, sessions_per_week, focus, notes } = body

  if (!goalId) return NextResponse.json({ error: "goalId is required" }, { status: 400 })

  const { error } = await supabase.from("goal_preferences").upsert(
    {
      goal_id: goalId,
      user_id: user.id,
      sessions_per_week,
      focus,
      notes: notes || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "goal_id" }
  )

  if (error) {
    return NextResponse.json({ error: "Failed to save preferences" }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
