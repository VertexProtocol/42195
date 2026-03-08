import { createServiceClient } from "@/lib/supabase/service"

interface StravaTokenRow {
  access_token: string
  refresh_token: string
  expires_at: string
}

interface StravaRefreshResponse {
  access_token: string
  refresh_token: string
  expires_at: number
}

/**
 * Returns a valid Strava access token for the given user,
 * refreshing it if it is expired or about to expire.
 *
 * Pass `forceRefresh` to skip the expiry check (e.g. after a 401).
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
    throw new Error("No Strava account connected")
  }

  const expiresAt = new Date(tokenRow.expires_at)
  const nowPlusBuffer = new Date(Date.now() + 60_000)

  if (!forceRefresh && expiresAt > nowPlusBuffer) {
    return tokenRow.access_token
  }

  // Refresh the token
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: tokenRow.refresh_token,
    }),
  })

  if (!res.ok) {
    if (res.status === 401 || res.status === 400) {
      throw new Error("Strava session expired. Please reconnect your Strava account.")
    }
    throw new Error(`Strava token refresh failed: ${res.status}`)
  }

  const refreshed = (await res.json()) as StravaRefreshResponse

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
