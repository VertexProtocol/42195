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

function calcWeekTargets(avgWeeklyKm: number, pct: number, blockWeeks: number): number[] {
  const base = avgWeeklyKm > 0 ? avgWeeklyKm : 20
  const multiplier = 1 + pct / 100
  const targets: number[] = []
  // Keep full float precision internally so rounding doesn't compound across weeks.
  // Only round when writing to the output array.
  let current = base
  for (let i = 0; i < blockWeeks - 1; i++) {
    current = current * multiplier
    targets.push(Math.round(current))
  }
  // Last week is always recovery at 80% of peak
  targets.push(Math.round(current * 0.8))
  return targets
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

  const blockWeeks = prefs.block_weeks ?? 4
  const increasePct = prefs.weekly_increase_pct ?? 10
  const recentWindow = prefs.regenerate_every_weeks ?? 4
  const weekTargets = calcWeekTargets(currentAvgWeeklyKm, increasePct, blockWeeks)
  const weekTargetLines = weekTargets
    .map((km, i) =>
      i === blockWeeks - 1
        ? `- Week ${i + 1}: ${km} km (recovery — ~80% of previous week)`
        : `- Week ${i + 1}: ${km} km${i === blockWeeks - 2 ? " (peak week)" : ""}`
    )
    .join("\n")

  // Compute volume trend: compare recent window vs the equal-length prior window
  const priorWeeks = weeklySummaries.slice(recentWindow, recentWindow * 2)
  let trendLine: string
  if (priorWeeks.length === 0) {
    trendLine = "not enough history yet (first training period)"
  } else {
    const priorAvg = priorWeeks.reduce((s, w) => s + w.totalKm, 0) / recentWindow
    const pct = priorAvg > 0 ? Math.round(((currentAvgWeeklyKm - priorAvg) / priorAvg) * 100) : 0
    const arrow = `${priorAvg.toFixed(1)} → ${currentAvgWeeklyKm.toFixed(1)} km/week`
    if (pct > 10) trendLine = `upward — ${arrow} (+${pct}%)`
    else if (pct < -10) trendLine = `downward — ${arrow} (${pct}%)`
    else trendLine = `stable — ${arrow} (${pct > 0 ? "+" : ""}${pct}%)`
  }

  return `You are an expert running coach creating a personalised ${blockWeeks}-week training block for a runner preparing for an upcoming race.

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
- Avg weekly km (last ${recentWindow} weeks): ${currentAvgWeeklyKm.toFixed(1)} km
- Volume trend vs prior ${recentWindow} weeks: ${trendLine}
- Longest recent run: ${longestRecentRun.toFixed(1)} km

## Suggested Weekly Volume Targets
These are calculated from the runner's ${recentWindow}-week rolling average using ${increasePct}% progressive overload. Use them as a starting point, but apply your coaching judgment — if the trend or history clearly warrants it, you may adjust individual weeks by up to ±15%. Explain any adjustments in that week's coachNote.
${weekTargetLines}

## Session Distribution Rules
Distribute each week's km across sessions with meaningful variety — never assign the same distance to every session:
- Long run: ~40% of weekly total (e.g. 9 km week → long run 4 km, not 3 km)
- Easy runs: split the remaining km roughly equally
- The long run MUST always be at least 1 km longer than any easy run in the same week
- Example for 9 km / 3 sessions: Long run 4 km · Easy run 2.5 km · Easy run 2.5 km
- Example for 8 km / 3 sessions: Long run 3.5 km · Easy run 2.5 km · Easy run 2 km
- If focus is "volume" only (no session types required), you may omit run types but still vary distances
- ORDERING: Always list the Long run FIRST in the sessions array, then tempo/intervals, then easy runs last

## Your Task
Generate a ${blockWeeks}-week training block starting from today. The block should:
- Follow the suggested weekly volume targets above, adjusting based on the runner's trend if needed
- Match the runner's stated preferences (sessions/week and focus)
- NOT assign sessions to specific days — just describe what sessions to do each week
- Be appropriate for ${daysUntilRace} days out from race day

IMPORTANT: Do not specify which day of the week to run. Sessions should be described as "do these runs this week, on days that suit you."

Respond with ONLY a valid JSON object — no explanation text before or after. The "weeks" array must have exactly ${blockWeeks} entries. Use this exact structure:
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
    weekly_increase_pct: prefsRow?.weekly_increase_pct ?? 10,
    block_weeks: prefsRow?.block_weeks ?? 4,
    regenerate_every_weeks: prefsRow?.regenerate_every_weeks ?? 4,
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
  // Use the same window as the plan regeneration cadence — if the user checks in
  // every 2 weeks the plan should react to the last 2 weeks; every 8 weeks means
  // a broader view. Empty weeks (no runs) are included by always dividing by the
  // full window size, not just the count of active weeks.
  const recentWindow = prefs.regenerate_every_weeks ?? 4
  const currentAvgWeeklyKm =
    weeklySummaries.slice(0, recentWindow).reduce((s, w) => s + w.totalKm, 0) / recentWindow

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

  // Call Claude with extended thinking so it reasons through coaching logic before writing JSON
  let plan: TrainingPlan
  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 10000,
      thinking: { type: "enabled", budget_tokens: 5000 },
      messages: [{ role: "user", content: prompt }],
    })

    // With extended thinking the response contains thinking blocks before the text block
    const textBlock = message.content.find((b) => b.type === "text")
    if (!textBlock || textBlock.type !== "text") throw new Error("No text block in Claude response")

    // Extract JSON — Claude sometimes wraps in markdown code fences
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/)
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
  const { goalId, sessions_per_week, focus, notes, weekly_increase_pct, block_weeks, regenerate_every_weeks } = body

  if (!goalId) return NextResponse.json({ error: "goalId is required" }, { status: 400 })

  const { error } = await supabase.from("goal_preferences").upsert(
    {
      goal_id: goalId,
      user_id: user.id,
      sessions_per_week,
      focus,
      notes: notes || null,
      weekly_increase_pct: weekly_increase_pct ?? 10,
      block_weeks: block_weeks ?? 4,
      regenerate_every_weeks: regenerate_every_weeks ?? 4,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "goal_id" }
  )

  if (error) {
    return NextResponse.json({ error: "Failed to save preferences" }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
