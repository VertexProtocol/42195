import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"

interface StravaTokenResponse {
  token_type: string
  expires_at: number // Unix timestamp
  expires_in: number
  refresh_token: string
  access_token: string
  athlete: {
    id: number
    firstname: string
    lastname: string
  }
}

/**
 * GET /api/auth/strava/callback
 *
 * Handles the OAuth redirect from Strava.
 * 1. Verifies the CSRF state cookie matches the `state` query parameter.
 * 2. Exchanges the authorization code for tokens.
 * 3. Stores tokens in strava_tokens via the service client (bypasses RLS).
 *
 * Strava API error details are logged server-side only — the browser only
 * receives a generic message to avoid leaking internal error text.
 */
export async function GET(request: NextRequest) {
  const rawBaseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
  const baseUrl = rawBaseUrl.replace(/\/+$/, "")

  // Helper: redirect to error page and always clear the state cookie
  const errorRedirect = (message: string): NextResponse => {
    const res = NextResponse.redirect(
      `${baseUrl}/auth/error?message=${encodeURIComponent(message)}`,
    )
    res.cookies.delete("strava_oauth_state")
    return res
  }

  const { searchParams } = request.nextUrl
  const code = searchParams.get("code")
  const errorParam = searchParams.get("error")
  const stateParam = searchParams.get("state")

  // User explicitly denied access on Strava's side
  if (errorParam) {
    return errorRedirect("Strava access was denied.")
  }

  if (!code) {
    return errorRedirect("No authorization code received from Strava.")
  }

  // Verify the user is still authenticated with Supabase
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const res = NextResponse.redirect(`${baseUrl}/auth/login`)
    res.cookies.delete("strava_oauth_state")
    return res
  }

  // CSRF check — verify state cookie
  const cookieState = request.cookies.get("strava_oauth_state")?.value
  if (!cookieState || stateParam !== cookieState) {
    return errorRedirect("Invalid OAuth state. Please try connecting again.")
  }

  // Exchange authorization code for tokens
  const callbackUrl = `${baseUrl}/api/auth/strava/callback`
  const tokenRes = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: callbackUrl,
    }),
  })

  if (!tokenRes.ok) {
    // Log the detail server-side; don't expose Strava's error body to the browser
    const body = await tokenRes.text()
    console.error(`Strava token exchange failed (${tokenRes.status}):`, body)
    return errorRedirect("Failed to connect Strava. Please try again.")
  }

  const tokens = (await tokenRes.json()) as StravaTokenResponse

  // Store tokens using the service client — never accessible from the browser
  const service = createServiceClient()
  const { error: upsertError } = await service.from("strava_tokens").upsert(
    {
      user_id: user.id,
      athlete_id: tokens.athlete.id,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: new Date(tokens.expires_at * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  )

  if (upsertError) {
    console.error("Failed to save Strava tokens:", upsertError)
    return errorRedirect("Failed to save Strava connection.")
  }

  // Success — clear state cookie and send the user back to the app
  const res = NextResponse.redirect(`${baseUrl}/`)
  res.cookies.delete("strava_oauth_state")
  return res
}
