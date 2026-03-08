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
 * Returns a valid Strava access token for the given user.
 *
 * If the stored token is expired (or within EXPIRY_BUFFER_MS of expiring),
 * it is automatically refreshed and the new tokens are persisted to the DB.
 *
 * Pass `forceRefresh = true` to skip the expiry check (e.g. after a 401
 * response from the Strava API indicates the token is no longer valid).
 *
 * Throws if:
 *  - No Strava account is connected for the user.
 *  - The refresh token has been revoked (HTTP 400/401 from Strava).
 *  - Any unexpected Strava API error occurs.
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
    throw new Error("No Strava account connected. Please connect Strava in your profile.")
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
      throw new Error(
        "Strava authorization has expired or been revoked. Please reconnect your Strava account.",
      )
    }
    throw new Error(`Strava token refresh failed with status ${res.status}.`)
  }

  const refreshed = (await res.json()) as StravaRefreshResponse

  const service = createServiceClient()
  await service
    .from("strava_tokens")
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: new Date(refreshed.expires_at * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)

  return refreshed.access_token
}
