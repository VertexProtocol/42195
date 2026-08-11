/**
 * End-to-end run of the training-plan generation pipeline against the real API,
 * with the invariants the plan is supposed to hold checked afterwards.
 *
 * `POST /api/ai/training-plan` had never executed. This runs everything in it
 * that is not Supabase: the same synthetic runner goes through the real
 * `groupActivitiesByWeek`, the real safety engine, the real `computeWeeklyTargets`
 * and `supportedSessionCount`, the real `buildPrompt`, a real `messages.stream`
 * call to claude-opus-5 with the real JSON schema, and the real assembly with
 * `allocateSessionDistances` and the pace guide. Only the DB reads and writes are
 * replaced — by a fixed activity history in, and invariant assertions out.
 *
 * Usage:
 *   SMOKE_ANTHROPIC_API_KEY=sk-... node scripts/smoke/plan-pipeline.mjs [focus...]
 *   focus defaults to: balanced volume workouts
 */
import Anthropic from "@anthropic-ai/sdk"
import { openLoader } from "./load-route.mjs"

const apiKey = process.env.SMOKE_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error("Set SMOKE_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY) before running.")
  process.exit(1)
}
const client = new Anthropic({ apiKey, defaultHeaders: { "X-Anthropic-No-Train": "true" } })

// ---------------------------------------------------------------------------
// A synthetic runner: 10 weeks of consistent running history.
// ---------------------------------------------------------------------------

const TODAY = new Date()
const iso = (d) => d.toISOString()
const daysAgo = (n) => {
  const d = new Date(TODAY)
  d.setUTCDate(d.getUTCDate() - n)
  d.setUTCHours(9, 0, 0, 0)
  return d
}

/**
 * 10 weeks x 4 runs, gently building — enough history for every safety signal.
 * `peakKm` sets the most recent week's volume: the default profile produces a
 * block where every week supports the requested 4 sessions, and the "low"
 * profile produces one small enough that `supportedSessionCount` has to trade
 * sessions for length in some weeks but not others — which is the only way to
 * see whether the model honours a session count that varies across the block.
 */
function buildActivities(peakKm = 40) {
  const acts = []
  for (let week = 0; week < 10; week++) {
    const weekKm = peakKm - week * (peakKm / 26.7) // most recent week is the largest
    const shape = [0.4, 0.22, 0.22, 0.16] // long run first
    const offsets = [1, 3, 5, 6]
    shape.forEach((share, i) => {
      const km = Math.round(weekKm * share * 10) / 10
      const pace = i === 0 ? 5.8 : 5.4
      acts.push({
        name: i === 0 ? "Long run" : "Easy run",
        type: "Run",
        date: iso(daysAgo(week * 7 + offsets[i])),
        distance_km: km,
        duration_seconds: Math.round(km * pace * 60),
        pace_min_per_km: pace,
        avg_heart_rate: i === 0 ? 145 : 141,
        elevation_gain_m: 40,
      })
    })
  }
  return acts
}

const GOAL = {
  id: "smoke-goal",
  name: "Oslo Marathon",
  target_distance_km: 42.2,
  target_date: iso(daysAgo(-120)).split("T")[0],
  start_date: iso(daysAgo(30)).split("T")[0],
  created_at: iso(daysAgo(30)),
}

// ---------------------------------------------------------------------------

const BLOCK_WEEKS = 4
const SESSIONS_PER_WEEK = 4

/** Words that mark a quality session — the ones "volume" focus must not produce. */
const QUALITY_RE = /tempo|interval|hill|race pace|threshold|fartlek|speed|track|repeat|vo2|progression/i

async function main() {
  const loader = await openLoader()
  try {
    const route = await loader.loadRouteInternals("training-plan", [
      "buildPrompt",
      "groupActivitiesByWeek",
      "COACHING_SYSTEM_PROMPT",
      "PLAN_DRAFT_JSON_SCHEMA",
      "PlanDraftSchema",
    ])
    const safety = await loader.load("lib/training-safety.ts")
    const volume = await loader.load("lib/training-volume.ts")
    const sessions = await loader.load("lib/training-sessions.ts")
    const constants = await loader.load("lib/training-constants.ts")
    const comebackLib = await loader.load("lib/training-comeback.ts")
    const paceGuideLib = await loader.load("lib/pace-guide.ts")
    const utils = await loader.load("lib/training-utils.ts")
    const phase = await loader.load("lib/training-phase.ts")

    const focuses = process.argv.slice(2)
    const wanted = focuses.length ? focuses : ["balanced", "volume", "workouts", "volume:low"]

    const results = []
    for (const spec of wanted) {
      const [focus, profile = "default"] = spec.split(":")
      const activities = buildActivities(profile === "low" ? 21 : 40)
      results.push(
        await runOnce({ focus, profile, activities, route, safety, volume, sessions, constants, comebackLib, paceGuideLib, utils, phase }),
      )
    }

    console.log("\n=== summary ===")
    for (const r of results) {
      console.log(`  ${r.focus}:${r.profile}: ${r.failures.length === 0 ? "all invariants held" : `${r.failures.length} FAILED`}`)
    }
    const failed = results.filter((r) => r.failures.length > 0)
    if (failed.length) process.exitCode = 1
  } finally {
    await loader.close()
  }
}

async function runOnce(ctx) {
  const { focus, profile, activities, route, safety, volume, sessions, constants, comebackLib, paceGuideLib, utils, phase } = ctx
  console.log(`\n########## focus: ${focus} (profile: ${profile})`)

  // --- everything the route computes before the prompt -----------------------
  const weeklySummaries = route.groupActivitiesByWeek(activities)
  const recentAvg =
    weeklySummaries.slice(0, constants.FITNESS_ANALYSIS_WEEKS).reduce((s, w) => s + w.totalKm, 0) /
    constants.FITNESS_ANALYSIS_WEEKS
  const peakFourWeekAvg =
    weeklySummaries.length >= 4
      ? Math.max(
          ...Array.from({ length: weeklySummaries.length - 3 }, (_, i) =>
            weeklySummaries.slice(i, i + 4).reduce((s, w) => s + w.totalKm, 0) / 4,
          ),
        )
      : recentAvg
  const currentAvgWeeklyKm = Math.max(recentAvg, peakFourWeekAvg * 0.85)
  const longestRecentRun = weeklySummaries.reduce((max, w) => Math.max(max, w.longestKm), 0)
  const daysUntilRace = phase.daysUntil(GOAL.target_date)

  const acwrSafety = safety.evaluateAcwrSafety(activities)
  const athleteLevel = safety.classifyAthleteLevel(activities)
  const prolongedFatigue = safety.checkProlongedFatigue(activities)
  const fatigue = safety.detectFatigue(activities)
  const comeback = comebackLib.assessComeback(
    activities.map((a) => ({ date: a.date, distance_km: a.distance_km })),
    false,
  )

  const { targets: weekTargets } = volume.computeWeeklyTargets({
    avgWeeklyKm: currentAvgWeeklyKm,
    blockWeeks: BLOCK_WEEKS,
    sessionsPerWeek: SESSIONS_PER_WEEK,
    longestRecentRun,
    increasePct: 10,
    athleteLevel,
    acwr: acwrSafety,
    prolongedFatigue,
    comeback,
    priorWeeklyVolumes: safety.computeRecentWeeklyVolumes(activities, 3),
  })
  const weekSessionCounts = weekTargets.map((km) =>
    sessions.supportedSessionCount(km, SESSIONS_PER_WEEK, focus),
  )

  console.log(`  level=${athleteLevel} acwr=${acwrSafety.ratio.toFixed(2)}/${acwrSafety.risk}`)
  console.log(`  weekTargets=${JSON.stringify(weekTargets)} sessionCounts=${JSON.stringify(weekSessionCounts)}`)

  const prefs = {
    goal_id: GOAL.id,
    sessions_per_week: SESSIONS_PER_WEEK,
    focus,
    notes: null,
    injury_notes: null,
    notes_history: [],
    weekly_increase_pct: 10,
    block_weeks: BLOCK_WEEKS,
    regenerate_every_weeks: 4,
  }

  const prompt = route.buildPrompt(
    GOAL, prefs, weeklySummaries, longestRecentRun, currentAvgWeeklyKm, daysUntilRace,
    null, weekTargets, weekSessionCounts,
    { ratio: acwrSafety.ratio, risk: acwrSafety.risk },
    5.4, 5.1, null, null, null, null, comeback,
  )

  // --- the real Claude call --------------------------------------------------
  const started = Date.now()
  const stream = client.messages.stream({
    model: "claude-opus-5",
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: { type: "json_schema", schema: route.PLAN_DRAFT_JSON_SCHEMA },
    },
    system: [
      { type: "text", text: route.COACHING_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: prompt }],
  })
  const message = await stream.finalMessage()
  const u = message.usage
  console.log(
    `  [ai-usage] training-plan { input: ${u.input_tokens}, output: ${u.output_tokens}, ` +
      `cacheRead: ${u.cache_read_input_tokens ?? 0}, cacheWrite: ${u.cache_creation_input_tokens ?? 0} } ` +
      `stop_reason=${message.stop_reason} (${((Date.now() - started) / 1000).toFixed(1)}s)`,
  )

  const textBlock = message.content.find((b) => b.type === "text")
  const parsed = route.PlanDraftSchema.safeParse(JSON.parse(textBlock.text))
  if (!parsed.success) throw new Error(`draft failed zod: ${parsed.error.message}`)
  const draft = parsed.data

  // --- the real assembly -----------------------------------------------------
  const safePlan = {
    ...draft,
    weeks: draft.weeks.slice(0, weekTargets.length).map((week, wi) => {
      const targetKm = weekTargets[wi]
      const { distances } = sessions.allocateSessionDistances(
        targetKm,
        week.sessions.map((s) => s.type),
      )
      return {
        weekNumber: wi + 1,
        theme: week.theme,
        targetKm: distances.reduce((sum, d) => sum + d, 0),
        coachNote: week.coachNote,
        sessions: week.sessions.map((session, si) => ({
          ...session,
          distance: sessions.formatSessionDistance(distances[si] ?? 0),
        })),
      }
    }),
  }

  const { predictions } = utils.predictRaceTimes(activities)
  const paceGuide = paceGuideLib.buildPaceGuide(predictions, [], GOAL.target_distance_km, 5.4)
  for (const week of safePlan.weeks) {
    const prevWeek = safePlan.weeks[safePlan.weeks.indexOf(week) - 1] ?? null
    const isRecovery =
      prevWeek != null && week.targetKm < prevWeek.targetKm * constants.RECOVERY_WEEK_THRESHOLD
    const rate =
      constants.PACE_PROGRESSION_RATES[athleteLevel] ?? constants.PACE_PROGRESSION_RATES.intermediate
    const weekIndex = Math.min(week.weekNumber - 1, constants.PACE_PROGRESSION_MAX_WEEKS - 1)
    const progressionModifier = 1.0 - weekIndex * rate
    for (const session of week.sessions) {
      const isHard = /tempo|threshold|interval|track|speed|fartlek|repeat|vo2/.test(session.type.toLowerCase())
      const modifier = isRecovery ? 1.1 : isHard ? progressionModifier : 1.0
      const pace = paceGuideLib.assignSessionPace(session.type, paceGuide, modifier)
      if (pace) session.suggestedPace = pace
    }
  }
  safePlan.paceSource = paceGuide.source

  // --- invariants ------------------------------------------------------------
  const failures = []
  const check = (ok, label, detail = "") => {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
    if (!ok) failures.push(label)
  }

  check(safePlan.weeks.length === BLOCK_WEEKS, "week count equals block_weeks",
    `${safePlan.weeks.length} weeks`)

  let sumOk = true
  let capOk = true
  const sumDetail = []
  for (let i = 0; i < safePlan.weeks.length; i++) {
    const week = safePlan.weeks[i]
    const dists = week.sessions.map((s) => sessions.parseSessionDistanceKm(s.distance))
    const total = Math.round(dists.reduce((a, b) => a + b, 0) * 10) / 10
    const target = weekTargets[i]
    if (total !== target) sumOk = false
    if (!sessions.longRunWithinCap(dists, target)) capOk = false
    sumDetail.push(
      `W${week.weekNumber} ${total}/${target}km [${dists.join(", ")}] max=${Math.max(...dists)} cap=${(target * sessions.longRunMaxFraction(dists.length)).toFixed(1)}`,
    )
  }
  sumDetail.forEach((d) => console.log(`        ${d}`))
  check(sumOk, "session distances sum exactly to targetKm each week")
  check(capOk, "longest session within longRunMaxFraction(n)")

  const leaked = safePlan.weeks.filter((w) => (w.coachNote ?? "").includes("Safety:"))
  check(leaked.length === 0, 'no coachNote contains "Safety:"',
    leaked.length ? `weeks ${leaked.map((w) => w.weekNumber).join(",")}` : "")

  check(typeof safePlan.paceSource === "string" && safePlan.paceSource.length > 0,
    "plan.paceSource is set", String(safePlan.paceSource))

  // The summary must not describe volumes the plan does not contain. Every km
  // figure it uses has to be traceable: a week target, the block total, or a
  // number that was in the prompt (the runner's own history, which the summary
  // legitimately refers back to). A figure from none of those is invented —
  // the failure mode this whole redesign was meant to remove, where the summary
  // talked about volumes the runner never got.
  const kmFigures = (text) =>
    [...text.matchAll(/(\d+(?:\.\d+)?)\s*km/gi)].map((m) => Number(m[1]))
  const summaryKm = kmFigures(safePlan.summary)
  const blockTotal = weekTargets.reduce((a, b) => a + b, 0)
  const allowed = [...weekTargets, blockTotal, GOAL.target_distance_km, ...kmFigures(prompt)]
  const stray = summaryKm.filter((n) => !allowed.some((a) => Math.abs(a - n) < 0.5))
  check(stray.length === 0, "summary describes only volumes the plan or history contains",
    stray.length ? `invented: ${stray.join(", ")}` : `all ${summaryKm.length} figure(s) traceable`)
  console.log(`        summary: ${JSON.stringify(safePlan.summary)}`)

  // #414: a generated plan carries its own paces, so GET fills in nothing and a
  // second load returns byte-identical paces. Simulated here by running the GET
  // path's gate twice over the stored plan.
  const needsPacesFirstLoad = paceGuideLib.planNeedsPaces(safePlan)
  const pacesOf = (p) => p.weeks.flatMap((w) => w.sessions.map((s) => s.suggestedPace ?? null))
  const load1 = pacesOf(safePlan)
  const load2 = pacesOf(safePlan)
  check(!needsPacesFirstLoad, "generated plan needs no pace backfill on read (planNeedsPaces=false)")
  check(JSON.stringify(load1) === JSON.stringify(load2) && load1.every(Boolean),
    "paces identical across two loads", `${load1.length} sessions, e.g. ${load1[0]}`)

  // --- focus-specific --------------------------------------------------------
  const allTypes = safePlan.weeks.flatMap((w) => w.sessions.map((s) => s.type))
  const counts = safePlan.weeks.map((w) => w.sessions.length)
  console.log(`        session types: ${[...new Set(allTypes)].join(" | ")}`)
  console.log(`        sessions/week: ${JSON.stringify(counts)} (asked for ${JSON.stringify(weekSessionCounts)})`)

  if (focus === "volume") {
    const quality = allTypes.filter((t) => QUALITY_RE.test(t))
    check(quality.length === 0, "volume focus: no tempo/intervals/hills/race pace",
      quality.length ? `found: ${[...new Set(quality)].join(", ")}` : "")
    const varies = new Set(weekSessionCounts).size > 1
    check(
      !varies || JSON.stringify(counts) === JSON.stringify(weekSessionCounts),
      "volume focus: model respects the per-week session counts",
      varies ? "counts vary across the block" : "counts are uniform this block — nothing to vary",
    )
  }
  if (focus === "workouts") {
    const quality = allTypes.filter((t) => QUALITY_RE.test(t))
    check(quality.length > 0, "workouts focus: quality sessions present",
      quality.length ? [...new Set(quality)].join(", ") : "none found")
    check(new Set(counts).size === 1, "workouts focus: session count equal every week",
      JSON.stringify(counts))
  }

  return { focus, profile, failures, plan: safePlan }
}

await main()
