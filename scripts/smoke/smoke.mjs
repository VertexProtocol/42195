/**
 * Smoke test for the six AI routes against the real Anthropic API.
 *
 * Everything in app/api/ai was verified against SDK types, structural schema
 * checks and unit tests — none of it had ever been sent to the API. This script
 * closes that gap: it mirrors exactly what each route sends, with the same
 * model, parameters, system blocks, tools and JSON schemas (read live from the
 * route files by extract.mjs), and reports what actually came back.
 *
 * Usage:
 *   SMOKE_ANTHROPIC_API_KEY=sk-... node scripts/smoke/smoke.mjs tokens
 *   SMOKE_ANTHROPIC_API_KEY=sk-... node scripts/smoke/smoke.mjs smoke [route...]
 *   SMOKE_ANTHROPIC_API_KEY=sk-... node scripts/smoke/smoke.mjs cache [route...]
 *
 *   tokens  — count_tokens on each route's cacheable prefix, checked against the
 *             per-model minimum cacheable prefix. Below the minimum the API
 *             caches nothing, without an error and without a warning.
 *   smoke   — one real request per route form. Reports stop_reason and usage.
 *   cache   — two identical requests per route, reporting cache reads on the
 *             second. Only meaningful for prefixes that clear the minimum.
 */
import Anthropic from "@anthropic-ai/sdk"
import { extractObjectLiteral, extractTemplateLiteral, routeSource } from "./extract.mjs"

const apiKey = process.env.SMOKE_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error("Set SMOKE_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY) before running.")
  process.exit(1)
}

// Same client shape as lib/anthropic.ts, including the custom header — one of
// the things that had never been sent to a real endpoint.
const client = new Anthropic({
  apiKey,
  defaultHeaders: { "X-Anthropic-No-Train": "true" },
})

/**
 * Minimum cacheable prefix per model. Anything shorter silently caches nothing.
 * These are model-dependent and NOT monotonic across generations, which is why
 * the same 600-token prompt caches on Opus 5 and does not on Haiku 4.5.
 */
const CACHE_MINIMUM = {
  "claude-opus-5": 512,
  "claude-haiku-4-5": 4096,
}

// ---------------------------------------------------------------------------
// Live constants, read out of the route files
// ---------------------------------------------------------------------------

const planSrc = routeSource("training-plan")
const strategySrc = routeSource("race-strategy")
const checkSrc = routeSource("plan-check")
const reviewSrc = routeSource("weekly-review")
const analysisSrc = routeSource("activity-analysis")
const coachSrc = routeSource("coach")

const COACHING_SYSTEM_PROMPT = extractTemplateLiteral(planSrc, "COACHING_SYSTEM_PROMPT")
const STRATEGY_SYSTEM_PROMPT = extractTemplateLiteral(strategySrc, "STRATEGY_SYSTEM_PROMPT")
const CHECK_SYSTEM_PROMPT = extractTemplateLiteral(checkSrc, "CHECK_SYSTEM_PROMPT")
const REVIEW_SYSTEM_PROMPT = extractTemplateLiteral(reviewSrc, "REVIEW_SYSTEM_PROMPT")
const ANALYSIS_SYSTEM_PROMPT = extractTemplateLiteral(analysisSrc, "ANALYSIS_SYSTEM_PROMPT")
const COACH_SYSTEM_PROMPT = extractTemplateLiteral(coachSrc, "COACH_SYSTEM_PROMPT")

const PLAN_DRAFT_JSON_SCHEMA = extractObjectLiteral(planSrc, "PLAN_DRAFT_JSON_SCHEMA")
const RACE_STRATEGY_JSON_SCHEMA = extractObjectLiteral(strategySrc, "RACE_STRATEGY_JSON_SCHEMA")
const PLAN_CHECK_JSON_SCHEMA = extractObjectLiteral(checkSrc, "PLAN_CHECK_JSON_SCHEMA")
const WEEKLY_REVIEW_JSON_SCHEMA = extractObjectLiteral(reviewSrc, "WEEKLY_REVIEW_JSON_SCHEMA")
const COACH_TOOLS = extractObjectLiteral(coachSrc, "tools")

// ---------------------------------------------------------------------------
// Minimal but realistic user prompts
// ---------------------------------------------------------------------------

const PLAN_USER_PROMPT = `Create a 4-week training block for this runner.

## The Runner's Goal
- Race: Oslo Marathon (42.2 km)
- Race date: 2026-09-19 (120 days away)
- Training phase: build
- Training start: 2026-05-01

## Runner's Preferences
- Sessions per week: 4 (requested; the per-week counts below are what to actually plan for)
- Focus: structured sessions (long run, tempo, easy runs with clear purpose)

- Coach notes: None provided

## Recent Training History (most recent first)
  Week -1 (2026-05-11): 4 runs, 42.0 km total, longest: 16.0 km, avg pace: 5:35 min/km
  Week -2 (2026-05-04): 4 runs, 40.0 km total, longest: 15.0 km, avg pace: 5:40 min/km
  Week -3 (2026-04-27): 3 runs, 33.0 km total, longest: 14.0 km, avg pace: 5:42 min/km
  Week -4 (2026-04-20): 4 runs, 38.0 km total, longest: 15.0 km, avg pace: 5:38 min/km

## Current Fitness Snapshot
- Avg weekly km (last 4 weeks): 38.3 km
- Volume trend vs prior 4 weeks: stable — 37.5 → 38.3 km/week (+2%)
- Longest recent run: 16.0 km (goal: 42.2 km — long run ceiling for this block: 24.0 km)

## Weekly Volume (fixed)
These are the volumes for this block. Treat them as settled.
- Week 1: 42 km across 4 sessions
- Week 2: 46 km across 4 sessions
- Week 3: 50 km across 4 sessions
- Week 4: 40 km across 4 sessions (recovery week)

Do not assign sessions to particular days of the week; the runner fits them in where they can. Give exactly 4 weeks, each with the session count listed above.`

const STRATEGY_USER_PROMPT = `Create a race strategy for this runner.

## Race
- Oslo Marathon, 42.2 km, on 2026-09-19 (120 days away)
- Goal time: 3:30:00

## Fitness
- Avg weekly volume: 55 km over the last 4 weeks
- Longest run: 30 km
- Recent easy pace: 5:35 min/km
- Predicted marathon time from recent runs: 3:34:00

Give pacing, fuelling and a race-day plan.`

const CHECK_USER_PROMPT = `Evaluate whether this plan needs adjustment.

## Plan (week 2 of 4)
- Week 1: 42 km planned
- Week 2: 46 km planned

## Actual training
- Week 1: 3 runs, 28 km (67% of target)
- Week 2 so far: 2 runs, 19 km

The runner has missed one long run. Assess whether the plan should change.`

const REVIEW_USER_PROMPT = `Review last week's training.

## Planned (Week 2)
- Target: 46 km
- Sessions: Long run (18 km, easy); Tempo run (10 km, threshold); Base run (10 km, easy); Recovery run (8 km, very easy)

## Actual
- 4 runs, 44.2 km
- Long run 18.1 km at 5:50 min/km
- Tempo 10 km at 4:45 min/km
- Base 9.5 km at 5:38 min/km
- Recovery 6.6 km at 6:10 min/km`

const ANALYSIS_USER_PROMPT = `Analyse this activity.

- Morning Run, 2026-05-16
- 16.0 km in 1h29m, avg pace 5:34 min/km
- Avg heart rate 148 bpm, elevation gain 120 m
- Runner's recent 4-week average: 38 km/week, easy pace 5:40 min/km`

const COACH_USER_PROMPT = "How has my training volume trended over the last 8 weeks?"

// ---------------------------------------------------------------------------
// Route specs — one per AI route, mirroring the real request shape
// ---------------------------------------------------------------------------

/** system blocks, exactly as each route builds them */
const planSystem = [
  { type: "text", text: COACHING_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
]
const strategySystem = [
  { type: "text", text: STRATEGY_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
]
// The three Haiku routes carry no cache_control: their prefixes cannot reach the
// 4096-token minimum, so a breakpoint there caches nothing. `tokens` still
// reports them, so the day one of these prompts grows past the minimum it shows
// up as a number rather than as a surprise.
const checkSystem = [{ type: "text", text: CHECK_SYSTEM_PROMPT }]
const reviewSystem = [{ type: "text", text: REVIEW_SYSTEM_PROMPT }]
const analysisSystem = [{ type: "text", text: ANALYSIS_SYSTEM_PROMPT }]
const coachSystem = [
  { type: "text", text: COACH_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
]

const ROUTES = [
  {
    name: "training-plan",
    model: "claude-opus-5",
    system: planSystem,
    tools: undefined,
    // A structured-output schema is part of the cacheable prefix too, and on the
    // Opus routes it dwarfs the system prompt — race-strategy's 156-token system
    // block sits under a 942-token schema. Leaving it out of the count is what
    // made those two routes look uncacheable when they are not.
    outputConfig: {
      effort: "high",
      format: { type: "json_schema", schema: PLAN_DRAFT_JSON_SCHEMA },
    },
    userPrompt: PLAN_USER_PROMPT,
    structured: true,
    async run() {
      const stream = client.messages.stream({
        model: "claude-opus-5",
        max_tokens: 32000,
        thinking: { type: "adaptive" },
        output_config: {
          effort: "high",
          format: { type: "json_schema", schema: PLAN_DRAFT_JSON_SCHEMA },
        },
        system: planSystem,
        messages: [{ role: "user", content: PLAN_USER_PROMPT }],
      })
      return stream.finalMessage()
    },
  },
  {
    name: "race-strategy",
    model: "claude-opus-5",
    system: strategySystem,
    tools: undefined,
    outputConfig: {
      effort: "high",
      format: { type: "json_schema", schema: RACE_STRATEGY_JSON_SCHEMA },
    },
    userPrompt: STRATEGY_USER_PROMPT,
    structured: true,
    async run() {
      const stream = client.messages.stream({
        model: "claude-opus-5",
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: {
          effort: "high",
          format: { type: "json_schema", schema: RACE_STRATEGY_JSON_SCHEMA },
        },
        system: strategySystem,
        messages: [{ role: "user", content: STRATEGY_USER_PROMPT }],
      })
      return stream.finalMessage()
    },
  },
  {
    name: "plan-check",
    model: "claude-haiku-4-5",
    system: checkSystem,
    tools: undefined,
    outputConfig: { format: { type: "json_schema", schema: PLAN_CHECK_JSON_SCHEMA } },
    userPrompt: CHECK_USER_PROMPT,
    structured: true,
    async run() {
      return client.messages.create({
        model: "claude-haiku-4-5",
        temperature: 0,
        max_tokens: 1500,
        output_config: { format: { type: "json_schema", schema: PLAN_CHECK_JSON_SCHEMA } },
        system: checkSystem,
        messages: [{ role: "user", content: CHECK_USER_PROMPT }],
      })
    },
  },
  {
    name: "weekly-review",
    model: "claude-haiku-4-5",
    system: reviewSystem,
    tools: undefined,
    outputConfig: { format: { type: "json_schema", schema: WEEKLY_REVIEW_JSON_SCHEMA } },
    userPrompt: REVIEW_USER_PROMPT,
    structured: true,
    async run() {
      return client.messages.create({
        model: "claude-haiku-4-5",
        temperature: 0,
        max_tokens: 1500,
        output_config: { format: { type: "json_schema", schema: WEEKLY_REVIEW_JSON_SCHEMA } },
        system: reviewSystem,
        messages: [{ role: "user", content: REVIEW_USER_PROMPT }],
      })
    },
  },
  {
    name: "activity-analysis",
    model: "claude-haiku-4-5",
    system: analysisSystem,
    tools: undefined,
    userPrompt: ANALYSIS_USER_PROMPT,
    structured: false,
    async run() {
      return client.messages.create({
        model: "claude-haiku-4-5",
        temperature: 0,
        max_tokens: 300,
        system: analysisSystem,
        messages: [{ role: "user", content: ANALYSIS_USER_PROMPT }],
      })
    },
  },
  {
    name: "coach",
    model: "claude-haiku-4-5",
    system: coachSystem,
    tools: COACH_TOOLS,
    userPrompt: COACH_USER_PROMPT,
    structured: false,
    // The coach runs a tool loop, so the smoke test runs one too: first turn
    // should ask for a tool, second turn should answer from the tool result.
    async run() {
      const messages = [{ role: "user", content: COACH_USER_PROMPT }]
      const turns = []
      for (let i = 0; i < 3; i++) {
        const response = await client.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 2048,
          system: coachSystem,
          tools: COACH_TOOLS,
          messages,
        })
        turns.push(response)
        const toolUses = response.content.filter((b) => b.type === "tool_use")
        if (toolUses.length === 0) break
        messages.push({ role: "assistant", content: response.content })
        messages.push({
          role: "user",
          content: toolUses.map((t) => ({
            type: "tool_result",
            tool_use_id: t.id,
            content: JSON.stringify([
              { week: "2026-05-11", totalKm: 42.0, runCount: 4 },
              { week: "2026-05-04", totalKm: 40.0, runCount: 4 },
              { week: "2026-04-27", totalKm: 33.0, runCount: 3 },
              { week: "2026-04-20", totalKm: 38.0, runCount: 4 },
              { week: "2026-04-13", totalKm: 35.0, runCount: 4 },
              { week: "2026-04-06", totalKm: 30.0, runCount: 3 },
              { week: "2026-03-30", totalKm: 28.0, runCount: 3 },
              { week: "2026-03-23", totalKm: 25.0, runCount: 3 },
            ]),
          })),
        })
      }
      return { turns }
    },
  },
]

// ---------------------------------------------------------------------------
// tokens
// ---------------------------------------------------------------------------

const STUB_MESSAGE = [{ role: "user", content: "." }]

async function countPrefix(spec) {
  // The cacheable prefix renders as tools -> system, so both count toward the
  // minimum. Measuring the difference against a bare request isolates the
  // prefix from the fixed per-request message overhead.
  const withPrefix = await client.messages.countTokens({
    model: spec.model,
    system: spec.system.map(({ cache_control, ...rest }) => rest),
    ...(spec.tools ? { tools: spec.tools } : {}),
    ...(spec.outputConfig ? { output_config: spec.outputConfig } : {}),
    messages: STUB_MESSAGE,
  })
  const bare = await client.messages.countTokens({
    model: spec.model,
    messages: STUB_MESSAGE,
  })
  return { total: withPrefix.input_tokens, prefix: withPrefix.input_tokens - bare.input_tokens }
}

async function cmdTokens(selected) {
  console.log("\n=== count_tokens: cacheable prefix vs model minimum ===\n")
  const rows = []
  for (const spec of selected) {
    const { total, prefix } = await countPrefix(spec)
    const min = CACHE_MINIMUM[spec.model]
    rows.push({
      route: spec.name,
      model: spec.model,
      systemChars: spec.system.reduce((n, b) => n + b.text.length, 0),
      toolCount: spec.tools?.length ?? 0,
      schema: spec.outputConfig?.format ? "yes" : "no",
      prefixTokens: prefix,
      minimum: min,
      cacheable: prefix >= min ? "YES" : "no",
    })
  }
  console.table(rows)
  return rows
}

// ---------------------------------------------------------------------------
// smoke
// ---------------------------------------------------------------------------

function usageLine(u) {
  return `input=${u.input_tokens} output=${u.output_tokens} cacheRead=${u.cache_read_input_tokens ?? 0} cacheWrite=${u.cache_creation_input_tokens ?? 0}`
}

function textOf(message) {
  const block = message.content.find((b) => b.type === "text")
  return block?.text ?? ""
}

async function cmdSmoke(selected) {
  console.log("\n=== smoke: one real request per route form ===\n")
  const results = []
  for (const spec of selected) {
    process.stdout.write(`--- ${spec.name} (${spec.model})\n`)
    const started = Date.now()
    try {
      const out = await spec.run()
      const elapsed = ((Date.now() - started) / 1000).toFixed(1)

      if (out.turns) {
        // coach: report every turn of the tool loop
        out.turns.forEach((t, i) => {
          const tools = t.content.filter((b) => b.type === "tool_use").map((b) => b.name)
          console.log(
            `    turn ${i + 1}: stop_reason=${t.stop_reason} ${usageLine(t.usage)}` +
              (tools.length ? ` tools=${tools.join(",")}` : ""),
          )
        })
        const last = out.turns[out.turns.length - 1]
        console.log(`    ok in ${elapsed}s — final text: ${JSON.stringify(textOf(last).slice(0, 120))}`)
        results.push({ route: spec.name, ok: true, stop_reason: last.stop_reason })
        continue
      }

      console.log(`    stop_reason=${out.stop_reason} ${usageLine(out.usage)}`)
      if (out.stop_reason === "max_tokens") {
        console.log("    !! hit max_tokens — the route's guard would throw here")
      }
      if (spec.structured) {
        const parsed = JSON.parse(textOf(out))
        console.log(`    structured output parsed, top-level keys: ${Object.keys(parsed).join(", ")}`)
      } else {
        console.log(`    text: ${JSON.stringify(textOf(out).slice(0, 160))}`)
      }
      console.log(`    ok in ${elapsed}s`)
      results.push({ route: spec.name, ok: true, stop_reason: out.stop_reason })
    } catch (err) {
      console.log(`    FAILED: ${err?.constructor?.name ?? "Error"}: ${err.message}`)
      if (err.status) console.log(`    status=${err.status} type=${err.error?.error?.type ?? "?"}`)
      results.push({ route: spec.name, ok: false, error: err.message })
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// cache
// ---------------------------------------------------------------------------

async function cmdCache(selected) {
  console.log("\n=== cache: two identical requests, reading cache_read on the second ===\n")
  for (const spec of selected) {
    process.stdout.write(`--- ${spec.name} (${spec.model})\n`)
    try {
      const first = await spec.run()
      const second = await spec.run()
      const u1 = first.turns ? first.turns[0].usage : first.usage
      const u2 = second.turns ? second.turns[0].usage : second.usage
      console.log(`    call 1: ${usageLine(u1)}`)
      console.log(`    call 2: ${usageLine(u2)}`)
      const read = u2.cache_read_input_tokens ?? 0
      console.log(`    => ${read > 0 ? `cache HIT (${read} tokens read)` : "no cache read"}`)
    } catch (err) {
      console.log(`    FAILED: ${err.message}`)
    }
  }
}

// ---------------------------------------------------------------------------

const [, , cmd, ...rest] = process.argv
const selected = rest.length ? ROUTES.filter((r) => rest.includes(r.name)) : ROUTES
if (rest.length && selected.length !== rest.length) {
  console.error(`Unknown route(s). Known: ${ROUTES.map((r) => r.name).join(", ")}`)
  process.exit(1)
}

switch (cmd) {
  case "tokens":
    await cmdTokens(selected)
    break
  case "smoke":
    await cmdSmoke(selected)
    break
  case "cache":
    await cmdCache(selected)
    break
  default:
    console.error("Usage: node scripts/smoke/smoke.mjs <tokens|smoke|cache> [route...]")
    process.exit(1)
}
