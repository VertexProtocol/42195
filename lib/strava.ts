import { createServiceClient } from "@/lib/supabase/service"

interface StravaTokenRow {
  access_token: string
  refresh_token: string
  expires_at: string
  scope: string | null
}

interface StravaRefreshResponse {
  access_token: string
  refresh_token: string
  expires_at: number
}

/**
 * Returns a valid Strava access token for the given user,
 * refreshing it if it is expired or about to expire.
 */
export async function getStravaAccessToken(userId: string): Promise<string> {
  const service = createServiceClient()

  const { data: tokenRow, error } = await service
    .from("strava_tokens")
    .select("access_token, refresh_token, expires_at, scope")
    .eq("user_id", userId)
    .single<StravaTokenRow>()

  if (error || !tokenRow) {
    throw new Error("No Strava account connected")
  }

  // Check if we have valid tokens (not placeholder values from incomplete OAuth)
  if (!tokenRow.refresh_token || tokenRow.refresh_token === "") {
    throw new Error("Strava connection incomplete. Please reconnect your Strava account.")
  }

  const expiresAt = new Date(tokenRow.expires_at)
  const nowPlusBuffer = new Date(Date.now() + 60_000)

  // If token is still valid, return it
  if (expiresAt > nowPlusBuffer && tokenRow.access_token && tokenRow.access_token !== "") {
    return tokenRow.access_token
  }

  // Refresh the token
  console.log(`Refreshing Strava token for user ${userId}`)
  
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
    const errorBody = await res.text()
    console.error(`Strava token refresh failed (${res.status}):`, errorBody)
    
    // If refresh token is invalid (400/401), the user needs to reconnect
    if (res.status === 400 || res.status === 401) {
      // Clear the invalid tokens so the user can reconnect
      await service
        .from("strava_tokens")
        .delete()
        .eq("user_id", userId)
      
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

  console.log(`Strava token refreshed successfully for user ${userId}`)
  return refreshed.access_token
}
