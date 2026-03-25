import { NextRequest, NextResponse } from "next/server"
import { anthropic } from "@/lib/anthropic"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { checkAiRateLimit, rateLimitExceededResponse } from "@/lib/ai-rate-limit"
import type { Activity, GoalPreferences, TrainingPlan, TrainingWeek } from "@/lib/types"
import { validateAndAdjustPlan, parseSessionDistanceKm, detectFatigue, classifyAthleteLevel, type SafetyActivity } from "@/lib/training-safety"
import { analyzeHeartRateZones } from "@/lib/hr-analysis-engine"
import { computeTrainingTimeline } from "@/lib/training-timeline"
import { effortAdjustedKm, predictRaceTimes } from "@/lib/training-utils"
import { buildPaceGuide, assignSessionPace } from "@/lib/pace-guide"
import { PACE_PROGRESSION_RATES, PACE_PROGRESSION_MAX_WEEKS } from "@/lib/training-constants"
import { type NoteHistoryEntry, getPhaseLabel, formatNotesHistoryForPrompt } from "@/lib/notes-history"

const RUN_TYPES = new Set(["Run", "Trail Run", "Virtual Run", "Treadmill", "Race"])

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
          suggestedPace: z.string().optional(),
        }),
      ),
      coachNote: z.string().nullable(),
    }),
  ),
  keyPrinciples: z.array(z.string()),
  watchOut: z.string().nullable(),
})

interface WeeklySummary {
  weekLabel: string
  totalKm: number
  runCount: number
  longestKm: number
  avgPaceMinPerKm: number | null
  totalElevationM: number
}

function groupActivitiesByWeek(
  activities: Array<{
    date: string
    distance_km: number
    duration_seconds: number
    pace_min_per_km: number | null
    elevation_gain_m?: number | null
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
    const elev = Number(a.elevation_gain_m ?? 0)

    if (existing) {
      existing.totalKm += km
      existing.totalDurationSec += a.duration_seconds
      existing.runCount += 1
      existing.totalElevationM += elev
      if (km > existing.longestKm) existing.longestKm = km
    } else {
      weeks.set(key, {
        weekLabel: key,
        totalKm: km,
        totalDurationSec: a.duration_seconds,
        runCount: 1,
        longestKm: km,
        avgPaceMinPerKm: null, // computed below
        totalElevationM: elev,
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

function calcMinWeeklyKm(sessionsPerWeek: number, longestRecentRun: number): number {
  // Long run minimum: 8 km if the runner has ever run ≥ 6 km, otherwise gently above their longest
  const longRunMin = longestRecentRun >= 6 ? 8 : Math.max(longestRecentRun + 1, 5)
  // Other sessions: 5 km each
  return longRunMin + Math.max(0, sessionsPerWeek - 1) * 5
}

function calcWeekTargets(
  avgWeeklyKm: number,
  pct: number,
  blockWeeks: number,
  sessionsPerWeek: number,
  longestRecentRun: number,
  acwr?: { ratio: number; risk: string },
): number[] {
  let base = avgWeeklyKm > 0 ? avgWeeklyKm : 15 // Conservative default for beginners (was 20)
  // If ACWR indicates injury risk, reduce the starting baseline
  if (acwr?.risk === "high") {
    base = base * 0.8 // 20% reduction for high risk
  } else if (acwr?.risk === "moderate") {
    base = base * 0.9 // 10% reduction for moderate risk
  }
  // Enforce a minimum weekly volume so that session length rules can be satisfied.
  // Without this, a 10 km week with 2 sessions can't support a ≥ 8 km long run + ≥ 5 km base run.
  base = Math.max(base, calcMinWeeklyKm(sessionsPerWeek, longestRecentRun))
  const multiplier = 1 + pct / 100
  // Safety cap: no week should exceed 150% of baseline to prevent injury
  const maxWeeklyKm = Math.max(avgWeeklyKm > 0 ? avgWeeklyKm : 15, base) * 1.5
  const targets: number[] = []
  // Week 1 starts at the runner's current baseline
  let current = base
  targets.push(Math.round(current))
  // Progressive overload for weeks 2 through blockWeeks-1
  for (let i = 1; i < blockWeeks - 1; i++) {
    current = Math.min(current * multiplier, maxWeeklyKm)
    targets.push(Math.round(current))
  }
  // Last week is always recovery at 80% of peak — use floor so it rounds down,
  // never up (12.58 → 12, not 13)
  targets.push(Math.floor(current * 0.8))
  return targets
}

/**
 * Build full-cycle periodised volume targets with base/build/peak/taper phases.
 * Recovery weeks (70% volume) are inserted every 3rd week.
 */
function calcFullCycleTargets(
  avgWeeklyKm: number,
  totalWeeks: number,
  sessionsPerWeek: number,
  longestRecentRun: number,
  acwr?: { ratio: number; risk: string },
): number[] {
  let base = avgWeeklyKm > 0 ? avgWeeklyKm : 15
  if (acwr?.risk === "high") base *= 0.8
  else if (acwr?.risk === "moderate") base *= 0.9
  base = Math.max(base, calcMinWeeklyKm(sessionsPerWeek, longestRecentRun))

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


/**
 * Cacheable system prompt — identical for all users.
 * Marked with cache_control so Anthropic can reuse it across requests.
 */
const COACHING_SYSTEM_PROMPT = `You are an expert running coach creating personalised training blocks for runners preparing for races.

## Session Types
Use the right session name — it communicates purpose, not just effort. Choose from:
- **Long run** — the week's longest run. Only use when session is genuinely longest of the week AND ≥ 8 km. Easy/Z2 pace.
- **Base run** — medium-length easy run (5–10 km). The workhorse of aerobic training. Prefer this over "Easy run" for most sessions.
- **Recovery run** — short, very easy (4–6 km). Use the day after a hard session or long run. Slower than base pace.
- **Progression run** — starts easy, finishes last 20–30% at tempo effort. Good mid-block variety.
- **Tempo run** — sustained threshold effort, 20–40 min. Max 2/week; rarely in base-building phases.
- **Intervals** — structured speed work with rest (e.g. 6 × 800 m). Only in build/peak phases.
- **Hill repeats** — short steep uphill efforts with easy jog recovery. Builds strength and form.
- **Fartlek** — unstructured speedplay mixed into an easy run. Introduces variety without rigid structure.
- **Race pace run** — sustained goal race pace. Only in peak/sharpening phases, 2–3 weeks before race.
Vary session types across the block — never use only "Long run" and "Easy run" throughout an entire training plan.

## Session Distribution Rules
- The longest session of the week (must be ≥ 8 km) → "Long run". Target ~40% of weekly total.
- Medium easy sessions (5–10 km) → "Base run" (preferred) or "Easy run"
- Short sessions after hard days → "Recovery run"
- Long run MUST be at least 2 km longer than any other session in the same week
- Minimum session length: 5 km for base/easy runs, 8 km for long run
- EXCEPTION: Weekly volume < 15 km → sessions may be 4 km minimum, but prefer fewer longer sessions (2 × 6 km > 3 × 4 km)
- Examples: 20 km / 3 sessions → Long run 8 km · Base run 6 km · Base run 6 km
- Examples: 30 km / 3 sessions → Long run 12 km · Base run 9 km · Base run 9 km
- ORDERING: Long run FIRST, then quality sessions (tempo/intervals), then base/recovery runs last

## Aerobic Base Principle
Fewer, longer easy runs are significantly more effective than many short ones for building aerobic fitness.
- A run under 5 km (~30 min) provides very limited aerobic stimulus — avoid unless weekly volume cannot support longer sessions
- If weekly target forces sessions below 5 km, reduce session count instead: 2 × 7 km beats 3 × 4 km
- For base-building phases, prioritise 60–90 min efforts (8–12 km at easy pace) as the weekly long run

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
  blockPosition?: { blockNum: number; totalBlocks: number; phaseName: string; weekInPlan: number; totalWeeks: number } | null,
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
            `  Week -${i + 1} (${w.weekLabel}): ${w.runCount} run${w.runCount !== 1 ? "s" : ""}, ${w.totalKm.toFixed(1)} km total, longest: ${w.longestKm.toFixed(1)} km${w.avgPaceMinPerKm ? `, avg pace: ${formatPace(w.avgPaceMinPerKm)}` : ""}${w.totalElevationM > 0 ? `, elevation gain: ${Math.round(w.totalElevationM)} m` : ""}`
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
    weekTargets = calcFullCycleTargets(currentAvgWeeklyKm, blockWeeks, prefs.sessions_per_week, longestRecentRun, acwr)
  } else {
    weekTargets = calcWeekTargets(currentAvgWeeklyKm, increasePct, blockWeeks, prefs.sessions_per_week, longestRecentRun, acwr)
  }
  const weekTargetLines = weekTargets
    .map((km, i) => {
      const label = isFullCycle ? ` (${getPhaseLabel(i, blockWeeks)})` : ""
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

  const blockPositionSection = blockPosition
    ? `\n## Block Position in Training Plan\nThis is block ${blockPosition.blockNum} of ${blockPosition.totalBlocks} in the ${blockPosition.phaseName} phase (week ${blockPosition.weekInPlan} of ${blockPosition.totalWeeks} total). Write the summary to reflect WHERE the runner is in this phase — early blocks should establish foundations, middle blocks should build on progress, late blocks should consolidate. Do not write a generic phase description; reference the runner's actual progression.\n`
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
${(() => {
  const coachHistory = formatNotesHistoryForPrompt(prefs.notes_history, "coach")
  const injuryHistory = formatNotesHistoryForPrompt(prefs.notes_history, "injury")
  const coachLine = coachHistory
    ? `- Coach notes (most recent first):\n${coachHistory}`
    : prefs.notes
      ? `- Coach notes: "${prefs.notes}"`
      : "- Coach notes: None provided"
  const injuryLine = injuryHistory
    ? `- Injury history (most recent first — take seriously: adjust volume/intensity to avoid aggravating these conditions):\n${injuryHistory}`
    : prefs.injury_notes
      ? `- Injury history / recurring issues: "${prefs.injury_notes}" — take this seriously when prescribing session intensity and volume.`
      : ""
  return [coachLine, injuryLine].filter(Boolean).join("\n")
})()}
${adjustSection}${blockPositionSection}${previousPlanSection}${hrSection}${testRunPromptSection}
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

  const rateLimit = await checkAiRateLimit(user.id)
  if (!rateLimit.allowed) return rateLimitExceededResponse(rateLimit)

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

  // Rate limit: prevent regeneration more than once per 10 minutes to avoid
  // plan confusion and excessive AI costs. Users who want to tweak should use
  // the "Adjust" note rather than spamming regenerate.
  const { data: existingPlan } = await supabase
    .from("ai_training_plans")
    .select("generated_at, plan, adjust_note, block_start_date, previous_plans")
    .eq("goal_id", goalId)
    .maybeSingle()

  if (existingPlan?.generated_at) {
    const lastGen = new Date(existingPlan.generated_at).getTime()
    const COOLDOWN_MS = 10 * 60 * 1000 // 10 minutes
    const elapsed = Date.now() - lastGen
    if (elapsed < COOLDOWN_MS) {
      const waitSecs = Math.ceil((COOLDOWN_MS - elapsed) / 1000)
      const waitMins = Math.ceil(waitSecs / 60)
      return NextResponse.json(
        { error: `Please wait ${waitMins} minute${waitMins !== 1 ? "s" : ""} before regenerating` },
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
    injury_notes: (prefsRow as any)?.injury_notes ?? null,
    notes_history: ((prefsRow as any)?.notes_history as NoteHistoryEntry[]) ?? [],
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
    .select("name, type, date, distance_km, duration_seconds, pace_min_per_km, avg_heart_rate, elevation_gain_m")
    .eq("user_id", user.id)
    .gte("date", twelveWeeksAgo.toISOString())
    .order("date", { ascending: false })
    .limit(500)

  // Weekly summaries are computed from running activities only so that cycling/hiking weeks
  // don't inflate weekly km targets in the AI prompt.
  const weeklySummaries = groupActivitiesByWeek((activities ?? []).filter((a) => RUN_TYPES.has(a.type)))

  // Compute derived metrics
  // Use the same window as the plan regeneration cadence — if the user checks in
  // every 2 weeks the plan should react to the last 2 weeks; every 8 weeks means
  // a broader view. Empty weeks (no runs) are included by always dividing by the
  // full window size, not just the count of active weeks.
  const recentWindow = prefs.regenerate_every_weeks ?? 4
  const recentAvgWeeklyKm =
    weeklySummaries.slice(0, recentWindow).reduce((s, w) => s + w.totalKm, 0) / recentWindow

  // Also find the peak 4-week rolling average across the full 12-week history.
  // This prevents a recent taper or recovery plan from creating a feedback loop
  // where each regeneration starts lower than the last, even though the runner's
  // actual fitness is much higher. We use 85% of the peak as a floor so the new
  // plan doesn't jump straight back to peak — a slight step-down is appropriate.
  const peakFourWeekAvg = weeklySummaries.length >= 4
    ? Math.max(...Array.from({ length: weeklySummaries.length - 3 }, (_, i) =>
        weeklySummaries.slice(i, i + 4).reduce((s, w) => s + w.totalKm, 0) / 4
      ))
    : recentAvgWeeklyKm
  const currentAvgWeeklyKm = Math.max(recentAvgWeeklyKm, peakFourWeekAvg * 0.85)

  const longestRecentRun =
    weeklySummaries.reduce((max, w) => Math.max(max, w.longestKm), 0)

  const daysUntilRace = Math.ceil(
    (new Date(goal.target_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  )

  // Compute ACWR and safety metrics from running activities only — cycling/hiking inflate
  // chronic load and cause the plan generator to produce overly conservative running plans.
  const acts = activities ?? []
  const runActs = acts.filter((a) => RUN_TYPES.has(a.type))
  const now = Date.now()
  const day7 = now - 7 * 24 * 60 * 60 * 1000
  const day28 = now - 28 * 24 * 60 * 60 * 1000
  const acuteLoad = runActs
    .filter((a) => new Date(a.date).getTime() >= day7)
    .reduce((s, a) => s + effortAdjustedKm(Number(a.distance_km), a.elevation_gain_m), 0)
  const chronicTotal = runActs
    .filter((a) => new Date(a.date).getTime() >= day28)
    .reduce((s, a) => s + effortAdjustedKm(Number(a.distance_km), a.elevation_gain_m), 0)
  const chronicLoad = chronicTotal / 4
  const acwrRatio = chronicLoad > 0 ? acuteLoad / chronicLoad : 0
  const acwrRisk = acwrRatio > 1.5 ? "high" : acwrRatio > 1.3 ? "moderate" : "low"
  const actsWithPace = runActs.filter((a) => a.pace_min_per_km && Number(a.pace_min_per_km) > 0)
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

  // Build heart rate summary for the prompt, including HR zone boundaries
  const actsWithHr = acts.filter((a) => a.avg_heart_rate && Number(a.avg_heart_rate) > 0)
  let hrSummary: string | null = null
  if (actsWithHr.length > 0) {
    const avgHr = Math.round(actsWithHr.reduce((s, a) => s + Number(a.avg_heart_rate), 0) / actsWithHr.length)
    const maxHr = Math.max(...actsWithHr.map((a) => Number(a.avg_heart_rate)))
    const recentHrs = actsWithHr.slice(0, 5).map((a) => Number(a.avg_heart_rate))
    const recentAvgHr = Math.round(recentHrs.reduce((s, h) => s + h, 0) / recentHrs.length)
    const hrTrend = recentAvgHr > avgHr + 5 ? "elevated (possible fatigue)" : recentAvgHr < avgHr - 5 ? "lower than average (good fitness)" : "stable"
    hrSummary = `- Average heart rate across runs: ${avgHr} bpm\n- Highest average HR recorded: ${maxHr} bpm\n- Recent HR trend (last 5 runs): ${recentAvgHr} bpm avg — ${hrTrend}\n- Estimated max HR: ~${Math.round(maxHr * 1.1)} bpm (from activity data)`

    // Add HR zone boundaries from the analysis engine if we have enough data
    if (actsWithHr.length >= 5) {
      const hrAnalysis = analyzeHeartRateZones(
        acts.map((a) => ({
          id: "", user_id: "", strava_id: 0, type: "Run", created_at: "",
          name: a.name ?? "Activity", date: a.date,
          distance_km: Number(a.distance_km), duration_seconds: a.duration_seconds,
          pace_min_per_km: a.pace_min_per_km ? Number(a.pace_min_per_km) : null,
          elevation_gain_m: a.elevation_gain_m ? Number(a.elevation_gain_m) : null,
          avg_heart_rate: a.avg_heart_rate ? Number(a.avg_heart_rate) : null,
          avg_cadence: null, calories: null, map_polyline: null,
        })),
        Math.round(maxHr * 1.1),
      )
      if (hrAnalysis.calibrationStatus !== "insufficient_data") {
        const zoneLines = hrAnalysis.recommendedZones
          .map((z) => `  Z${z.zone} ${z.label}: ${z.min}–${z.max} bpm`)
          .join("\n")
        hrSummary += `\n- HR Zones (use these for prescribing effort levels):\n${zoneLines}`
      }
    }
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

  // Build previous plan summary for continuity — include actual vs planned per week
  let previousPlanSummary: string | null = null
  if (existingPlan?.plan) {
    const prevPlan = existingPlan.plan as TrainingPlan
    const totalKm = prevPlan.weeks.reduce((s: number, w: TrainingWeek) => s + w.targetKm, 0)
    const peakKm = Math.max(...prevPlan.weeks.map((w: TrainingWeek) => w.targetKm))

    // Compute actual km per plan week from activities
    const blockStart = existingPlan.block_start_date
      ? new Date(existingPlan.block_start_date)
      : null
    const acts12 = activities ?? []

    const weekLines = prevPlan.weeks.map((w: TrainingWeek, i: number) => {
      let actualStr = ""
      if (blockStart) {
        const weekStartDate = new Date(blockStart)
        // Align to Monday
        const bDay = weekStartDate.getDay()
        const bDiff = bDay === 0 ? -6 : 1 - bDay
        weekStartDate.setDate(weekStartDate.getDate() + bDiff + i * 7)
        const weekEndDate = new Date(weekStartDate)
        weekEndDate.setDate(weekEndDate.getDate() + 7)
        const actualKm = acts12
          .filter((a) => {
            const d = new Date(a.date)
            return d >= weekStartDate && d < weekEndDate
          })
          .reduce((s, a) => s + a.distance_km, 0)
        const pct = w.targetKm > 0 ? Math.round((actualKm / w.targetKm) * 100) : 0
        actualStr = ` → actual ${actualKm.toFixed(1)} km (${pct}%)`
      }
      return `Week ${w.weekNumber}: ${w.theme} (planned ${w.targetKm} km${actualStr})`
    })

    const totalActualKm = blockStart
      ? prevPlan.weeks.reduce((sum: number, _w: TrainingWeek, i: number) => {
          const ws = new Date(blockStart)
          const bDay = ws.getDay()
          const bDiff = bDay === 0 ? -6 : 1 - bDay
          ws.setDate(ws.getDate() + bDiff + i * 7)
          const we = new Date(ws)
          we.setDate(we.getDate() + 7)
          return sum + acts12
            .filter((a) => { const d = new Date(a.date); return d >= ws && d < we })
            .reduce((s, a) => s + a.distance_km, 0)
        }, 0)
      : null

    previousPlanSummary = `Previous block (generated ${existingPlan.generated_at?.split("T")[0] ?? "recently"}):\n  ${weekLines.join("\n  ")}\n  Planned total: ${totalKm} km${totalActualKm !== null ? `, Actual total: ${totalActualKm.toFixed(1)} km (${Math.round((totalActualKm / totalKm) * 100)}% adherence)` : ""}, Peak week: ${peakKm} km\n  Summary: ${prevPlan.summary}`
    if (existingPlan.adjust_note) {
      previousPlanSummary += `\n  Last adjustment note: "${existingPlan.adjust_note}"`
    }

    // Synthesize patterns from up to 4 archived previous blocks using session completions.
    // This gives the coach context on long-term adherence patterns across the training cycle.
    const archivePlans = Array.isArray(existingPlan.previous_plans) ? existingPlan.previous_plans : []
    if (archivePlans.length > 0) {
      const blockSummaries: string[] = []
      let totalCompletedSessions = 0
      let totalPlannedSessions = 0
      const sessionTypeCompletions: Record<string, { completed: number; total: number }> = {}

      for (const archived of archivePlans.slice(0, 4)) {
        const completions = archived.sessionCompletions ?? {}
        const weeks = archived.weeks ?? []
        let blockCompleted = 0
        let blockPlanned = 0

        for (const week of weeks) {
          for (let si = 0; si < (week.sessionCount ?? 0); si++) {
            const key = `W${week.weekNumber}-${si}`
            const status = completions[key]
            blockPlanned++
            if (status === "completed") blockCompleted++
          }
        }

        totalCompletedSessions += blockCompleted
        totalPlannedSessions += blockPlanned
        const blockAdherence = blockPlanned > 0 ? Math.round((blockCompleted / blockPlanned) * 100) : null
        if (blockAdherence !== null) {
          blockSummaries.push(`Block ${archived.generated_at?.split("T")[0] ?? "?"}: ${blockAdherence}% session adherence (${blockCompleted}/${blockPlanned} sessions completed)`)
        }
      }

      if (blockSummaries.length > 0) {
        const overallAdherence = totalPlannedSessions > 0 ? Math.round((totalCompletedSessions / totalPlannedSessions) * 100) : null
        previousPlanSummary += `\n\n  Historical adherence pattern (${blockSummaries.length} prior blocks):\n  ${blockSummaries.join("\n  ")}`
        if (overallAdherence !== null) {
          previousPlanSummary += `\n  Overall session adherence across tracked blocks: ${overallAdherence}%`
          if (overallAdherence < 70) {
            previousPlanSummary += ` — consistently low adherence suggests real-world constraints. Consider reducing session count or targeting shorter, more manageable sessions.`
          } else if (overallAdherence > 90) {
            previousPlanSummary += ` — consistently high adherence indicates a reliable trainer. Progression can be more confident.`
          }
        }
      }
    }
  }

  // Compute which block this is within the current training phase
  const timeline = computeTrainingTimeline(goal)
  let blockPositionArg: { blockNum: number; totalBlocks: number; phaseName: string; weekInPlan: number; totalWeeks: number } | null = null
  if (timeline) {
    const msPerWeek = 7 * 24 * 60 * 60 * 1000
    const goalStartMs = timeline.startDate.getTime()
    const todayMs = new Date().getTime()
    const blockStartWeek = Math.max(1, Math.round((todayMs - goalStartMs) / msPerWeek) + 1)
    const blockWeeks = prefs.block_weeks ?? 4
    const phase = timeline.phases.find(p => blockStartWeek >= p.weekStart && blockStartWeek <= p.weekEnd)
    if (phase) {
      blockPositionArg = {
        blockNum: Math.floor((blockStartWeek - phase.weekStart) / blockWeeks) + 1,
        totalBlocks: Math.ceil(phase.totalWeeks / blockWeeks),
        phaseName: phase.type.replace(/_/g, " "),
        weekInPlan: blockStartWeek,
        totalWeeks: timeline.totalWeeks,
      }
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
    blockPositionArg,
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

        // Scale thinking budget with plan length: longer blocks benefit from more planning
        // tokens. Capped at 8000 so cost stays predictable.
        const blockWeeksCount = (() => {
          const maxWeeks = Math.max(1, Math.floor(daysUntilRace / 7))
          const isFullCycle = (prefs.plan_mode ?? "block") === "full_cycle"
          return isFullCycle ? Math.min(maxWeeks, 20) : Math.min(prefs.block_weeks ?? 4, maxWeeks)
        })()
        const thinkingBudget = Math.min(8000, Math.max(2000, blockWeeksCount * 1000))

        const stream = anthropic.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 10000,
          thinking: { type: "enabled", budget_tokens: thinkingBudget },
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

        // Safety engine: validate and adjust for load progression, ACWR, long runs, fatigue.
        // Pass running activities only so cross-training doesn't skew ACWR and fatigue detection.
        const safetyResult = validateAndAdjustPlan(plan, runActs as unknown as SafetyActivity[], prefs)
        const safePlan = safetyResult.adjustedPlan

        // Pace guide: deterministic pace targets per session based on test runs + race predictions
        // Use running activities only so cycling/hiking don't skew Riegel predictions
        const { predictions: racePredictions } = predictRaceTimes(runActs as unknown as Activity[])
        const paceGuide = buildPaceGuide(racePredictions, testRuns ?? [], goal.target_distance_km, recentEasyPace)

        // Fatigue modifier: when safety system detects fatigue, pull back hard-session paces
        const fatigueSignal = safetyResult.fatigue.signal
        const hardFatigueModifier =
          fatigueSignal === "both"         ? 1.12 :  // HR + pace both declining → 12% slower
          fatigueSignal === "hr_elevated"  ? 1.05 :  // HR elevated only → 5% slower
          fatigueSignal === "pace_declining"? 1.08 :  // pace declining only → 8% slower
          1.0

        for (const week of safePlan.weeks) {
          // Recovery weeks: all zones run 10% slower to reinforce the lower-stimulus purpose
          const prevWeek = safePlan.weeks[safePlan.weeks.indexOf(week) - 1] ?? null
          const isRecovery =
            /recovery|deload/i.test(week.theme ?? "") ||
            (prevWeek != null && week.targetKm < prevWeek.targetKm * 0.85)

          // Intra-block progression for quality sessions: rate scaled by athlete level,
          // capped at 6 weeks so tempo targets stay safely below 10K race pace.
          const progressionRate = PACE_PROGRESSION_RATES[safetyResult.athleteLevel] ?? PACE_PROGRESSION_RATES.intermediate
          const weekIndex = Math.min(week.weekNumber - 1, PACE_PROGRESSION_MAX_WEEKS - 1)
          const progressionModifier = 1.0 - weekIndex * progressionRate

          for (const session of week.sessions) {
            const zone = session.type.toLowerCase()
            const isHardSession = /tempo|threshold|interval|track|speed|fartlek|repeat|vo2/.test(zone)
            const modifier = isRecovery
              ? 1.10
              : isHardSession
                ? (fatigueSignal !== "none" ? hardFatigueModifier : progressionModifier)
                : 1.0
            const pace = assignSessionPace(session.type, paceGuide, modifier)
            if (pace) session.suggestedPace = pace
          }
        }

        if (!safetyResult.passed) {
          console.warn(
            `[safety] Plan adjusted for goal ${goalId} (level: ${safetyResult.athleteLevel}):`,
            safetyResult.safetyNotes,
          )
        }

        // Final correction: run AFTER safety engine + pace assignment so targetKm is settled.
        // 0. Enforce recovery week volume cap (AI may ignore the suggested 80% target).
        // 1. Round all sessions DOWN to nearest 0.5 km; long run absorbs the rest.
        // 2. Ensure the "Long run" label is on the longest session (swap if mismatched).
        // 3. Update targetKm to match the rounded session total so the UI is consistent.
        for (let wi = 0; wi < safePlan.weeks.length; wi++) {
          const week = safePlan.weeks[wi]
          const floor5 = (km: number) => Math.floor(km * 2) / 2  // round DOWN to nearest 0.5 km

          // Step 0: cap recovery week targetKm at 80% of previous week's final targetKm.
          // The AI often ignores our suggested 80% and outputs the same km as W1.
          const isRecovery = wi > 0 && (
            /recovery|deload|rest/i.test(week.theme ?? "") ||
            week.targetKm >= safePlan.weeks[wi - 1].targetKm  // last week should always taper
          )
          if (isRecovery && wi === safePlan.weeks.length - 1) {
            const prevTargetKm = safePlan.weeks[wi - 1].targetKm
            const cap = Math.floor(prevTargetKm * 0.8)
            if (week.targetKm > cap) week.targetKm = cap
          }

          // Scale sessions to targetKm if they deviate significantly
          const rawDistances = week.sessions.map((s: { distance: string }) => parseSessionDistanceKm(s.distance))
          const rawTotal = rawDistances.reduce((a: number, b: number) => a + b, 0)
          if (rawTotal > 0 && Math.abs(rawTotal - week.targetKm) > week.targetKm * 0.05) {
            const scale = week.targetKm / rawTotal
            week.sessions.forEach((s: { distance: string }, i: number) => {
              s.distance = `${Math.round(rawDistances[i] * scale * 10) / 10} km`
            })
          }

          // Swap label so "Long run" is on the longest session
          const longRunIdx = week.sessions.findIndex((s: { type: string }) => /long/i.test(s.type))
          if (longRunIdx !== -1) {
            const d = week.sessions.map((s: { distance: string }) => parseSessionDistanceKm(s.distance))
            const maxIdx = d.indexOf(Math.max(...d))
            if (maxIdx !== longRunIdx) {
              const tmp = week.sessions[longRunIdx].type
              week.sessions[longRunIdx].type = week.sessions[maxIdx].type
              week.sessions[maxIdx].type = tmp
            }
          }

          // Round all sessions DOWN to 0.5 km; long run absorbs remainder
          const longIdx = week.sessions.findIndex((s: { type: string }) => /long/i.test(s.type))
          const scaled = week.sessions.map((s: { distance: string }) => parseSessionDistanceKm(s.distance))
          const otherTotal = scaled.reduce((sum: number, km: number, i: number) => i === longIdx ? sum : sum + floor5(km), 0)
          week.sessions.forEach((s: { distance: string }, i: number) => {
            s.distance = i === longIdx
              ? `${floor5(week.targetKm - otherTotal)} km`
              : `${floor5(scaled[i])} km`
          })

          // Update targetKm to match rounded session total
          week.targetKm = week.sessions.reduce((sum: number, s: { distance: string }) => sum + parseSessionDistanceKm(s.distance), 0)
        }

        // Cache in DB (upsert — one active plan per goal)
        // Use service-role client here because the cookie-based client may
        // have lost its auth context inside the ReadableStream callback
        // (cookies() from next/headers is only available during initial request handling).
        const service = createServiceClient()
        const generatedAt = new Date().toISOString()

        // Re-fetch existing plan via service client for archiving
        const { data: currentPlan } = await service
          .from("ai_training_plans")
          .select("plan, generated_at, adjust_note, block_start_date, previous_plans, session_completions:session_completions(session_key, status)")
          .eq("goal_id", goalId)
          .eq("user_id", user.id)
          .maybeSingle()

        // Compute block start date:
        // - If a previous plan exists, start the Monday after its last week ends
        // - Otherwise, use the Monday of the current week
        let blockStartDate: string
        if (currentPlan?.block_start_date && currentPlan?.plan) {
          const prevBlockStart = new Date(currentPlan.block_start_date)
          // Align to Monday
          const day = prevBlockStart.getDay()
          const diff = day === 0 ? -6 : 1 - day
          prevBlockStart.setDate(prevBlockStart.getDate() + diff)
          const prevWeekCount = (currentPlan.plan as TrainingPlan).weeks.length
          const nextBlockStart = new Date(prevBlockStart)
          nextBlockStart.setDate(nextBlockStart.getDate() + prevWeekCount * 7)
          // If the computed next start is in the past, use this Monday instead
          const today = new Date()
          const todayMonday = new Date(today)
          const todayDay = todayMonday.getDay()
          const todayDiff = todayDay === 0 ? -6 : 1 - todayDay
          todayMonday.setDate(todayMonday.getDate() + todayDiff)
          blockStartDate = (nextBlockStart >= todayMonday ? nextBlockStart : todayMonday)
            .toISOString().split("T")[0]
        } else {
          const today = new Date()
          const day = today.getDay()
          const diff = day === 0 ? -6 : 1 - day
          today.setDate(today.getDate() + diff)
          blockStartDate = today.toISOString().split("T")[0]
        }

        const previousPlans = Array.isArray(currentPlan?.previous_plans)
          ? currentPlan.previous_plans
          : []

        if (currentPlan?.plan) {
          // Archive summary data + session completion statuses to preserve adherence history
          const prevPlan = currentPlan.plan as TrainingPlan
          const sessionCompletions = Array.isArray(currentPlan.session_completions)
            ? Object.fromEntries(
                (currentPlan.session_completions as Array<{ session_key: string; status: string }>)
                  .map((sc) => [sc.session_key, sc.status])
              )
            : {}
          previousPlans.unshift({
            summary: prevPlan.summary,
            weeks: prevPlan.weeks.map((w: TrainingWeek) => ({
              weekNumber: w.weekNumber,
              theme: w.theme,
              targetKm: w.targetKm,
              sessionCount: w.sessions.length,
            })),
            generated_at: currentPlan.generated_at,
            adjust_note: currentPlan.adjust_note ?? null,
            block_start_date: currentPlan.block_start_date,
            sessionCompletions,
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
              // Clear any prior checkpoint — new block starts fresh
              mid_block_checkpoint: null,
            },
            { onConflict: "goal_id" }
          )

        if (upsertError) {
          console.error("Failed to cache training plan:", upsertError)
          send({ status: "error", error: "Plan was generated but failed to save. Please try again." })
          return
        }

        // Migrate session completions from old plan to new plan by matching on week + session type.
        // This preserves "completed" / "skipped" marks when regenerating with an adjust note,
        // rather than wiping all progress on every regen.
        const oldCompletions = Array.isArray(currentPlan?.session_completions)
          ? (currentPlan.session_completions as Array<{ session_key: string; status: string }>)
          : []
        const oldPlan = currentPlan?.plan as TrainingPlan | undefined
        const migratedRows: Array<{ goal_id: string; user_id: string; session_key: string; status: string; updated_at: string }> = []

        if (oldPlan && oldCompletions.length > 0) {
          // Build a type-normalizer so "Long Run" and "long run" match
          const norm = (s: string) => s.toLowerCase().trim()

          // Index new plan sessions by week number for fast lookup
          const newSessionsByWeek = new Map<number, string[]>() // weekNumber → [normalizedType, ...]
          for (const week of safePlan.weeks) {
            newSessionsByWeek.set(week.weekNumber, week.sessions.map((s) => norm(s.type)))
          }

          // Track which new session slots are already claimed (to avoid double-counting)
          const claimed = new Map<string, boolean>()

          for (const comp of oldCompletions) {
            if (comp.status === "planned") continue // default state — skip
            const keyMatch = comp.session_key.match(/^W(\d+)-(\d+)$/)
            if (!keyMatch) continue
            const weekNum = parseInt(keyMatch[1], 10)
            const sessionIdx = parseInt(keyMatch[2], 10)

            // Find the old session type for this key
            const oldWeek = oldPlan.weeks.find((w) => w.weekNumber === weekNum)
            if (!oldWeek || sessionIdx >= oldWeek.sessions.length) continue
            const oldType = norm(oldWeek.sessions[sessionIdx].type)

            // Find a matching session in the new plan at the same week (by type)
            const newTypes = newSessionsByWeek.get(weekNum)
            if (!newTypes) continue
            const newIdx = newTypes.findIndex((t, i) => t === oldType && !claimed.get(`W${weekNum}-${i}`))
            if (newIdx === -1) continue // no matching session in new plan

            const newKey = `W${weekNum}-${newIdx}`
            claimed.set(newKey, true)
            migratedRows.push({
              goal_id: goalId,
              user_id: user.id,
              session_key: newKey,
              status: comp.status,
              updated_at: new Date().toISOString(),
            })
          }
        }

        // Delete all old completions then re-insert migrated ones
        const { error: deleteError } = await service
          .from("session_completions")
          .delete()
          .eq("goal_id", goalId)
        if (deleteError) {
          console.warn(`[plan] Failed to clean up session completions for goal ${goalId}:`, deleteError)
        }
        if (migratedRows.length > 0) {
          const { error: migrateError } = await service
            .from("session_completions")
            .upsert(migratedRows, { onConflict: "goal_id,session_key" })
          if (migrateError) {
            console.warn(`[plan] Failed to migrate session completions for goal ${goalId}:`, migrateError)
          } else {
            console.log(`[plan] Migrated ${migratedRows.length} session completions for goal ${goalId}`)
          }
        }

        send({
          status: "done",
          plan: safePlan,
          block_start_date: blockStartDate,
          generated_at: generatedAt,
          pace_source: paceGuide.source,
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

  const twelveWeeksAgo = new Date()
  twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 84)

  // Fetch plan, goal, activities and test runs in parallel for pace enrichment
  const [{ data: planRow }, { data: goal }, { data: activities }, { data: testRuns }] = await Promise.all([
    supabase
      .from("ai_training_plans")
      .select("plan, block_start_date, generated_at, previous_plans, mid_block_checkpoint")
      .eq("goal_id", goalId)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("goals")
      .select("target_distance_km")
      .eq("id", goalId)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("activities")
      .select("type, date, distance_km, duration_seconds, pace_min_per_km, avg_heart_rate, elevation_gain_m")
      .eq("user_id", user.id)
      .gte("date", twelveWeeksAgo.toISOString())
      .order("date", { ascending: false })
      .limit(500),
    supabase
      .from("test_runs")
      .select("derived_metrics, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10),
  ])

  if (!planRow) return NextResponse.json({ plan: null })

  // Enrich cached plan sessions with suggestedPace if goal + activity data available
  let enrichedPlan = planRow.plan
  if (enrichedPlan && goal?.target_distance_km) {
    const acts = activities ?? []
    const runActs = acts.filter((a) => RUN_TYPES.has((a as { type?: string }).type ?? ""))
    const actsWithPace = runActs.filter((a) => a.pace_min_per_km && Number(a.pace_min_per_km) > 0)
    const recentEasyPace = actsWithPace.length > 0
      ? actsWithPace
          .map((a) => Number(a.pace_min_per_km))
          .sort((a, b) => b - a)
          .slice(0, Math.ceil(actsWithPace.length * 0.5))
          .reduce((s, p, _, arr) => s + p / arr.length, 0)
      : null

    const { predictions: racePredictions } = predictRaceTimes(runActs as unknown as Activity[])
    const paceGuide = buildPaceGuide(racePredictions, testRuns ?? [], goal.target_distance_km, recentEasyPace)

    // Re-evaluate fatigue and athlete level against current activity data
    const fatigue = detectFatigue(runActs as unknown as SafetyActivity[])
    const athleteLevel = classifyAthleteLevel(runActs as unknown as SafetyActivity[])
    const hardFatigueModifier =
      fatigue.signal === "both"          ? 1.12 :
      fatigue.signal === "hr_elevated"   ? 1.05 :
      fatigue.signal === "pace_declining" ? 1.08 :
      1.0

    const plan = enrichedPlan as TrainingPlan
    enrichedPlan = {
      ...plan,
      weeks: plan.weeks.map((week, weekIdx) => {
        const prevWeek = plan.weeks[weekIdx - 1] ?? null
        const isRecovery =
          /recovery|deload/i.test(week.theme ?? "") ||
          (prevWeek != null && week.targetKm < prevWeek.targetKm * 0.85)

        const progressionRate = PACE_PROGRESSION_RATES[athleteLevel] ?? PACE_PROGRESSION_RATES.intermediate
        const weekIndex = Math.min(week.weekNumber - 1, PACE_PROGRESSION_MAX_WEEKS - 1)
        const progressionModifier = 1.0 - weekIndex * progressionRate

        return {
          ...week,
          sessions: week.sessions.map((session) => {
            const zone = session.type.toLowerCase()
            const isHardSession = /tempo|threshold|interval|track|speed|fartlek|repeat|vo2/.test(zone)
            const modifier = isRecovery
              ? 1.10
              : isHardSession
                ? (fatigue.signal !== "none" ? hardFatigueModifier : progressionModifier)
                : 1.0
            return {
              ...session,
              suggestedPace: assignSessionPace(session.type, paceGuide, modifier) ?? session.suggestedPace,
            }
          }),
        }
      }),
    }
  }

  // Compute whether a checkpoint is due so the UI can prompt the user
  const { isCheckpointDue } = await import("@/lib/training-checkpoint")
  const checkpointDue =
    planRow.plan && planRow.block_start_date
      ? isCheckpointDue(
          planRow.plan as TrainingPlan,
          planRow.block_start_date,
          planRow.mid_block_checkpoint ?? null,
        )
      : false

  // Build pace guide for the enriched plan so we can return the source tier
  const paceGuideForResponse = (() => {
    if (!enrichedPlan || !goal?.target_distance_km) return null
    const runActs2 = (activities ?? []).filter((a) => RUN_TYPES.has((a as { type?: string }).type ?? ""))
    const actsWithPace2 = runActs2.filter((a) => a.pace_min_per_km && Number(a.pace_min_per_km) > 0)
    const easyPace2 = actsWithPace2.length > 0
      ? actsWithPace2
          .map((a) => Number(a.pace_min_per_km))
          .sort((a, b) => b - a)
          .slice(0, Math.ceil(actsWithPace2.length * 0.5))
          .reduce((s, p, _, arr) => s + p / arr.length, 0)
      : null
    const { predictions: preds } = predictRaceTimes(runActs2 as unknown as Activity[])
    return buildPaceGuide(preds, testRuns ?? [], goal.target_distance_km, easyPace2)
  })()

  return NextResponse.json({
    plan: enrichedPlan,
    block_start_date: planRow.block_start_date,
    generated_at: planRow.generated_at,
    previous_plans: planRow.previous_plans ?? [],
    mid_block_checkpoint: planRow.mid_block_checkpoint ?? null,
    checkpoint_due: checkpointDue,
    pace_source: paceGuideForResponse?.source ?? "none",
  })
}

const PreferencesSchema = z.object({
  goalId: z.string().uuid(),
  sessions_per_week: z.number().int().min(1).max(14),
  focus: z.enum(["volume", "workouts", "balanced"]),
  notes: z.string().max(500).nullable().optional(),
  injury_notes: z.string().max(500).nullable().optional(),
  weekly_increase_pct: z.number().min(0).max(25).default(10),
  block_weeks: z.number().int().min(1).max(20).default(4),
  regenerate_every_weeks: z.number().int().min(1).max(12).default(4),
  plan_mode: z.enum(["block", "full_cycle"]).default("block"),
})

// PUT — save/update preferences for a goal
export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = PreferencesSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
  }

  const { goalId, sessions_per_week, focus, notes, injury_notes, weekly_increase_pct, block_weeks, regenerate_every_weeks, plan_mode } = parsed.data

  // Fetch current prefs + active plan to compare notes and capture block context
  const [{ data: currentPrefs }, { data: activePlan }] = await Promise.all([
    supabase
      .from("goal_preferences")
      .select("notes, injury_notes, notes_history")
      .eq("goal_id", goalId)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("ai_training_plans")
      .select("plan, block_start_date")
      .eq("goal_id", goalId)
      .eq("user_id", user.id)
      .maybeSingle(),
  ])

  // Build block context snapshot for any notes that changed
  const now = new Date().toISOString()
  const existingHistory: NoteHistoryEntry[] = (currentPrefs as any)?.notes_history ?? []
  const newEntries: NoteHistoryEntry[] = []

  const plan = activePlan?.plan as { weeks?: Array<{ targetKm?: number }> } | null
  const blockStartDate = activePlan?.block_start_date ?? null
  let blockWeekIndex: number | null = null
  let blockTotalWeeks: number | null = null
  let weeklyKmTarget: number | null = null

  if (plan?.weeks && blockStartDate) {
    const msPerWeek = 7 * 24 * 60 * 60 * 1000
    blockWeekIndex = Math.floor((Date.now() - new Date(blockStartDate).getTime()) / msPerWeek)
    blockTotalWeeks = plan.weeks.length
    if (blockWeekIndex >= 0 && blockWeekIndex < blockTotalWeeks) {
      weeklyKmTarget = plan.weeks[blockWeekIndex]?.targetKm ?? null
    } else {
      blockWeekIndex = null // outside the block
    }
  }

  const blockContext = {
    block_start_date: blockStartDate,
    block_week: blockWeekIndex !== null ? blockWeekIndex + 1 : null,
    block_total_weeks: blockTotalWeeks,
    training_phase:
      blockWeekIndex !== null && blockTotalWeeks !== null
        ? getPhaseLabel(blockWeekIndex, blockTotalWeeks)
        : null,
    weekly_km_target: weeklyKmTarget,
    sessions_per_week,
  }

  const prevNotes = currentPrefs?.notes ?? null
  const prevInjuryNotes = (currentPrefs as any)?.injury_notes ?? null

  if ((notes || null) !== prevNotes && notes) {
    newEntries.push({ content: notes, type: "coach", added_at: now, resolved_at: null, ...blockContext })
  }
  if ((injury_notes || null) !== prevInjuryNotes && injury_notes) {
    newEntries.push({ content: injury_notes, type: "injury", added_at: now, resolved_at: null, ...blockContext })
  }

  const updatedHistory = newEntries.length > 0 ? [...existingHistory, ...newEntries] : existingHistory

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

  // injury_notes and notes_history live in columns added by later migrations — update separately
  // so a missing column doesn't break the whole preferences save.
  if (!error) {
    await supabase
      .from("goal_preferences")
      .update({ injury_notes: injury_notes || null, notes_history: updatedHistory })
      .eq("goal_id", goalId)
      .eq("user_id", user.id)
      .then(({ error: injErr }) => {
        if (injErr) console.warn("Could not persist injury_notes/notes_history (migration may not be applied):", injErr.message)
      })
  }

  if (error) {
    console.error("Failed to save goal preferences:", error)
    return NextResponse.json({ error: error.message ?? "Failed to save preferences" }, { status: 500 })
  }

  // plan_mode lives in a column added by a later migration — update it separately
  // so a missing column doesn't break the whole save.
  const { error: modeError } = await supabase
    .from("goal_preferences")
    .update({ plan_mode: plan_mode ?? "block" })
    .eq("goal_id", goalId)
    .eq("user_id", user.id)

  if (modeError) {
    console.warn("Could not persist plan_mode (migration may not be applied):", modeError.message)
  }

  return NextResponse.json({ ok: true })
}
