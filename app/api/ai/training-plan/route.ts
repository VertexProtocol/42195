import { NextRequest, NextResponse } from "next/server"
import { anthropic } from "@/lib/anthropic"
import { logAiUsage } from "@/lib/ai-usage"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { checkAiRateLimit, rateLimitExceededResponse } from "@/lib/ai-rate-limit"
import type { Activity, GoalPreferences, TrainingPlan, TrainingWeek } from "@/lib/types"
import {
  detectFatigue,
  classifyAthleteLevel,
  evaluateAcwrSafety,
  checkProlongedFatigue,
  checkFrequencyProgression,
  computeRecentWeeklyVolumes,
  type SafetyActivity,
} from "@/lib/training-safety"
import { computeWeeklyTargets } from "@/lib/training-volume"
import {
  allocateSessionDistances,
  formatSessionDistance,
  supportedSessionCount,
} from "@/lib/training-sessions"
import { analyzeHeartRateZones } from "@/lib/hr-analysis-engine"
import { computeTrainingTimeline } from "@/lib/training-timeline"
import { predictRaceTimes } from "@/lib/training-utils"
import { buildPaceGuide, assignSessionPace, planNeedsPaces } from "@/lib/pace-guide"
import {
  PACE_PROGRESSION_RATES,
  PACE_PROGRESSION_MAX_WEEKS,
  RUN_TYPES,
  PLAN_REGENERATE_COOLDOWN_MS,
  RECOVERY_WEEK_THRESHOLD,
  FITNESS_ANALYSIS_WEEKS,
} from "@/lib/training-constants"
import { type NoteHistoryEntry, formatNotesHistoryForPrompt, hasActiveInjury } from "@/lib/notes-history"
import { racePhase, daysUntil } from "@/lib/training-phase"
import { assessComeback, type ComebackRecommendation } from "@/lib/training-comeback"

/**
 * What Claude returns. Deliberately carries no numbers: weekly volume and
 * session distances are computed in lib/training-volume.ts and
 * lib/training-sessions.ts, before and after the model call respectively.
 *
 * Everything the model used to emit as a number was overwritten downstream
 * anyway — by the safety engine, the comeback cap and a final correction pass —
 * so asking for it bought nothing but thinking tokens and an internally
 * inconsistent plan, where the summary described volumes the runner never got.
 * What the model is genuinely good at, and what it still owns, is the shape of
 * a week: which session types, at what effort, and why.
 */
const PlanDraftSchema = z.object({
  summary: z.string(),
  weeks: z.array(
    z.object({
      weekNumber: z.number(),
      theme: z.string(),
      sessions: z.array(
        z.object({
          type: z.string(),
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

type PlanDraft = z.infer<typeof PlanDraftSchema>

/** JSON Schema mirror of PlanDraftSchema for the structured-outputs request. */
const PLAN_DRAFT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "weeks", "keyPrinciples", "watchOut"],
  properties: {
    summary: { type: "string", description: "2-3 sentences on this block and its purpose, personalised to the runner" },
    weeks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["weekNumber", "theme", "sessions", "coachNote"],
        properties: {
          weekNumber: { type: "integer" },
          theme: { type: "string", description: "Short phrase describing this week's focus" },
          sessions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["type", "effort", "purpose"],
              properties: {
                type: { type: "string", description: "Session name, e.g. Long run, Base run, Tempo run" },
                effort: { type: "string", description: "How it should feel, in the runner's language" },
                purpose: { type: "string", description: "What this session is for" },
              },
            },
          },
          coachNote: {
            anyOf: [{ type: "string" }, { type: "null" }],
            description: "Optional tip or warning for this week, or null",
          },
        },
      },
    },
    keyPrinciples: { type: "array", items: { type: "string" } },
    watchOut: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "One thing to watch out for given this runner's history, or null",
    },
  },
} as const

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

/**
 * Cacheable system prompt — identical for all users, so it stays cheap to reuse
 * across requests.
 *
 * Scope note: this used to also specify session distances, minimum lengths, the
 * long-run share of the week and session ordering. All of that is now computed
 * in code (lib/training-volume.ts, lib/training-sessions.ts), so restating it
 * here would only be a rule the model can't affect. What remains is the part
 * that genuinely shapes the plan: which session types to reach for, and how to
 * balance intensity across a week.
 */
const COACHING_SYSTEM_PROMPT = `You are an expert running coach designing training blocks for runners preparing for races.

## Session Types
The session name communicates purpose, not just effort. Choose from:
- **Long run** — the week's longest run, at easy/Z2 pace. Every week should have exactly one.
- **Base run** — medium-length easy run. The workhorse of aerobic training, and the right default for most sessions.
- **Recovery run** — short and very easy. Fits the day after a hard session or a long run.
- **Progression run** — starts easy, finishes the last 20-30% at tempo effort. Good mid-block variety.
- **Tempo run** — sustained threshold effort. At most 2 a week, and rarely during base-building.
- **Intervals** — structured speed work with rest, e.g. 6 x 800 m. Build and peak phases.
- **Hill repeats** — short steep uphill efforts with easy jog recovery. Builds strength and form.
- **Fartlek** — unstructured speedplay inside an easy run. Variety without rigid structure.
- **Race pace run** — sustained goal race pace. Peak and sharpening phases, 2-3 weeks out.

Vary the session types across the block. A plan that alternates only between "Long run" and "Easy run" for six weeks is not a training plan.

## Aerobic Base Principle
Fewer, longer easy runs build aerobic fitness more effectively than many short ones. In base-building phases, the weekly long run should be a 60-90 minute effort.

## Intensity Balance
Roughly 80% of weekly volume belongs at easy, conversational effort and 20% at moderate-to-hard. That means at most two quality sessions (tempo, intervals, race pace) in a week, and no two hard efforts described as back-to-back days.

## Your Output
Weekly volume and session distances are already fixed and will be given to you — you do not choose them and should not restate them as numbers. Your job is the shape and the coaching: which session types make up each week, how each should feel, what it is for, and what this runner in particular should know.

The "effort" field is how the session should feel, in the runner's language. The "purpose" field is what it is for. Write the summary and coach notes to match the volumes you are given.`

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
  weekTargets: number[],
  weekSessionCounts: number[],
  acwr?: { ratio: number; risk: string },
  recentEasyPace?: number | null,
  recentBestPace?: number | null,
  previousPlanSummary?: string | null,
  hrSummary?: string | null,
  testRunSection?: string | null,
  blockPosition?: { blockNum: number; totalBlocks: number; phaseName: string; weekInPlan: number; totalWeeks: number } | null,
  comeback?: ComebackRecommendation,
): string {
  // Only the elevated tiers argue for cutting volume. "detraining" is also
  // "not low", and telling the coach to reduce a runner who is already under
  // their own baseline is the opposite of what that tier means.
  const acwrNote = !acwr
    ? ""
    : acwr.risk === "moderate" || acwr.risk === "high" || acwr.risk === "unsafe"
      ? " — consider reducing volume this week"
      : acwr.risk === "detraining"
        ? " — running under their own baseline; rebuild toward it rather than cutting further"
        : ""

  const focusDescription = {
    volume: "hitting weekly km targets — sessions are flexible, no fixed structure required",
    workouts: "structured sessions (long run, tempo, easy runs with clear purpose)",
    balanced: "a mix of structured sessions and flexible volume targets",
  }[prefs.focus]

  // What the focus preference actually changes about the plan. It used to change
  // only the adjective above, which made "sessions are flexible" a promise the
  // pipeline never kept.
  const focusInstruction = {
    volume: `This runner asked for volume over structure. Keep the session types simple — long runs, base runs and recovery runs. Do not prescribe tempo, intervals, hill repeats or race-pace work; they came here for kilometres, not a workout schedule. Some weeks below carry fewer sessions than others: that is deliberate, and it is how a small week gets runs worth doing instead of a handful of token jogs.`,
    workouts: `This runner asked for structure. Vary the session types across the block and give each week a clear shape, including quality work — tempo, intervals, hill repeats or fartlek — wherever the training phase supports it, up to the two-per-week ceiling. Every session should be recognisably different from the others in its week.`,
    balanced: `Mix structure with flexibility. Most sessions should be easy base and long runs; add quality work where the phase clearly calls for it, and keep it to one or two sessions a week.`,
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

  const blockWeeks = weekTargets.length
  const recentWindow = FITNESS_ANALYSIS_WEEKS

  const weekTargetLines = weekTargets
    .map((km, i) => {
      const sessions = weekSessionCounts[i]
      const plural = sessions === 1 ? "session" : "sessions"
      const recovery = i === blockWeeks - 1 && blockWeeks > 1 ? " (recovery week)" : ""
      return `- Week ${i + 1}: ${km} km across ${sessions} ${plural}${recovery}`
    })
    .join("\n")

  // Compute volume trend: compare recent window vs the equal-length prior window.
  // Divide by the weeks we actually have, not the nominal window — dividing 2
  // weeks of history by a 4-week window halved the prior average and reported a
  // stable runner as "+150% upward".
  const priorWeeks = weeklySummaries.slice(recentWindow, recentWindow * 2)
  let trendLine: string
  if (priorWeeks.length === 0) {
    trendLine = "not enough history yet (first training period)"
  } else {
    const priorAvg = priorWeeks.reduce((s, w) => s + w.totalKm, 0) / priorWeeks.length
    const pct = priorAvg > 0 ? Math.round(((currentAvgWeeklyKm - priorAvg) / priorAvg) * 100) : 0
    const arrow = `${priorAvg.toFixed(1)} → ${currentAvgWeeklyKm.toFixed(1)} km/week`
    if (pct > 10) trendLine = `upward — ${arrow} (+${pct}%)`
    else if (pct < -10) trendLine = `downward — ${arrow} (${pct}%)`
    else trendLine = `stable — ${arrow} (${pct > 0 ? "+" : ""}${pct}%)`
  }

  const phase = racePhase(daysUntilRace)

  const taperNote = phase === "taper"
    ? "\n\nThe runner is in the taper. The volumes below already reflect that — keep the sessions short and sharp, and write the notes around rest and race-day readiness."
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
- Sessions per week: ${prefs.sessions_per_week} (requested; the per-week counts below are what to actually plan for)
- Focus: ${focusDescription}

${focusInstruction}
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
${adjustSection}${blockPositionSection}${previousPlanSection}${hrSection}${testRunPromptSection}${(() => {
  if (!comeback?.needsRamp) return ""
  const categoryLabel: Record<string, string> = {
    short: "short (7-10 days)",
    moderate: "moderate (11-14 days)",
    long: "long (15-21 days)",
    extended: "extended (22-28 days)",
    rebuild: "rebuild (over 28 days)",
  }
  const catText = categoryLabel[comeback.category] ?? comeback.category
  const limitingFactorNote = comeback.limitingFactor === "acwr"
    ? " (tightened further by acute:chronic workload ratio safety)"
    : comeback.limitingFactor === "injury"
      ? " (tightened further because an injury is still active)"
      : ""
  return `
## Returning After a Pause
The runner is coming back from a ${comeback.pauseDays}-day pause — classified as ${catText}${limitingFactorNote}. Week 1's volume below is already capped for that.
Keep every Week 1 session easy or moderate — no tempo, intervals or race-pace work that week.
`
})()}
## Recent Training History (most recent first)
${weekSummaryText}

## Current Fitness Snapshot
- Avg weekly km (last ${recentWindow} weeks): ${currentAvgWeeklyKm.toFixed(1)} km
- Volume trend vs prior ${recentWindow} weeks: ${trendLine}
- Longest recent run: ${longestRecentRun.toFixed(1)} km${goal.target_distance_km > longestRecentRun ? ` (goal: ${goal.target_distance_km} km — long run ceiling for this block: ${Math.min(longestRecentRun + blockWeeks * 2, goal.target_distance_km * 0.85).toFixed(1)} km)` : ""}${recentEasyPace ? `\n- Recent easy pace: ${formatPace(recentEasyPace)} (average of slower 50% of runs)` : ""}${recentBestPace ? `\n- Recent best pace: ${formatPace(recentBestPace)} (fastest run)` : ""}${acwr ? `\n- Injury risk (ACWR): ${acwr.ratio.toFixed(2)} (${acwr.risk})${acwrNote}` : ""}

## Weekly Volume (fixed)
These are the volumes for this block. They already account for the runner's rolling average, injury-risk load, any recent pause, and the progression limits for their level, so treat them as settled — write the summary and coach notes to match them rather than proposing different numbers.
${weekTargetLines}

Do not assign sessions to particular days of the week; the runner fits them in where they can. Give exactly ${blockWeeks} ${blockWeeks === 1 ? "week" : "weeks"}, each with the session count listed above.`
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
    const elapsed = Date.now() - lastGen
    if (elapsed < PLAN_REGENERATE_COOLDOWN_MS) {
      const waitSecs = Math.ceil((PLAN_REGENERATE_COOLDOWN_MS - elapsed) / 1000)
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
  const recentAvgWeeklyKm =
    weeklySummaries.slice(0, FITNESS_ANALYSIS_WEEKS).reduce((s, w) => s + w.totalKm, 0) /
    FITNESS_ANALYSIS_WEEKS

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

  const daysUntilRace = daysUntil(goal.target_date)

  // Reject plans for past target dates. A target_date in the past collapses
  // maxWeeksUntilRace to 0 downstream, producing a degenerate empty plan and
  // wasting a Claude call. Front-end shouldn't allow it, but the API also
  // has to be safe when called directly.
  if (daysUntilRace <= 0) {
    return NextResponse.json(
      {
        error:
          "Cannot generate a plan — the race date has already passed. Update the goal's target date before regenerating.",
      },
      { status: 400 },
    )
  }

  // Rate limit last: every check above can reject the request without calling
  // Claude, and a rejected request must not consume one of the user's hourly
  // AI calls. Spending the quota on a cooldown 429 was the old behaviour.
  const rateLimit = await checkAiRateLimit(user.id)
  if (!rateLimit.allowed) return rateLimitExceededResponse(rateLimit)

  // Compute ACWR and safety metrics from running activities only — cycling/hiking inflate
  // chronic load and cause the plan generator to produce overly conservative running plans.
  const acts = activities ?? []
  const runActs = acts.filter((a) => RUN_TYPES.has(a.type))
  // One ACWR implementation. This route used to compute its own with different
  // thresholds (>1.5 high, >1.3 moderate) than the safety engine it fed into,
  // so a runner at 1.15 was described to the coach as "low" while the engine
  // treated them as moderate and cut week one by 5%.
  const safetyActs = runActs as unknown as SafetyActivity[]
  const acwrSafety = evaluateAcwrSafety(safetyActs)
  const athleteLevel = classifyAthleteLevel(safetyActs)
  const prolongedFatigue = checkProlongedFatigue(safetyActs)
  const fatigue = detectFatigue(safetyActs)
  const frequencyWarning = checkFrequencyProgression(safetyActs, prefs.sessions_per_week)

  // Comeback volume cap: when the runner has paused >= 7 days, compute a
  // deterministic week-one volume ceiling.
  const comeback = assessComeback(
    runActs.map((a) => ({ date: a.date, distance_km: Number(a.distance_km) })),
    hasActiveInjury(prefs.notes_history),
  )

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

  // Build heart rate summary for the prompt, including HR zone boundaries.
  // HR stats must be run-only — cycling hits much higher sustained HR than
  // running so including it inflates maxHr and the derived zone boundaries,
  // which would make Claude's intensity prescriptions too conservative.
  const actsWithHr = runActs.filter((a) => a.avg_heart_rate && Number(a.avg_heart_rate) > 0)
  let hrSummary: string | null = null
  if (actsWithHr.length > 0) {
    const avgHr = Math.round(actsWithHr.reduce((s, a) => s + Number(a.avg_heart_rate), 0) / actsWithHr.length)
    const maxHr = Math.max(...actsWithHr.map((a) => Number(a.avg_heart_rate)))
    const recentHrs = actsWithHr.slice(0, 5).map((a) => Number(a.avg_heart_rate))
    const recentAvgHr = Math.round(recentHrs.reduce((s, h) => s + h, 0) / recentHrs.length)
    const hrTrend = recentAvgHr > avgHr + 5 ? "elevated (possible fatigue)" : recentAvgHr < avgHr - 5 ? "lower than average (good fitness)" : "stable"
    hrSummary = `- Average heart rate across runs: ${avgHr} bpm\n- Highest average HR recorded: ${maxHr} bpm\n- Recent HR trend (last 5 runs): ${recentAvgHr} bpm avg — ${hrTrend}\n- Estimated max HR: ~${Math.round(maxHr * 1.1)} bpm (from activity data)`

    // Add HR zone boundaries from the analysis engine if we have enough data.
    // Pass runActs (not all activities) so zones reflect running HR only.
    if (actsWithHr.length >= 5) {
      const hrAnalysis = analyzeHeartRateZones(
        runActs.map((a) => ({
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
    // Running only — counting a bike ride toward a running block reports
    // adherence the runner never earned, and the prompt acts on that number.
    const acts12 = runActs

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

  // Weekly volume is settled here, before the prompt — so the plan Claude
  // describes is the plan the runner gets. Previously the targets were a
  // suggestion that three later passes revised, leaving summary and coach notes
  // talking about volumes that no longer existed.
  const maxWeeksUntilRace = Math.max(1, Math.floor(daysUntilRace / 7))
  const blockWeeks = Math.min(prefs.block_weeks ?? 4, maxWeeksUntilRace)

  const { targets: weekTargets, notes: volumeNotes } = computeWeeklyTargets({
    avgWeeklyKm: currentAvgWeeklyKm,
    blockWeeks,
    sessionsPerWeek: prefs.sessions_per_week,
    longestRecentRun,
    increasePct: prefs.weekly_increase_pct ?? 10,
    athleteLevel,
    acwr: acwrSafety,
    prolongedFatigue,
    comeback,
    priorWeeklyVolumes: computeRecentWeeklyVolumes(safetyActs, 3),
  })

  if (volumeNotes.length > 0) {
    console.log(`[plan-volume] goal ${goalId} (${athleteLevel}):`, volumeNotes)
  }

  // How many sessions each week can actually carry. Only differs from the
  // requested count in "volume" focus, where a week too small for the count
  // trades sessions for length rather than prescribing runs too short to matter.
  const weekSessionCounts = weekTargets.map((km) =>
    supportedSessionCount(km, prefs.sessions_per_week, prefs.focus),
  )
  const reducedWeeks = weekSessionCounts.filter((n) => n < prefs.sessions_per_week).length
  if (reducedWeeks > 0) {
    console.log(
      `[plan-volume] goal ${goalId}: ${reducedWeeks} week(s) carry fewer than ` +
      `${prefs.sessions_per_week} sessions (focus: ${prefs.focus})`,
    )
  }

  const prompt = buildPrompt(
    goal,
    prefs,
    weeklySummaries,
    longestRecentRun,
    currentAvgWeeklyKm,
    daysUntilRace,
    adjustNote,
    weekTargets,
    weekSessionCounts,
    { ratio: acwrSafety.ratio, risk: acwrSafety.risk },
    recentEasyPace,
    recentBestPace,
    previousPlanSummary,
    hrSummary,
    testRunSection,
    blockPositionArg,
    comeback,
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
          model: "claude-opus-5",
          // Thinking counts against max_tokens. The old pairing — a budget of up
          // to 8000 inside a 10000 ceiling — left ~2000 tokens for the plan
          // itself, which truncated longer blocks and surfaced as a JSON parse
          // failure rather than as the token limit it was.
          max_tokens: 32000,
          thinking: { type: "adaptive" },
          output_config: {
            effort: "high",
            format: {
              type: "json_schema" as const,
              schema: PLAN_DRAFT_JSON_SCHEMA,
            },
          },
          // Measured at 1528 tokens (system prompt plus the output schema, which
          // shares the cacheable prefix) against Opus 5's 512-token minimum, and
          // confirmed against the API: repeat generations report a 1530-token
          // cache read. See scripts/smoke/smoke.mjs tokens.
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

        logAiUsage("training-plan", message.usage, { goalId })

        if (message.stop_reason === "max_tokens") {
          throw new Error("Response hit the output token limit before the plan was complete")
        }

        const textBlock = message.content.find((b: { type: string }) => b.type === "text")
        if (!textBlock || textBlock.type !== "text") throw new Error("No text block in Claude response")

        // Structured outputs guarantees the response matches the schema, so this
        // is a type guard rather than the parse-and-hope it replaced (regex for a
        // JSON-looking substring, then JSON.parse, then validation, each with its
        // own failure path).
        const parsed = PlanDraftSchema.safeParse(
          JSON.parse((textBlock as { type: "text"; text: string }).text),
        )
        if (!parsed.success) {
          console.error("[plan-generation] Draft failed schema validation:", parsed.error.message)
          throw new Error(`Invalid plan structure: ${parsed.error.message}`)
        }
        const draft: PlanDraft = parsed.data

        if (draft.weeks.length !== weekTargets.length) {
          console.warn(
            `[plan-validation] Claude returned ${draft.weeks.length} weeks, expected ${weekTargets.length}`,
          )
        }

        // Assemble the plan: Claude's weekly shape, the volume computed before
        // the prompt, and distances allocated to fit. Weeks beyond the computed
        // targets are dropped rather than given an invented volume.
        const safePlan: TrainingPlan = {
          ...draft,
          weeks: draft.weeks.slice(0, weekTargets.length).map((week, wi) => {
            const targetKm = weekTargets[wi]
            const { distances, belowMinimum } = allocateSessionDistances(
              targetKm,
              week.sessions.map((s) => s.type),
            )
            if (belowMinimum) {
              console.warn(
                `[plan-validation] Week ${wi + 1}: ${week.sessions.length} sessions in a ${targetKm} km week ` +
                `falls below the minimum useful session length (asked for ${weekSessionCounts[wi]})`,
              )
            }
            return {
              weekNumber: wi + 1,
              theme: week.theme,
              targetKm: distances.reduce((sum, d) => sum + d, 0),
              coachNote: week.coachNote,
              sessions: week.sessions.map((session, si) => ({
                ...session,
                distance: formatSessionDistance(distances[si] ?? 0),
              })),
            }
          }),
        }

        // Pace guide: deterministic pace targets per session based on test runs + race predictions
        // Use running activities only so cycling/hiking don't skew Riegel predictions
        const { predictions: racePredictions } = predictRaceTimes(runActs as unknown as Activity[])
        const paceGuide = buildPaceGuide(racePredictions, testRuns ?? [], goal.target_distance_km, recentEasyPace)

        // Fatigue modifier: when the safety signals detect fatigue, pull back hard-session paces
        const fatigueSignal = fatigue.signal
        const hardFatigueModifier =
          fatigueSignal === "both"         ? 1.12 :  // HR + pace both declining → 12% slower
          fatigueSignal === "hr_elevated"  ? 1.05 :  // HR elevated only → 5% slower
          fatigueSignal === "pace_declining"? 1.08 :  // pace declining only → 8% slower
          1.0

        for (const week of safePlan.weeks) {
          // Recovery weeks: all zones run 10% slower to reinforce the lower-stimulus purpose
          const prevWeek = safePlan.weeks[safePlan.weeks.indexOf(week) - 1] ?? null
          const isRecovery = prevWeek != null && week.targetKm < prevWeek.targetKm * RECOVERY_WEEK_THRESHOLD

          // Intra-block progression for quality sessions: rate scaled by athlete level,
          // capped at 6 weeks so tempo targets stay safely below 10K race pace.
          const progressionRate = PACE_PROGRESSION_RATES[athleteLevel] ?? PACE_PROGRESSION_RATES.intermediate
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

        // Paces are settled here along with everything else, so the confidence
        // tier travels with the plan rather than being re-derived on every read.
        safePlan.paceSource = paceGuide.source

        // Signals worth surfacing, none of which change the plan's volume — that
        // was already settled before the prompt.
        const safetyNotes = [
          ...volumeNotes,
          ...(fatigue.description ? [fatigue.description] : []),
          ...(frequencyWarning
            ? [`Frequency increase is aggressive: ${frequencyWarning.currentAvgSessions} sessions/week recently, ` +
               `${frequencyWarning.requestedSessions} requested. Recommended max: ${frequencyWarning.maxSafeSessions}.`]
            : []),
        ]
        if (safetyNotes.length > 0) {
          console.warn(`[safety] goal ${goalId} (level: ${athleteLevel}):`, safetyNotes)
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
          // Log the full plan so ops can recover the generated output if the
          // user chooses not to regenerate. Truncate to keep log size sane.
          const planPreview = JSON.stringify(safePlan).slice(0, 2000)
          console.error(
            "[plan-generation] DB upsert failed — Claude output is not persisted. Error:",
            upsertError,
            "\nGoal:",
            goalId,
            "\nUser:",
            user.id,
            "\nPlan preview:",
            planPreview,
          )
          send({ status: "error", error: "Plan was generated but failed to save. Please try again." })
          return
        }

        // Migrate session completions from old plan to new plan by matching on week + session type.
        // This preserves "completed" / "skipped" marks when regenerating with an adjust note,
        // rather than wiping all progress on every regen.
        //
        // Only valid when the new block covers the SAME calendar weeks as the old one.
        // When block_start_date advances (the normal case — the next block starts after the
        // current one ends), new W1 is a different calendar week than old W1, so carrying a
        // "completed" mark across would mark a session in the future as already done.
        const sameBlockWindow =
          currentPlan?.block_start_date != null &&
          currentPlan.block_start_date === blockStartDate

        const oldCompletions = sameBlockWindow && Array.isArray(currentPlan?.session_completions)
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
          safety: safetyNotes.length === 0 ? null : {
            athleteLevel,
            notes: safetyNotes,
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

  // Paces belong to the plan, and the plan is settled when it is generated —
  // same rule as weekly volume and session distances. Recomputing them on every
  // read meant the plan a runner looked at on Monday could show different
  // targets on Wednesday without them having regenerated anything.
  //
  // So this only fills in what is missing, which is plans generated before
  // paces were assigned at all. When every session already has one, no pace
  // guide is built and the whole block is skipped.
  const storedPlan = planRow.plan as TrainingPlan | null
  const needsPaces = planNeedsPaces(storedPlan)

  const runActs = (activities ?? []).filter((a) => RUN_TYPES.has((a as { type?: string }).type ?? ""))
  const paceGuide = (() => {
    if (!needsPaces || !goal?.target_distance_km) return null
    const actsWithPace = runActs.filter((a) => a.pace_min_per_km && Number(a.pace_min_per_km) > 0)
    const recentEasyPace = actsWithPace.length > 0
      ? actsWithPace
          .map((a) => Number(a.pace_min_per_km))
          .sort((a, b) => b - a)
          .slice(0, Math.ceil(actsWithPace.length * 0.5))
          .reduce((s, p, _, arr) => s + p / arr.length, 0)
      : null
    const { predictions } = predictRaceTimes(runActs as unknown as Activity[])
    return buildPaceGuide(predictions, testRuns ?? [], goal.target_distance_km, recentEasyPace)
  })()

  let enrichedPlan = planRow.plan
  if (storedPlan && paceGuide) {
    const fatigue = detectFatigue(runActs as unknown as SafetyActivity[])
    const athleteLevel = classifyAthleteLevel(runActs as unknown as SafetyActivity[])
    const hardFatigueModifier =
      fatigue.signal === "both"          ? 1.12 :
      fatigue.signal === "hr_elevated"   ? 1.05 :
      fatigue.signal === "pace_declining" ? 1.08 :
      1.0

    enrichedPlan = {
      ...storedPlan,
      paceSource: storedPlan.paceSource ?? paceGuide.source,
      weeks: storedPlan.weeks.map((week, weekIdx) => {
        const prevWeek = storedPlan.weeks[weekIdx - 1] ?? null
        const isRecovery =
          prevWeek != null && week.targetKm < prevWeek.targetKm * RECOVERY_WEEK_THRESHOLD

        const progressionRate = PACE_PROGRESSION_RATES[athleteLevel] ?? PACE_PROGRESSION_RATES.intermediate
        const weekIndex = Math.min(week.weekNumber - 1, PACE_PROGRESSION_MAX_WEEKS - 1)
        const progressionModifier = 1.0 - weekIndex * progressionRate

        return {
          ...week,
          sessions: week.sessions.map((session) => {
            // A session that already has a pace keeps it.
            if (session.suggestedPace) return session

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

  return NextResponse.json({
    plan: enrichedPlan,
    block_start_date: planRow.block_start_date,
    generated_at: planRow.generated_at,
    previous_plans: planRow.previous_plans ?? [],
    mid_block_checkpoint: planRow.mid_block_checkpoint ?? null,
    checkpoint_due: checkpointDue,
    pace_source: storedPlan?.paceSource ?? paceGuide?.source ?? "none",
  })
}
