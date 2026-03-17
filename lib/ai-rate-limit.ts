/**
 * Per-user AI request rate limiter backed by Supabase.
 *
 * Limits: 20 AI requests per user per hour (across all AI endpoints combined).
 * Uses an upsert on ai_rate_limits(user_id, hour_bucket) so multiple serverless
 * instances stay in sync.
 */

import { createServiceClient } from "@/lib/supabase/service"

const MAX_REQUESTS_PER_HOUR = 20

export interface RateLimitResult {
  allowed: boolean
  /** How many requests the user has made this hour after this one */
  count: number
  /** Max allowed per hour */
  limit: number
  /** ISO string for when the current window resets */
  resetAt: string
}

/**
 * Check and increment the rate limit for the given user.
 * Returns `allowed: false` when the user has exceeded the limit.
 * On any database error the limit check is skipped (fail open) to avoid
 * blocking legitimate requests due to infra issues.
 */
export async function checkAiRateLimit(userId: string): Promise<RateLimitResult> {
  const service = createServiceClient()

  // Truncate to the current hour
  const now = new Date()
  const hourBucket = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours())
  ).toISOString()

  const resetAt = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() + 1)
  ).toISOString()

  try {
    // Upsert: insert or increment atomically
    const { data, error } = await service.rpc("increment_ai_rate_limit", {
      p_user_id: userId,
      p_hour_bucket: hourBucket,
    })

    if (error) {
      // Fail open — don't block users if rate limit infra has an issue
      console.error("[ai-rate-limit] RPC error:", error.message)
      return { allowed: true, count: 0, limit: MAX_REQUESTS_PER_HOUR, resetAt }
    }

    const count = data as number
    return {
      allowed: count <= MAX_REQUESTS_PER_HOUR,
      count,
      limit: MAX_REQUESTS_PER_HOUR,
      resetAt,
    }
  } catch (err) {
    console.error("[ai-rate-limit] Unexpected error:", err)
    return { allowed: true, count: 0, limit: MAX_REQUESTS_PER_HOUR, resetAt }
  }
}

/** Standard 429 response with rate limit headers */
export function rateLimitExceededResponse(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({
      error: "Too many AI requests. You can make up to 20 AI requests per hour.",
      limit: result.limit,
      resetAt: result.resetAt,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(Math.max(0, result.limit - result.count)),
        "X-RateLimit-Reset": result.resetAt,
        "Retry-After": String(
          Math.ceil((new Date(result.resetAt).getTime() - Date.now()) / 1000)
        ),
      },
    }
  )
}
