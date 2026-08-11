/**
 * Token accounting for AI calls.
 *
 * Nothing recorded token usage before this. That left two questions
 * unanswerable: what an AI feature costs, and whether the `cache_control`
 * breakpoints on the system prompts do anything at all — a prompt below the
 * minimum cacheable size silently caches nothing, with no error and no warning.
 *
 * Both questions have since been answered by measurement: all six routes were
 * counted with `messages.count_tokens` and exercised against the real API, and
 * the three whose prefixes could never reach their model's minimum
 * (plan-check, weekly-review, activity-analysis) had their breakpoints removed.
 * The three that remain — training-plan, race-strategy, coach — were each
 * observed reading from cache. `scripts/smoke/smoke.mjs` re-runs that check.
 *
 * A cache breakpoint that is working shows `cacheRead` climbing on repeat calls
 * within the TTL. `cacheRead` stuck at 0 across repeated requests means the
 * prefix is too short, or something above it in the prompt varies per request.
 */

/**
 * Structural shape of the `usage` object on a message response. Declared here
 * rather than imported so this works with both the stable and beta message
 * types without coupling the logger to either.
 */
export interface AiUsageLike {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

/**
 * Logs one AI call's token usage.
 *
 * @param route  Which endpoint spent the tokens, e.g. "training-plan"
 * @param usage  The `usage` object from the message response
 * @param meta   Anything that helps trace the call — a goal id, an activity id
 */
export function logAiUsage(
  route: string,
  usage: AiUsageLike,
  meta: Record<string, unknown> = {},
): void {
  console.log(`[ai-usage] ${route}`, {
    ...meta,
    input: usage.input_tokens,
    output: usage.output_tokens,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
  })
}

/**
 * Sums usage across the turns of a tool-use loop, so a conversation that took
 * six round trips is reported as one number per field rather than six log lines
 * nobody adds up.
 */
export function sumAiUsage(turns: AiUsageLike[]): AiUsageLike {
  return turns.reduce<AiUsageLike>(
    (total, u) => ({
      input_tokens: total.input_tokens + u.input_tokens,
      output_tokens: total.output_tokens + u.output_tokens,
      cache_read_input_tokens:
        (total.cache_read_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      cache_creation_input_tokens:
        (total.cache_creation_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    }),
    { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  )
}
