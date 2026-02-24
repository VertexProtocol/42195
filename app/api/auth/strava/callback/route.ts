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
 * Exchanges the authorization code for tokens and stores them in strava_tokens.
 * The strava_tokens table is managed via the service client (bypasses RLS) so
 * that tokens are never accessible from the browser.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get("code")
  const errorParam = searchParams.get("error")

  // User denied access on Strava's side
  if (errorParam) {
    return NextResponse.redirect(
      new URL(`/auth/error?message=${encodeURIComponent("Strava access was denied.")}`, request.url),
    )
  }

  if (!code) {
    return NextResponse.redirect(
      new URL(`/auth/error?message=${encodeURIComponent("No authorization code received from Strava.")}`, request.url),
    )
  }

  // Verify the user is still authenticated with Supabase
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(new URL("/auth/login", request.url))
  }

  // Exchange authorization code for tokens
  const tokenRes = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
    }),
  })

  if (!tokenRes.ok) {
    const body = await tokenRes.text()
    return NextResponse.redirect(
      new URL(
        `/auth/error?message=${encodeURIComponent(`Strava token exchange failed: ${body}`)}`,
        request.url,
      ),
    )
  }

  const tokens = (await tokenRes.json()) as StravaTokenResponse

  // Store tokens using the service client so they stay server-side only
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
    return NextResponse.redirect(
      new URL(
        `/auth/error?message=${encodeURIComponent("Failed to save Strava connection.")}`,
        request.url,
      ),
    )
  }

  // Trigger an initial sync and send the user back to the app
  return NextResponse.redirect(new URL("/", request.url))
}
