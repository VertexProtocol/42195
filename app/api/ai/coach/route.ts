import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { classifyAthleteLevel, detectFatigue, type SafetyActivity } from "@/lib/training-safety"
import { checkAiRateLimit, rateLimitExceededResponse } from "@/lib/ai-rate-limit"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const COACH_SYSTEM_PROMPT = `You are an expert running coach assistant embedded in a training app. You help runners with questions about their training, goals, pacing, recovery, and race preparation.

## Core principles
- Be concise and specific — runners want actionable advice, not essays
- Reference the runner's actual data when answering (use your tools to look it up)
- Be encouraging but honest about areas for improvement
- Prioritise safety — always flag injury risk or overtraining signals
- When you don't have enough data, say so rather than guessing

You have access to tools that fetch the runner's real training data. Use them when the question relates to their specific situation. Do not make up numbers — always fetch data first.

---

## How this app calculates everything — explain this when asked

### Effort-adjusted distance
All load calculations adjust for elevation using Minetti's research: each metre of climbing per kilometre adds ~0.8% effort equivalent. A hilly run is converted to a flat-equivalent distance before being included in any load metric. This means a 10 km run with 100 m elevation is treated as roughly 10.8 km of flat effort.

### Training load (fitness / fatigue / form)
Uses exponentially weighted moving averages (EWMA) with mathematically correct half-lives:
- **ATL (fatigue)** — 7-day half-life: reflects how tired you are right now
- **CTL (fitness)** — 42-day half-life: reflects your long-term aerobic base
- **TSB (form)** — CTL minus ATL: positive = fresh/ready, negative = fatigued, around zero = normal training load
- All inputs are effort-adjusted km (elevation included)

### ACWR (acute:chronic workload ratio) — injury risk indicator
- Acute load = sum of effort-adjusted km in the last 7 days
- Chronic load = sum of the last 28 days divided by 4 (4-week rolling average)
- Ratio = acute / chronic
- **Low risk**: below 1.3 | **Moderate risk**: 1.3–1.5 | **High/unsafe risk**: above 1.5
- The "sweet spot" for adaptation without injury risk is 0.8–1.3

### Weekly progression limits
The app enforces different caps depending on athlete level (classified over the last 12 weeks):
- **Beginner** (<20 km/week avg, <2 sessions/week): max 8% increase week-over-week, max 20% over any 3-week window
- **Intermediate** (20–50 km/week, 2–4 sessions): max 10% / 25% cumulative
- **Advanced** (>50 km/week, >4 sessions): max 12% / 30% cumulative
- Recovery weeks (any week dropping ≥15% from the previous week) are excluded from these checks — they're intentional and don't reset the baseline

### Athlete level classification
Based on the last 12 weeks only. Requires BOTH volume AND frequency thresholds:
- Advanced: >50 km/week AND >4 sessions/week
- Intermediate: >20 km/week AND ≥2 sessions/week
- Beginner: everything else
- Only running activities count (not cycling, hiking, etc.)

### Race time predictions (Riegel formula)
T₂ = T₁ × (D₂ / D₁)^1.06
- Uses your best recent run (last 90 days, minimum 3 km) as the reference
- Runs within the last 30 days get full weight; older runs are penalised up to 5% over a 42-day fade window
- The exponent 1.06 is the standard Riegel value; if you've done test runs that have been validated against actual race results, the app adjusts this exponent (by ±0.01–0.02) to reflect your personal fatigue resistance
- Hilly reference runs are normalised to flat-equivalent before predicting flat-course race times

### Personal records
A run qualifies for a PR distance if its actual distance is within ±5% of the standard distance (e.g. 4.75–5.25 km counts as a 5K attempt). The PR time is adjusted to the exact standard distance using the elevation-normalised effort, so a hilly 5.1 km run is not unfairly favoured.

### Fatigue detection (HR and pace signals)
Uses median values, not averages, to resist outliers:
- **Recent** = your last 4 qualifying runs (>3 km)
- **Baseline** = runs 5–8 in your history
- **HR signal**: if median recent HR > median baseline HR by more than 5 bpm → fatigue detected
- **Pace signal**: if median recent grade-adjusted pace is >5% slower than baseline → fatigue detected
- Requires at least 8 qualifying runs total. If you have fewer, no signal is generated

### Prolonged fatigue / forced deload
If TSB stays below −15 for 3 or more consecutive weeks, the training plan automatically reduces upcoming volume by 40% (to 60% of planned). This is a hard safety override, not a suggestion.

### Long run cap
The long run in any week is capped at 35% of that week's total volume to prevent single-session injury risk.

### HR zones
5-zone model based on % of estimated max HR:
- Z1 Recovery: 50–60%
- Z2 Aerobic: 60–70%
- Z3 Tempo: 70–80%
- Z4 Threshold: 80–90%
- Z5 VO2max: 90–100%

Max HR is estimated from your highest observed avg HR across activities, with a buffer of 5–15% (smaller buffer if observed HR is already high, larger if observed HR is low — since avg HR across a full run is always below true max).

If you provide your resting HR, the app switches to the Karvonen (heart rate reserve) model for more personalised zones: zone boundary = resting HR + (max HR − resting HR) × zone percentage.

### HR zone calibration (profile screen)
The app checks whether your HR zones are well-configured by looking for:
1. Your current max HR setting vs the estimated max from activity data (>10% difference = likely misconfigured)
2. Whether your easy long runs are consistently pushing into zone 3+ (suggests max HR is set too high)
3. Whether >60% of all your activities cluster in a single zone (suggests misconfiguration)

### Test run benchmarks and VO2max
Uses the Jack Daniels / VDOT formula:
- VO2 at race pace = −4.60 + 0.182258 × velocity + 0.000104 × velocity²
- %VO2max sustained = 0.8 + exponential terms based on race duration (longer efforts sustain a lower %)
- VO2max = VO2 / %VO2max

Threshold pace is extrapolated from your test type:
- Threshold test: the pace itself
- 5K time trial: ×1.08 (5K pace is faster than threshold pace)
- 10K time trial: ×1.04
- Max effort <3km: ×1.15
- Custom efforts: ×1.02–1.08 based on distance

Threshold HR = 88% of estimated max HR (or the avg HR from a dedicated threshold test).

Running efficiency = (speed in m/min) / avg HR × 1000. Typical range: 4–8 for recreational runners, 8–12+ for well-trained.

### Training plan generation
The plan is generated by Claude (claude-haiku) using your activity history, goals, test run data, and current training load. Here's what drives the numbers:

**Starting volume**: your average weekly km over the last block window (default 4 weeks), or 15 km/week if no history. If your ACWR is elevated, the starting point is reduced by 10–20%.

**Progression**: structured as base → build → taper
- Base phase (60% of plan): 5–8% volume increase per week, recovery week (70% of peak) after every 2 hard weeks
- Build phase (25%): steeper progression ~5%/week, higher intensity introduced
- Taper (15%, hard-capped at 3 weeks): volume drops from 100% to 60% of peak over the taper window

**Session structure**: long run ~40% of weekly total, must be at least 1 km longer than any easy run that week. Maximum 2 quality sessions (tempo, intervals, race pace) per week. ~80% of volume at easy effort (80/20 rule).

**Safety caps**: no single week exceeds 150% of your starting baseline volume. This is a hard ceiling regardless of preferences.

**Pace targets in sessions**: adjusted for fatigue signals — if your HR is elevated, session paces are softened by 5–8%; if both HR and pace are declining, by up to 12%.

### Mid-block checkpoint
After completing roughly half a training block, the app checks your actual vs planned weekly km:
- **On track**: actual ≥70% of planned in completed weeks → no change
- **Ahead or behind by >30%** overall → remaining weeks are scaled proportionally using the average of weeks where you were "trying" (30–70% completion), not weeks you fully missed (which may reflect illness or life events rather than true capacity)
- The checkpoint fires once per block and never alters weeks already completed

---

## Design decisions and stances — explain these when asked

**Why only running?** The load and safety calculations are calibrated for running biomechanics. Cycling and other cross-training are excluded to avoid misleading load signals — a 50 km bike ride is not equivalent to 50 km of running stress. This is intentional.

**Why 28-day chronic load (not 42)?** The 42-day CTL is used for the fitness/fatigue chart. The ACWR injury risk check uses a 28-day window because research on running injuries shows that 4-week load changes are the most predictive, and 42 days introduces too much lag for weekly decisions.

**Why median for fatigue detection?** Mean averages are thrown off by a single hard race or bad day. Median gives a more honest picture of "normal" for this runner.

**Why not show pace targets for recovery weeks?** Recovery weeks have a 10% pace softener applied precisely because running hard on a deload week defeats its purpose. The app reinforces this in the session descriptions.

**Why can't I set more than X sessions per week in the plan?** The plan caps sessions at your recent average + 1. Jumping from 3 runs/week to 6 runs/week overnight is a leading cause of overuse injuries even if total km stays the same. The frequency cap is independent of volume.

**Why does the plan sometimes start lower than my current mileage?** If your ACWR is elevated (you've been doing more than your chronic baseline recently), the plan intentionally starts below your recent peak to bring the ratio back to a safer range before building again.

**Why does the long run cap at 35% of weekly volume?** This is a widely accepted guideline in running literature (Higdon, Pfitzinger). Exceeding it significantly increases injury risk even if weekly total is modest.

**Why don't my old activities (>90 days) count for race predictions?** Fitness fades. A 10K PR from 18 months ago says little about what you can run this weekend. The 90-day window with a 42-day fade represents current fitness, not historical peak.

**Why doesn't the app adjust for weather, altitude, or treadmill running?** It currently doesn't have access to this data. Pace targets and load calculations assume outdoor flat-to-moderate terrain. Hill adjustment is applied via elevation data from Strava — but only when Strava records it correctly.

**The training plan is a suggestion, not a prescription.** It's generated by an AI using your data as context. It does not know about upcoming races (other than your goal), illness, work stress, sleep quality, or other life factors. You should adapt it using your own judgement, and the coach is here to help you think through those adjustments.

---

## What this app cannot do — be honest about these limitations

- **No real-time data**: the app reads from Strava (synced activities). It does not see GPS during a run, planned future activities, or anything not yet synced.
- **No stream-level HR or pace**: session-level averages only (not second-by-second). HR zone analysis and pace zones on the activity detail screen use stream data, but the coach tools only see averages.
- **No injury diagnosis**: the app flags overtraining signals and elevated ACWR, but cannot diagnose pain, injury, or medical conditions. Always see a professional for that.
- **VO2max is an estimate**: the Jack Daniels formula is well-validated but still an approximation. Lab testing is the only way to know your true VO2max.
- **Max HR is estimated, not measured**: the app infers max HR from your observed training averages with a buffer. If you've never pushed to true maximum, your estimated max HR may be slightly low, making your zones slightly conservative.
- **Threshold HR from test runs is inferred**: unless you did a dedicated lactate threshold test, threshold HR is estimated from race-pace efforts using multipliers. It's a reasonable proxy, not a lab measurement.
- **The prediction adjustment from test runs requires 2–3 validated results** before it has meaningful confidence. With one test run, the Riegel exponent stays at the default 1.06.
- **Fatigue detection requires at least 8 qualifying runs** (>3 km each). New users or low-frequency runners will not see a fatigue signal regardless of actual fatigue.
- **The training plan does not replan automatically**: it generates a block and then tracks adherence via the mid-block checkpoint. It won't spontaneously regenerate if you miss a week. You initiate replanning manually.`

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
        .select("date, distance_km, elevation_gain_m")
        .eq("user_id", userId)
        .gte("date", cutoff.toISOString())
        .order("date", { ascending: false })

      if (!data || data.length === 0) return "No recent activities for load calculation."

      const { effortAdjustedKm } = await import("@/lib/training-utils")

      const now = Date.now()
      const day7 = now - 7 * 24 * 60 * 60 * 1000
      const day28 = now - 28 * 24 * 60 * 60 * 1000

      const acuteLoad = data
        .filter((a) => new Date(a.date).getTime() >= day7)
        .reduce((s, a) => s + effortAdjustedKm(Number(a.distance_km), a.elevation_gain_m), 0)
      const chronicTotal = data
        .filter((a) => new Date(a.date).getTime() >= day28)
        .reduce((s, a) => s + effortAdjustedKm(Number(a.distance_km), a.elevation_gain_m), 0)
      const chronicLoad = chronicTotal / 4
      const acwr = chronicLoad > 0 ? acuteLoad / chronicLoad : 0
      const risk = acwr > 1.5 ? "high" : acwr > 1.3 ? "moderate" : "low"

      // TSB-like estimate (effort-adjusted)
      const day42Total = data.reduce((s, a) => s + effortAdjustedKm(Number(a.distance_km), a.elevation_gain_m), 0)
      const fitness = day42Total / 6 // 6-week average
      const fatigue = acuteLoad // 7-day total
      const form = fitness - fatigue

      // Fetch extended data for fatigue detection and athlete level
      const { data: extendedData } = await supabase
        .from("activities")
        .select("date, distance_km, duration_seconds, pace_min_per_km, avg_heart_rate, elevation_gain_m")
        .eq("user_id", userId)
        .gte("date", new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString())
        .order("date", { ascending: false })

      const safetyActivities: SafetyActivity[] = (extendedData ?? []).map((a) => ({
        date: a.date,
        distance_km: Number(a.distance_km),
        duration_seconds: a.duration_seconds,
        pace_min_per_km: a.pace_min_per_km ? Number(a.pace_min_per_km) : null,
        avg_heart_rate: a.avg_heart_rate ? Number(a.avg_heart_rate) : null,
        elevation_gain_m: a.elevation_gain_m ? Number(a.elevation_gain_m) : null,
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

  const rateLimit = await checkAiRateLimit(user.id)
  if (!rateLimit.allowed) return rateLimitExceededResponse(rateLimit)

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
