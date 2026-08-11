/**
 * Exercises every AI route's request shape against the real Anthropic API.
 *
 *   npx tsx scripts/smoke-ai.ts            # all three phases
 *   npx tsx scripts/smoke-ai.ts measure    # cacheable-prefix token counts only
 *   npx tsx scripts/smoke-ai.ts smoke      # one live request per route shape
 *   npx tsx scripts/smoke-ai.ts cache      # two identical calls, read the cache hit
 *   npx tsx scripts/smoke-ai.ts all --route=training-plan
 *
 * The six routes were built and reviewed against SDK types and structural
 * schema checks alone — no call has ever left the process. This script closes
 * that gap: it sends the same model, thinking config, output_config, system
 * structure and tools each route sends, so an API-side rejection surfaces here
 * rather than on a user's first plan generation.
 *
 * Prompts, schemas and tool definitions are read out of the route sources
 * rather than copied, so a request that passes here is the request the route
 * makes. Only the user turn is synthesised — minimal but realistic.
 */

import { existsSync } from "fs"
import { join } from "path"
import Anthropic from "@anthropic-ai/sdk"
import { templateLiteral, valueLiteral } from "./route-literals"

// Next loads .env.local for the routes; do the same here so the key can live in
// a gitignored file rather than an exported shell variable.
for (const file of [".env.local", ".env"]) {
  const path = join(__dirname, "..", file)
  if (existsSync(path)) process.loadEnvFile(path)
}

/**
 * ANTHROPIC_API_KEY first, since that is what the routes read and what a local
 * checkout will already have. SMOKE_ANTHROPIC_API_KEY exists because a Claude
 * Code environment reserves the former: those sessions authenticate through the
 * account, so a variable by that name is stripped rather than passed to the
 * container, and it arrives absent no matter what the environment config says.
 * Any unreserved name gets through.
 */
const KEY_VARS = ["ANTHROPIC_API_KEY", "SMOKE_ANTHROPIC_API_KEY"] as const

const keyVar = KEY_VARS.find((name) => process.env[name])

if (!keyVar) {
  console.error(
    `No API key found. Set one of: ${KEY_VARS.join(", ")}\n` +
      "  - locally: put ANTHROPIC_API_KEY=sk-ant-... in .env.local (gitignored)\n" +
      "  - in a Claude Code environment: use SMOKE_ANTHROPIC_API_KEY, as\n" +
      "    ANTHROPIC_API_KEY is reserved there and never reaches the container",
  )
  process.exit(1)
}

console.log(`using key from ${keyVar}`)

const client = new Anthropic({
  apiKey: process.env[keyVar],
  defaultHeaders: {
    // Mirrors lib/anthropic.ts. The header has never been sent by these calls;
    // an API that rejected an unknown header would fail every request below.
    "X-Anthropic-No-Train": "true",
  },
})

/**
 * Smallest prefix each model will cache. Below this the API caches nothing and
 * reports no error, so a breakpoint on a shorter prompt is decoration.
 */
const MIN_CACHEABLE: Record<string, number> = {
  "claude-opus-5": 512,
  "claude-haiku-4-5": 4096,
}

type Spec = {
  route: string
  model: string
  /** Tools render before system, so they count toward the cacheable prefix. */
  tools?: Anthropic.Tool[]
  /** System blocks up to and including the one carrying cache_control. */
  cachedSystem: Anthropic.TextBlockParam[]
  /** The full request, exactly as the route builds it. */
  params: Record<string, unknown>
  mode: "create" | "stream"
  /** Set when the route asks for JSON, so the smoke phase can parse it. */
  structured: boolean
}

const R = "app/api/ai"

function cached(text: string): Anthropic.TextBlockParam[] {
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }]
}

// ─── training-plan ───────────────────────────────────────────────────────────
const planSystem = templateLiteral(`${R}/training-plan/route.ts`, "COACHING_SYSTEM_PROMPT")
const planSchema = valueLiteral(`${R}/training-plan/route.ts`, "PLAN_DRAFT_JSON_SCHEMA")

const trainingPlan: Spec = {
  route: "training-plan",
  model: "claude-opus-5",
  cachedSystem: cached(planSystem),
  mode: "stream",
  structured: true,
  params: {
    model: "claude-opus-5",
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: { type: "json_schema", schema: planSchema } },
    system: cached(planSystem),
    messages: [
      {
        role: "user",
        content: `Design a training block for this runner.

GOAL: Oslo Marathon (42.2 km) — 16 weeks away
BLOCK: 4 weeks, base-building phase
CURRENT VOLUME: 38 km/week over 4 sessions
WEEKLY TARGETS (km): Week 1: 40, Week 2: 44, Week 3: 48, Week 4: 36
LONGEST RECENT RUN: 16 km
RECENT TRAINING: 12 weeks of consistent running, no missed weeks, no injuries.`,
      },
    ],
  },
}

// ─── race-strategy ───────────────────────────────────────────────────────────
const strategySystem = templateLiteral(`${R}/race-strategy/route.ts`, "STRATEGY_SYSTEM_PROMPT")
const strategySchema = valueLiteral(`${R}/race-strategy/route.ts`, "RACE_STRATEGY_JSON_SCHEMA")

const raceStrategy: Spec = {
  route: "race-strategy",
  model: "claude-opus-5",
  cachedSystem: cached(strategySystem),
  mode: "stream",
  structured: true,
  params: {
    model: "claude-opus-5",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: { type: "json_schema", schema: strategySchema } },
    system: cached(strategySystem),
    messages: [
      {
        role: "user",
        content: `Build a race-day strategy.

RACE: Oslo Marathon (42.2 km) in 21 days
TRAINING: 12 weeks, averaging 52 km/week, peak week 68 km
LONGEST RUN: 32 km at 5:35/km
RECENT 10K: 46:30
TERRAIN: rolling, 240 m total climb`,
      },
    ],
  },
}

// ─── plan-check ──────────────────────────────────────────────────────────────
const checkSystem = templateLiteral(`${R}/plan-check/route.ts`, "CHECK_SYSTEM_PROMPT")
const checkSchema = valueLiteral(`${R}/plan-check/route.ts`, "PLAN_CHECK_JSON_SCHEMA")

const planCheck: Spec = {
  route: "plan-check",
  model: "claude-haiku-4-5",
  cachedSystem: cached(checkSystem),
  mode: "create",
  structured: true,
  params: {
    model: "claude-haiku-4-5",
    temperature: 0,
    max_tokens: 1500,
    output_config: { format: { type: "json_schema", schema: checkSchema } },
    system: cached(checkSystem),
    messages: [
      {
        role: "user",
        content: `Evaluate this training plan's status:

GOAL: Oslo Marathon (42.2 km) — 63 days away
PLAN: 8-week block, generated 2026-06-01
CURRENT: Week 3 of 8

WEEKLY COMPARISON (planned vs actual):
  Week 1: 41 km / 40 km (+2%), 4 sessions, avg HR 148
  Week 2: 38 km / 44 km (-14%), 4 sessions, avg HR 151
  Week 3: 30 km / 48 km (-38%), 3 sessions, avg HR 155

ACWR (injury risk): 0.78
REMAINING WEEKS: 5

Should this plan be kept as-is, adjusted, or fully regenerated?`,
      },
    ],
  },
}

// ─── weekly-review ───────────────────────────────────────────────────────────
const reviewSystem = templateLiteral(`${R}/weekly-review/route.ts`, "REVIEW_SYSTEM_PROMPT")
const reviewSchema = valueLiteral(`${R}/weekly-review/route.ts`, "WEEKLY_REVIEW_JSON_SCHEMA")

const weeklyReview: Spec = {
  route: "weekly-review",
  model: "claude-haiku-4-5",
  cachedSystem: cached(reviewSystem),
  mode: "create",
  structured: true,
  params: {
    model: "claude-haiku-4-5",
    temperature: 0,
    max_tokens: 1500,
    output_config: { format: { type: "json_schema", schema: reviewSchema } },
    system: cached(reviewSystem),
    messages: [
      {
        role: "user",
        content: `Review this training week:

PLANNED — Week 3: Build volume, 48 km
- Sessions: Long run (18 km, easy); Tempo run (10 km, comfortably hard); Base run (12 km, easy); Recovery run (8 km, very easy)

ACTUAL: 30 km over 3 runs, longest 14 km, avg pace 5:52/km, avg HR 155`,
      },
    ],
  },
}

// ─── activity-analysis ───────────────────────────────────────────────────────
const analysisSystem = templateLiteral(`${R}/activity-analysis/route.ts`, "ANALYSIS_SYSTEM_PROMPT")

const activityAnalysis: Spec = {
  route: "activity-analysis",
  model: "claude-haiku-4-5",
  cachedSystem: cached(analysisSystem),
  mode: "create",
  structured: false,
  params: {
    model: "claude-haiku-4-5",
    temperature: 0,
    max_tokens: 300,
    system: cached(analysisSystem),
    messages: [
      {
        role: "user",
        content: `Analyze this run:
- Activity: Morning long run (Run)
- Date: 2026-07-28
- Distance: 18.20 km
- Duration: 101min 24s
- Pace: 5:34 min/km
- Avg HR: 149 bpm
- Elevation: 180m

Recent context (last 2 weeks): 7 runs, avg pace 5:48 min/km, avg distance 11.4 km
Active goals: Oslo Marathon (42.2km on 2026-09-19)`,
      },
    ],
  },
}

// ─── coach ───────────────────────────────────────────────────────────────────
const coachSystem = templateLiteral(`${R}/coach/route.ts`, "COACH_SYSTEM_PROMPT")
const coachTools = valueLiteral<Anthropic.Tool[]>(`${R}/coach/route.ts`, "tools")

const coach: Spec = {
  route: "coach",
  model: "claude-haiku-4-5",
  tools: coachTools,
  cachedSystem: cached(coachSystem),
  mode: "create",
  structured: false,
  params: {
    model: "claude-haiku-4-5",
    max_tokens: 2048,
    system: cached(coachSystem),
    tools: coachTools,
    messages: [{ role: "user", content: "How has my weekly volume trended over the last two months?" }],
  },
}

const SPECS = [trainingPlan, raceStrategy, planCheck, weeklyReview, activityAnalysis, coach]

// ─── phases ──────────────────────────────────────────────────────────────────

const PROBE: Anthropic.MessageParam[] = [{ role: "user", content: "x" }]

/**
 * Measures the cacheable prefix — everything rendered before the breakpoint —
 * by differencing a count that includes it against one that does not. The
 * endpoint always counts a user turn, so the subtraction isolates the prefix.
 */
async function measure(spec: Spec) {
  const bare = await client.messages.countTokens({ model: spec.model, messages: PROBE })
  const full = await client.messages.countTokens({
    model: spec.model,
    system: spec.cachedSystem,
    ...(spec.tools ? { tools: spec.tools } : {}),
    messages: PROBE,
  })

  const prefix = full.input_tokens - bare.input_tokens
  const minimum = MIN_CACHEABLE[spec.model]
  const verdict = prefix >= minimum ? "CACHES" : "NO-OP"

  console.log(
    `  ${spec.route.padEnd(18)} ${spec.model.padEnd(18)} ` +
      `prefix ${String(prefix).padStart(5)} tok  min ${String(minimum).padStart(5)}  ` +
      `${verdict}${spec.tools ? `  (incl. ${spec.tools.length} tool defs)` : ""}`,
  )
  return { route: spec.route, model: spec.model, prefix, minimum, caches: prefix >= minimum }
}

async function send(spec: Spec) {
  if (spec.mode === "stream") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await client.messages.stream(spec.params as any).finalMessage()
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await client.messages.create(spec.params as any)
}

async function smoke(spec: Spec) {
  const started = Date.now()
  try {
    const message = await send(spec)
    const seconds = ((Date.now() - started) / 1000).toFixed(1)
    const u = message.usage

    console.log(`  ${spec.route}: OK in ${seconds}s`)
    console.log(`    model=${message.model} stop_reason=${message.stop_reason}`)
    console.log(
      `    usage in=${u.input_tokens} out=${u.output_tokens} ` +
        `cacheWrite=${u.cache_creation_input_tokens ?? 0} cacheRead=${u.cache_read_input_tokens ?? 0}`,
    )

    if (message.stop_reason === "max_tokens") {
      console.log(`    !! hit max_tokens — the ceiling is too low for this shape`)
    }

    const text = message.content.find((b) => b.type === "text")
    if (spec.structured) {
      if (!text || text.type !== "text") {
        console.log(`    !! no text block to parse`)
      } else {
        try {
          JSON.parse(text.text)
          console.log(`    structured output parsed (${text.text.length} chars)`)
        } catch (err) {
          console.log(`    !! structured output is not JSON: ${(err as Error).message}`)
          console.log(`    raw: ${text.text.slice(0, 300)}`)
        }
      }
    } else if (spec.route === "coach") {
      const toolUses = message.content.filter((b) => b.type === "tool_use")
      console.log(`    tool_use blocks: ${toolUses.map((t) => (t as Anthropic.ToolUseBlock).name).join(", ") || "none"}`)
    }
    return true
  } catch (err) {
    console.log(`  ${spec.route}: FAILED`)
    if (err instanceof Anthropic.APIError) {
      // Report what the API actually said, not a paraphrase of it.
      console.log(`    ${err.constructor.name} status=${err.status}`)
      console.log(`    ${err.message}`)
      if (err.error) console.log(`    body: ${JSON.stringify(err.error)}`)
    } else {
      console.log(`    ${(err as Error).stack ?? String(err)}`)
    }
    return false
  }
}

/** Two identical requests back to back; the second should read the cache. */
async function cacheTest(spec: Spec) {
  try {
    const first = await send(spec)
    const second = await send(spec)
    const w1 = first.usage.cache_creation_input_tokens ?? 0
    const r2 = second.usage.cache_read_input_tokens ?? 0

    console.log(
      `  ${spec.route.padEnd(18)} write#1=${String(w1).padStart(5)}  read#2=${String(r2).padStart(5)}  ` +
        `${r2 > 0 ? "HIT" : w1 > 0 ? "WROTE BUT DID NOT READ" : "NOTHING CACHED"}`,
    )
  } catch (err) {
    console.log(`  ${spec.route}: FAILED — ${(err as Error).message}`)
  }
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const phase = args.find((a) => !a.startsWith("--")) ?? "all"
  const only = args.find((a) => a.startsWith("--route="))?.split("=")[1]
  const specs = only ? SPECS.filter((s) => s.route === only) : SPECS

  if (specs.length === 0) {
    console.error(`no route matching ${only}; known: ${SPECS.map((s) => s.route).join(", ")}`)
    process.exit(1)
  }

  if (phase === "measure" || phase === "all") {
    console.log("\n── cacheable prefix (tools + system up to the breakpoint) ──")
    const results = []
    for (const spec of specs) results.push(await measure(spec))
    const deadWeight = results.filter((r) => !r.caches).map((r) => r.route)
    if (deadWeight.length > 0) {
      console.log(`\n  cache_control is a no-op on: ${deadWeight.join(", ")}`)
    }
  }

  if (phase === "smoke" || phase === "all") {
    console.log("\n── live request per route shape ──")
    let failures = 0
    for (const spec of specs) if (!(await smoke(spec))) failures++
    if (failures > 0) console.log(`\n  ${failures} of ${specs.length} route shapes failed`)
  }

  if (phase === "cache" || phase === "all") {
    console.log("\n── cache read on a repeated identical request ──")
    for (const spec of specs) await cacheTest(spec)
  }

  console.log()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
