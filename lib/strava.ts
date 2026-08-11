import { createServiceClient } from "@/lib/supabase/service"

interface StravaTokenRow {
  access_token: string
  refresh_token: string
  expires_at: string
}

interface StravaRefreshResponse {
  access_token: string
  refresh_token: string
  expires_at: number // Unix timestamp
}

// Buffer before expiry within which we proactively refresh the token.
const EXPIRY_BUFFER_MS = 60_000

/**
 * Structured error for Strava authentication failures.
 * Carry a machine-readable `code` so callers can react without
 * string-matching the human-readable message.
 */
export class StravaAuthError extends Error {
  readonly code: "STRAVA_NOT_CONNECTED" | "STRAVA_DISCONNECTED"

  constructor(
    message: string,
    code: "STRAVA_NOT_CONNECTED" | "STRAVA_DISCONNECTED",
  ) {
    super(message)
    this.name = "StravaAuthError"
    this.code = code
  }
}

/**
 * Sentinel thrown by withStravaRetry callbacks to signal an HTTP 401 from
 * the Strava API. Using a dedicated class avoids fragile message-string
 * matching and prevents any other error containing "401" from accidentally
 * triggering a token refresh.
 */
export class StravaUnauthorizedError extends Error {
  constructor() {
    super("Strava returned 401 — token needs refresh")
    this.name = "StravaUnauthorizedError"
  }
}

/**
 * Returns a valid Strava access token for the given user.
 *
 * If the stored token is expired (or within EXPIRY_BUFFER_MS of expiring),
 * it is automatically refreshed and the new tokens are persisted to the DB.
 *
 * Pass `forceRefresh = true` to skip the expiry check (e.g. after a 401
 * response from the Strava API indicates the token is no longer valid).
 *
 * Throws StravaAuthError if:
 *  - No Strava account is connected for the user.
 *  - The refresh token has been revoked (HTTP 400/401 from Strava).
 *
 * Throws Error for unexpected Strava API errors.
 */
export async function getStravaAccessToken(
  userId: string,
  forceRefresh = false,
): Promise<string> {
  const service = createServiceClient()

  const { data: tokenRow, error } = await service
    .from("strava_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .single<StravaTokenRow>()

  if (error || !tokenRow) {
    throw new StravaAuthError(
      "No Strava account connected. Please connect Strava in your profile.",
      "STRAVA_NOT_CONNECTED",
    )
  }

  const expiresAt = new Date(tokenRow.expires_at)
  const isExpired = expiresAt <= new Date(Date.now() + EXPIRY_BUFFER_MS)

  if (!forceRefresh && !isExpired) {
    return tokenRow.access_token
  }

  return refreshStravaToken(userId, tokenRow.refresh_token)
}

/**
 * Exchanges a refresh token for a new access + refresh token pair,
 * persists the result, and returns the new access token.
 *
 * Uses an optimistic-concurrency check: the DB update only applies if
 * the refresh_token in the DB still matches what we read. If another
 * concurrent request already refreshed the token, we fall back to reading
 * the freshly-written token instead of overwriting it with a stale value.
 */
async function refreshStravaToken(userId: string, refreshToken: string): Promise<string> {
  const clientId = process.env.STRAVA_CLIENT_ID
  const clientSecret = process.env.STRAVA_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error("Strava app credentials are not configured on the server.")
  }

  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  })

  if (!res.ok) {
    if (res.status === 401 || res.status === 400) {
      throw new StravaAuthError(
        "Strava authorization has expired or been revoked. Please reconnect your Strava account.",
        "STRAVA_DISCONNECTED",
      )
    }
    throw new Error(`Strava token refresh failed with status ${res.status}.`)
  }

  const refreshed = (await res.json()) as StravaRefreshResponse

  const service = createServiceClient()

  // Optimistic concurrency: only update if the refresh_token we used is still
  // the one in the DB. If another concurrent request already refreshed and
  // rotated the token, this update will match 0 rows — we then read back
  // whatever the winner wrote.
  const { data: updated } = await service
    .from("strava_tokens")
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: new Date(refreshed.expires_at * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("refresh_token", refreshToken)
    .select("access_token")

  if (updated && updated.length > 0) {
    return refreshed.access_token
  }

  // Another concurrent refresh won the race. Read the token it stored.
  const { data: fresh, error } = await service
    .from("strava_tokens")
    .select("access_token")
    .eq("user_id", userId)
    .single<{ access_token: string }>()

  if (error || !fresh) {
    // Highly unlikely — fall back to what we got from Strava anyway
    return refreshed.access_token
  }

  return fresh.access_token
}

/**
 * Runs `fn` with a valid Strava access token. If Strava responds with a 401,
 * the token is force-refreshed and `fn` is retried exactly once.
 *
 * This centralises the retry logic so every Strava API call gets it for free.
 *
 * Usage:
 *   const data = await withStravaRetry(userId, (token) =>
 *     fetch(`https://www.strava.com/api/v3/...`, {
 *       headers: { Authorization: `Bearer ${token}` },
 *     })
 *   )
 */
// ---------------------------------------------------------------------------
// Rate-limit aware Strava API fetch
// ---------------------------------------------------------------------------

/**
 * Error thrown when Strava returns HTTP 429 (rate limited).
 *
 * `resetAt` is when the next 15-minute window opens, so callers can tell the
 * user when to come back instead of guessing.
 */
export class StravaRateLimitError extends Error {
  readonly resetAt: Date

  constructor(message: string, resetAt: Date) {
    super(message)
    this.name = "StravaRateLimitError"
    this.resetAt = resetAt
  }
}

/**
 * Start of the next natural 15-minute window. Strava resets an application's
 * short-term limit at :00, :15, :30 and :45 past the hour.
 */
export function nextRateLimitWindow(now: Date = new Date()): Date {
  const next = new Date(now)
  next.setSeconds(0, 0)
  next.setMinutes(Math.floor(now.getMinutes() / 15) * 15 + 15)
  return next
}

/**
 * Fetch wrapper that logs Strava rate-limit headers and turns 429 responses
 * into a StravaRateLimitError. Use this for all Strava API calls inside
 * `withStravaRetry` callbacks.
 *
 * The rate limit is per application, shared by every athlete using it, so a
 * request that waits for the window to reopen holds a serverless function open
 * for up to 15 minutes and dies on the platform timeout anyway. Callers stop,
 * persist what they have, and resume after `resetAt` instead.
 *
 * Logs a warning when usage exceeds 80% of the limit.
 */
export async function stravaApiFetch(url: string, token: string): Promise<Response> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })

  // Log rate limit usage
  const limitHeader = res.headers.get("X-RateLimit-Limit")
  const usageHeader = res.headers.get("X-RateLimit-Usage")
  if (limitHeader && usageHeader) {
    const [limit15m, limitDay] = limitHeader.split(",").map(Number)
    const [usage15m, usageDay] = usageHeader.split(",").map(Number)
    const pct15m = limit15m > 0 ? Math.round((usage15m / limit15m) * 100) : 0
    const pctDay = limitDay > 0 ? Math.round((usageDay / limitDay) * 100) : 0
    if (pct15m > 80 || pctDay > 80) {
      console.warn(
        `[Strava Rate Limit] 15min: ${usage15m}/${limit15m} (${pct15m}%), daily: ${usageDay}/${limitDay} (${pctDay}%)`
      )
    }
  }

  if (res.status === 429) {
    const resetAt = nextRateLimitWindow()
    console.warn(
      `[Strava Rate Limit] 429 received. Window reopens at ${resetAt.toISOString()}.`,
    )
    throw new StravaRateLimitError(
      "Strava's rate limit for this app is spent. Syncing continues automatically once it resets.",
      resetAt,
    )
  }

  return res
}

export async function withStravaRetry<T>(
  userId: string,
  fn: (accessToken: string) => Promise<T>,
): Promise<T> {
  const token = await getStravaAccessToken(userId)
  try {
    return await fn(token)
  } catch (err) {
    if (err instanceof StravaUnauthorizedError) {
      const refreshedToken = await getStravaAccessToken(userId, true)
      return fn(refreshedToken)
    }
    throw err
  }
}
