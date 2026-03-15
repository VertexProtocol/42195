import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import type { GoalPreferences, TrainingPlan, TrainingWeek } from "@/lib/types"
import { validateAndAdjustPlan, parseSessionDistanceKm } from "@/lib/training-safety"

const TrainingPlanSchema = z.object({
  summary: z.string(),
  weeks: z.array(
    z.object({
      weekNumber: z.number(),
      theme: z.string(),
      targetKm: z.number(),
      sessions: z.array(
        z.object({
          type: z.string(),
          distance: z.string(),
          effort: z.string(),
          purpose: z.string(),
        }),
      ),
      coachNote: z.string().nullable(),
    }),
  ),
  keyPrinciples: z.array(z.string()),
  watchOut: z.string().nullable(),
})

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
  const weeks = new Map<string, WeeklySummary & { totalDurationSec: number }>()

  for (const a of activities) {
    const d = new Date(a.date)
    // Use UTC methods to avoid server timezone issues
    const day = d.getUTCDay()
    const diff = day === 0 ? -6 : 1 - day
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff))
    const key = monday.toISOString().split("T")[0]

    const existing = weeks.get(key)
    const km = Number(a.distance_km)

    if (existing) {
      existing.totalKm += km
      existing.totalDurationSec += a.duration_seconds
      existing.runCount += 1
      if (km > existing.longestKm) existing.longestKm = km
    } else {
      weeks.set(key, {
        weekLabel: key,
        totalKm: km,
        totalDurationSec: a.duration_seconds,
        runCount: 1,
        longestKm: km,
        avgPaceMinPerKm: null, // computed below
      })
    }
  }

  // Compute avg pace from total distance and total duration per week
  for (const w of weeks.values()) {
    if (w.totalKm > 0 && w.totalDurationSec > 0) {
      w.avgPaceMinPerKm = (w.totalDurationSec / 60) / w.totalKm
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

function calcWeekTargets(
  avgWeeklyKm: number,
  pct: number,
  blockWeeks: number,
  acwr?: { ratio: number; risk: string },
): number[] {
  let base = avgWeeklyKm > 0 ? avgWeeklyKm : 15 // Conservative default for beginners (was 20)
  // If ACWR indicates injury risk, reduce the starting baseline
  if (acwr?.risk === "high") {
    base = base * 0.8 // 20% reduction for high risk
  } else if (acwr?.risk === "moderate") {
    base = base * 0.9 // 10% reduction for moderate risk
  }
  const multiplier = 1 + pct / 100
  // Safety cap: no week should exceed 150% of baseline to prevent injury
  const maxWeeklyKm = (avgWeeklyKm > 0 ? avgWeeklyKm : 15) * 1.5
  const targets: number[] = []
  // Week 1 starts at the runner's current baseline
  let current = base
  targets.push(Math.round(current))
  // Progressive overload for weeks 2 through blockWeeks-1
  for (let i = 1; i < blockWeeks - 1; i++) {
    current = Math.min(current * multiplier, maxWeeklyKm)
    targets.push(Math.round(current))
  }
  // Last week is always recovery at 80% of peak
  targets.push(Math.round(current * 0.8))
  return targets
}

/**
 * Build full-cycle periodised volume targets with base/build/peak/taper phases.
 * Recovery weeks (70% volume) are inserted every 3rd week.
 */
function calcFullCycleTargets(
  avgWeeklyKm: number,
  totalWeeks: number,
  acwr?: { ratio: number; risk: string },
): number[] {
  let base = avgWeeklyKm > 0 ? avgWeeklyKm : 15
  if (acwr?.risk === "high") base *= 0.8
  else if (acwr?.risk === "moderate") base *= 0.9

  const targets: number[] = []
  // Phase boundaries (approximate):
  // 60% base-building, 25% build/peak, 15% taper (last 2-3 weeks)
  const taperWeeks = Math.min(3, Math.max(1, Math.floor(totalWeeks * 0.15)))
  const buildWeeks = Math.max(2, Math.floor(totalWeeks * 0.25))
  const baseWeeks = totalWeeks - buildWeeks - taperWeeks

  // Base phase: gradual increase ~5-8% per week, recovery after every 2 hard weeks
  let current = base
  let hardWeeksSinceRecovery = 0
  for (let i = 0; i < baseWeeks; i++) {
    if (hardWeeksSinceRecovery >= 2 && i > 0) {
      targets.push(Math.round(current * 0.7)) // Recovery week
      hardWeeksSinceRecovery = 0
    } else {
      targets.push(Math.round(current))
      current = Math.min(current * 1.07, base * 2.0) // Cap at 2x baseline
      hardWeeksSinceRecovery++
    }
  }

  // Build phase: higher intensity weeks with steeper progression
  for (let i = 0; i < buildWeeks; i++) {
    if (hardWeeksSinceRecovery >= 2 && i > 0) {
      targets.push(Math.round(current * 0.7))
      hardWeeksSinceRecovery = 0
    } else {
      targets.push(Math.round(current))
      current = Math.min(current * 1.05, base * 2.2)
      hardWeeksSinceRecovery++
    }
  }

  // Taper: reduce volume progressively from peak down to 60%
  const peakKm = current
  for (let i = 0; i < taperWeeks; i++) {
    const taperPct = 1 - ((i + 1) / taperWeeks) * 0.4 // 100% → 60% of peak
    targets.push(Math.round(peakKm * taperPct))
  }

  // Ensure we have exactly totalWeeks entries
  while (targets.length < totalWeeks) targets.push(Math.round(peakKm * 0.6))
  if (targets.length > totalWeeks) targets.length = totalWeeks

  return targets
}

function getPhaseLabel(weekIndex: number, totalWeeks: number): string {
  const taperWeeks = Math.min(3, Math.max(1, Math.floor(totalWeeks * 0.15)))
  const buildWeeks = Math.max(2, Math.floor(totalWeeks * 0.25))
  const baseWeeks = totalWeeks - buildWeeks - taperWeeks

  if (weekIndex < baseWeeks) return " (base)"
  if (weekIndex < baseWeeks + buildWeeks) return " (build)"
  return " (taper)"
}

/**
 * Cacheable system prompt — identical for all users.
 * Marked with cache_control so Anthropic can reuse it across requests.
 */
const COACHING_SYSTEM_PROMPT = `You are an expert running coach creating personalised training blocks for runners preparing for races.

## Session Distribution Rules
Distribute each week's km across sessions with meaningful variety — never assign the same distance to every session:
- Long run: ~40% of weekly total (e.g. 9 km week → long run 4 km, not 3 km)
- Easy runs: split the remaining km roughly equally
- The long run MUST always be at least 1 km longer than any easy run in the same week
- Example for 9 km / 3 sessions: Long run 4 km · Easy run 2.5 km · Easy run 2.5 km
- Example for 8 km / 3 sessions: Long run 3.5 km · Easy run 2.5 km · Easy run 2 km
- If focus is "volume" only (no session types required), you may omit run types but still vary distances
- ORDERING: Always list the Long run FIRST in the sessions array, then tempo/intervals, then easy runs last

## Intensity Balance
- At most 2 quality sessions (tempo, intervals, race pace) per week — the rest should be easy effort
- Never schedule descriptions that imply hard efforts on back-to-back days
- Follow the 80/20 rule: ~80% of weekly volume at easy/conversational effort, ~20% at moderate-to-hard effort

## Safety Guidelines
- Never increase weekly volume by more than 10-15% compared to the previous week
- Always include a recovery week (70-80% of peak volume) at the end of each training block
- If injury risk (ACWR) is moderate or high, reduce suggested volume by 10-20%
- If the runner has very low recent mileage (<10 km/week), start conservatively
- Taper phase: reduce volume 30-50% compared to peak, prioritise rest and race-day readiness

## Output Format
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
  adjustNote: string | null,
  acwr?: { ratio: number; risk: string },
  recentEasyPace?: number | null,
  recentBestPace?: number | null,
  previousPlanSummary?: string | null,
  hrSummary?: string | null,
  testRunSection?: string | null,
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

  // Determine block weeks based on plan mode
  const maxWeeksUntilRace = Math.max(1, Math.floor(daysUntilRace / 7))
  const isFullCycle = (prefs.plan_mode ?? "block") === "full_cycle"
  const blockWeeks = isFullCycle
    ? Math.min(maxWeeksUntilRace, 20) // Full cycle: plan to race day, max 20 weeks
    : Math.min(prefs.block_weeks ?? 4, maxWeeksUntilRace)
  const increasePct = prefs.weekly_increase_pct ?? 10
  const recentWindow = prefs.regenerate_every_weeks ?? 4

  // For full-cycle, build periodised volume targets with mesocycles
  let weekTargets: number[]
  if (isFullCycle && blockWeeks > 6) {
    weekTargets = calcFullCycleTargets(currentAvgWeeklyKm, blockWeeks, acwr)
  } else {
    weekTargets = calcWeekTargets(currentAvgWeeklyKm, increasePct, blockWeeks, acwr)
  }
  const weekTargetLines = weekTargets
    .map((km, i) => {
      const label = isFullCycle ? getPhaseLabel(i, blockWeeks) : ""
      if (i === blockWeeks - 1) return `- Week ${i + 1}: ${km} km (race week — taper)${label}`
      return `- Week ${i + 1}: ${km} km${label}`
    })
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

  // Determine training phase based on time to race
  const phase = daysUntilRace > 84 ? "base-building"
    : daysUntilRace > 42 ? "build"
    : daysUntilRace > 21 ? "peak"
    : "taper"

  const taperNote = phase === "taper"
    ? "\n\nIMPORTANT: The runner is in taper phase. Reduce volume by 30-50% compared to peak. Prioritize rest, short quality sessions, and race-day readiness. Do NOT increase volume."
    : ""

  const previousPlanSection = previousPlanSummary
    ? `\n## Previous Plan Context\n${previousPlanSummary}\nBuild on this progression — do not repeat the same block. Ensure continuity and logical progression.\n`
    : ""

  const hrSection = hrSummary
    ? `\n## Heart Rate Data\n${hrSummary}\n`
    : ""

  const testRunPromptSection = testRunSection
    ? `\n${testRunSection}\n`
    : ""

  return `Create a ${blockWeeks}-week training block for this runner.

## The Runner's Goal
- Race: ${goal.name} (${goal.target_distance_km} km)
- Race date: ${goal.target_date} (${daysUntilRace} days away)
- Training phase: ${phase}
- Training start: ${goal.start_date ?? goal.created_at.split("T")[0]}${taperNote}

## Runner's Preferences
- Sessions per week: ${prefs.sessions_per_week}
- Focus: ${focusDescription}
- Notes: ${prefs.notes ? `"${prefs.notes}"` : "None provided"}
${adjustSection}${previousPlanSection}${hrSection}${testRunPromptSection}
## Recent Training History (most recent first)
${weekSummaryText}

## Current Fitness Snapshot
- Avg weekly km (last ${recentWindow} weeks): ${currentAvgWeeklyKm.toFixed(1)} km
- Volume trend vs prior ${recentWindow} weeks: ${trendLine}
- Longest recent run: ${longestRecentRun.toFixed(1)} km${goal.target_distance_km > longestRecentRun ? ` (goal: ${goal.target_distance_km} km — long run ceiling for this block: ${Math.min(longestRecentRun + blockWeeks * 2, goal.target_distance_km * 0.85).toFixed(1)} km)` : ""}${recentEasyPace ? `\n- Recent easy pace: ${formatPace(recentEasyPace)} (average of slower 50% of runs)` : ""}${recentBestPace ? `\n- Recent best pace: ${formatPace(recentBestPace)} (fastest run)` : ""}${acwr ? `\n- Injury risk (ACWR): ${acwr.ratio.toFixed(2)} (${acwr.risk})${acwr.risk !== "low" ? " — consider reducing volume this week" : ""}` : ""}

## Suggested Weekly Volume Targets
${isFullCycle ? `This is a FULL-CYCLE plan from now to race day with periodised phases (base → build → taper). Recovery weeks at ~70% volume are included every 3rd week.` : `These are calculated from the runner's ${recentWindow}-week rolling average using ${increasePct}% progressive overload.`} Use them as a starting point, but apply your coaching judgment — if the trend or history clearly warrants it, you may adjust individual weeks by up to ±15%. Explain any adjustments in that week's coachNote.
${weekTargetLines}

IMPORTANT: Do not specify which day of the week to run. Sessions should be described as "do these runs this week, on days that suit you."
The "weeks" array must have exactly ${blockWeeks} entries.`
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
    adjustNote = body.adjustNote
      ? String(body.adjustNote).replace(/[^\p{L}\p{N}\s.,!?;:'"()\-–—/+%°#@]/gu, "").slice(0, 500)
      : null
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  if (!goalId) {
    return NextResponse.json({ error: "goalId is required" }, { status: 400 })
  }

  // Rate limit: prevent regeneration within 60 seconds
  const { data: existingPlan } = await supabase
    .from("ai_training_plans")
    .select("generated_at, plan, adjust_note, block_start_date, previous_plans")
    .eq("goal_id", goalId)
    .maybeSingle()

  if (existingPlan?.generated_at) {
    const lastGen = new Date(existingPlan.generated_at).getTime()
    if (Date.now() - lastGen < 60_000) {
      return NextResponse.json(
        { error: "Please wait at least 60 seconds before regenerating" },
        { status: 429 },
      )
    }
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
    plan_mode: prefsRow?.plan_mode ?? "block",
  }

  // Fetch last 12 weeks of activities
  const twelveWeeksAgo = new Date()
  twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 84)

  const { data: activities } = await supabase
    .from("activities")
    .select("date, distance_km, duration_seconds, pace_min_per_km, avg_heart_rate")
    .eq("user_id", user.id)
    .gte("date", twelveWeeksAgo.toISOString())
    .order("date", { ascending: false })
    .limit(500)

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

  // Compute ACWR for injury risk awareness in the prompt
  const now = Date.now()
  const day7 = now - 7 * 24 * 60 * 60 * 1000
  const day28 = now - 28 * 24 * 60 * 60 * 1000
  const acts = activities ?? []
  const acuteLoad = acts
    .filter((a) => new Date(a.date).getTime() >= day7)
    .reduce((s, a) => s + Number(a.distance_km), 0)
  const chronicTotal = acts
    .filter((a) => new Date(a.date).getTime() >= day28)
    .reduce((s, a) => s + Number(a.distance_km), 0)
  const chronicLoad = chronicTotal / 4
  const acwrRatio = chronicLoad > 0 ? acuteLoad / chronicLoad : 0
  const acwrRisk = acwrRatio > 1.5 ? "high" : acwrRatio > 1.3 ? "moderate" : "low"

  // Compute pace stats for the prompt
  const actsWithPace = acts.filter((a) => a.pace_min_per_km && Number(a.pace_min_per_km) > 0)
  const recentEasyPace = actsWithPace.length > 0
    ? actsWithPace
        .map((a) => Number(a.pace_min_per_km))
        .sort((a, b) => b - a) // slowest first
        .slice(0, Math.ceil(actsWithPace.length * 0.5)) // bottom 50% by speed = top 50% by pace value
        .reduce((s, p, _, arr) => s + p / arr.length, 0)
    : null
  const recentBestPace = actsWithPace.length > 0
    ? Math.min(...actsWithPace.map((a) => Number(a.pace_min_per_km)))
    : null

  // Build heart rate summary for the prompt
  const actsWithHr = acts.filter((a) => a.avg_heart_rate && Number(a.avg_heart_rate) > 0)
  let hrSummary: string | null = null
  if (actsWithHr.length > 0) {
    const avgHr = Math.round(actsWithHr.reduce((s, a) => s + Number(a.avg_heart_rate), 0) / actsWithHr.length)
    const maxHr = Math.max(...actsWithHr.map((a) => Number(a.avg_heart_rate)))
    const recentHrs = actsWithHr.slice(0, 5).map((a) => Number(a.avg_heart_rate))
    const recentAvgHr = Math.round(recentHrs.reduce((s, h) => s + h, 0) / recentHrs.length)
    const hrTrend = recentAvgHr > avgHr + 5 ? "elevated (possible fatigue)" : recentAvgHr < avgHr - 5 ? "lower than average (good fitness)" : "stable"
    hrSummary = `- Average heart rate across runs: ${avgHr} bpm\n- Highest average HR recorded: ${maxHr} bpm\n- Recent HR trend (last 5 runs): ${recentAvgHr} bpm avg — ${hrTrend}\n- Estimated max HR: ~${Math.round(maxHr * 1.1)} bpm (from activity data)`
  }

  // Fetch test run benchmarks for calibration
  const { data: testRuns } = await supabase
    .from("test_runs")
    .select("test_type, distance_km, time_seconds, avg_pace, avg_hr, derived_metrics, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(10)

  let testRunSection: string | null = null
  if (testRuns && testRuns.length > 0) {
    const lines = testRuns.map((tr) => {
      const metrics = tr.derived_metrics as Record<string, number | null> | null
      const vo2max = metrics?.estimated_vo2max
      const threshPace = metrics?.threshold_pace
      const paceStr = tr.avg_pace ? formatPace(Number(tr.avg_pace)) : "N/A"
      return `  - ${tr.test_type} (${tr.created_at.split("T")[0]}): ${Number(tr.distance_km).toFixed(1)} km in ${Math.floor(tr.time_seconds / 60)}min, pace ${paceStr}${tr.avg_hr ? `, HR ${tr.avg_hr}` : ""}${vo2max ? `, est. VO2max ${vo2max}` : ""}${threshPace ? `, threshold pace ~${formatPace(threshPace)}` : ""}`
    })
    testRunSection = `## Test Run Benchmarks (high-confidence fitness data)\nThese are user-tagged benchmark efforts. Use them as strong calibration signals for pace targets and training intensity.\n${lines.join("\n")}`
  }

  // Build previous plan summary for continuity
  let previousPlanSummary: string | null = null
  if (existingPlan?.plan) {
    const prevPlan = existingPlan.plan as TrainingPlan
    const totalKm = prevPlan.weeks.reduce((s: number, w: TrainingWeek) => s + w.targetKm, 0)
    const peakKm = Math.max(...prevPlan.weeks.map((w: TrainingWeek) => w.targetKm))
    const weekThemes = prevPlan.weeks.map((w: TrainingWeek) => `Week ${w.weekNumber}: ${w.theme} (${w.targetKm} km)`).join("\n  ")
    previousPlanSummary = `Previous block (generated ${existingPlan.generated_at?.split("T")[0] ?? "recently"}):\n  ${weekThemes}\n  Total: ${totalKm} km, Peak week: ${peakKm} km\n  Summary: ${prevPlan.summary}`
    if (existingPlan.adjust_note) {
      previousPlanSummary += `\n  Last adjustment note: "${existingPlan.adjust_note}"`
    }
  }

  const prompt = buildPrompt(
    goal,
    prefs,
    weeklySummaries,
    longestRecentRun,
    currentAvgWeeklyKm,
    daysUntilRace,
    adjustNote,
    { ratio: acwrRatio, risk: acwrRisk },
    recentEasyPace,
    recentBestPace,
    previousPlanSummary,
    hrSummary,
    testRunSection,
  )

  // Stream Claude response via SSE to avoid timeouts and provide progress feedback
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
          max_tokens: 10000,
          thinking: { type: "enabled", budget_tokens: 2000 },
          system: [
            {
              type: "text" as const,
              text: COACHING_SYSTEM_PROMPT,
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

        // Extract text block
        const textBlock = message.content.find((b: { type: string }) => b.type === "text")
        if (!textBlock || textBlock.type !== "text") throw new Error("No text block in Claude response")

        const jsonMatch = (textBlock as { type: "text"; text: string }).text.match(/\{[\s\S]*\}/)
        if (!jsonMatch) throw new Error("No JSON found in Claude response")

        const parsed = TrainingPlanSchema.safeParse(JSON.parse(jsonMatch[0]))
        if (!parsed.success) {
          console.error("Invalid plan structure from Claude:", parsed.error.message)
          throw new Error(`Invalid plan structure: ${parsed.error.message}`)
        }
        const plan = parsed.data

        // Post-generation structural validation logging
        for (const week of plan.weeks) {
          if (week.sessions.length !== prefs.sessions_per_week) {
            console.warn(
              `[plan-validation] Week ${week.weekNumber}: ${week.sessions.length} sessions, expected ${prefs.sessions_per_week}`
            )
          }
          const sessionKmTotal = week.sessions.reduce((sum: number, s: { distance: string }) => {
            return sum + parseSessionDistanceKm(s.distance)
          }, 0)
          if (sessionKmTotal > 0 && Math.abs(sessionKmTotal - week.targetKm) > week.targetKm * 0.2) {
            console.warn(
              `[plan-validation] Week ${week.weekNumber}: session total ${sessionKmTotal.toFixed(1)} km vs target ${week.targetKm} km (>20% deviation)`
            )
          }
        }

        // Safety engine: validate and adjust for load progression, ACWR, long runs, fatigue
        const safetyResult = validateAndAdjustPlan(plan, acts, prefs)
        const safePlan = safetyResult.adjustedPlan

        if (!safetyResult.passed) {
          console.warn(
            `[safety] Plan adjusted for goal ${goalId} (level: ${safetyResult.athleteLevel}):`,
            safetyResult.safetyNotes,
          )
        }

        // Cache in DB (upsert — one active plan per goal)
        // Use service-role client here because the cookie-based client may
        // have lost its auth context inside the ReadableStream callback
        // (cookies() from next/headers is only available during initial request handling).
        const service = createServiceClient()
        const blockStartDate = new Date().toISOString().split("T")[0]
        const generatedAt = new Date().toISOString()

        // Re-fetch existing plan via service client for archiving
        const { data: currentPlan } = await service
          .from("ai_training_plans")
          .select("plan, generated_at, adjust_note, block_start_date, previous_plans")
          .eq("goal_id", goalId)
          .eq("user_id", user.id)
          .maybeSingle()

        const previousPlans = Array.isArray(currentPlan?.previous_plans)
          ? currentPlan.previous_plans
          : []

        if (currentPlan?.plan) {
          previousPlans.unshift({
            plan: currentPlan.plan,
            generated_at: currentPlan.generated_at,
            adjust_note: currentPlan.adjust_note ?? null,
            block_start_date: currentPlan.block_start_date,
          })
          // Keep at most 5 previous plans
          if (previousPlans.length > 5) previousPlans.length = 5
        }

        const { error: upsertError } = await service
          .from("ai_training_plans")
          .upsert(
            {
              goal_id: goalId,
              user_id: user.id,
              plan: safePlan,
              adjust_note: adjustNote,
              block_start_date: blockStartDate,
              generated_at: generatedAt,
              previous_plans: previousPlans,
            },
            { onConflict: "goal_id" }
          )

        if (upsertError) {
          console.error("Failed to cache training plan:", upsertError)
          send({ status: "error", error: "Plan was generated but failed to save. Please try again." })
          return
        }

        send({
          status: "done",
          plan: safePlan,
          block_start_date: blockStartDate,
          generated_at: generatedAt,
          safety: safetyResult.passed ? null : {
            athleteLevel: safetyResult.athleteLevel,
            notes: safetyResult.safetyNotes,
          },
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error("Claude API error:", msg, err)
        send({ status: "error", error: `Failed to generate training plan: ${msg}` })
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
    .select("plan, block_start_date, generated_at, previous_plans")
    .eq("goal_id", goalId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!planRow) return NextResponse.json({ plan: null })

  return NextResponse.json({
    plan: planRow.plan,
    block_start_date: planRow.block_start_date,
    generated_at: planRow.generated_at,
    previous_plans: planRow.previous_plans ?? [],
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
  const { goalId, sessions_per_week, focus, notes, weekly_increase_pct, block_weeks, regenerate_every_weeks, plan_mode } = body

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
      plan_mode: plan_mode ?? "block",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "goal_id" }
  )

  if (error) {
    return NextResponse.json({ error: "Failed to save preferences" }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
