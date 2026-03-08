import { NextResponse, type NextRequest } from "next/server"
import { randomUUID } from "crypto"
import { createClient } from "@/lib/supabase/server"

/**
 * GET /api/auth/strava
 *
 * Redirects the authenticated user to Strava's OAuth authorization page.
 * The user must already be signed in to Supabase.
 *
 * A random `state` value is generated per request and stored in an HttpOnly
 * cookie. The callback verifies the returned state matches, preventing CSRF
 * attacks where an attacker could trick a user into linking the wrong Strava
 * account.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(new URL("/auth/login", request.url))
  }

  const clientId = process.env.STRAVA_CLIENT_ID
  if (!clientId) {
    return NextResponse.json({ error: "STRAVA_CLIENT_ID is not configured" }, { status: 500 })
  }

  const rawBaseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
  const baseUrl = rawBaseUrl.replace(/\/+$/, "")
  const callbackUrl = `${baseUrl}/api/auth/strava/callback`

  // Generate an unguessable state token for CSRF protection
  const state = randomUUID()

  const stravaAuthUrl = new URL("https://www.strava.com/oauth/authorize")
  stravaAuthUrl.searchParams.set("client_id", clientId)
  stravaAuthUrl.searchParams.set("redirect_uri", callbackUrl)
  stravaAuthUrl.searchParams.set("response_type", "code")
  stravaAuthUrl.searchParams.set("approval_prompt", "auto")
  stravaAuthUrl.searchParams.set("scope", "read,activity:read_all,activity:write")
  stravaAuthUrl.searchParams.set("state", state)

  const response = NextResponse.redirect(stravaAuthUrl.toString())
  // HttpOnly so JS can't read it; SameSite=Lax allows the Strava redirect back
  response.cookies.set("strava_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600, // 10 minutes — enough time to complete OAuth
    path: "/",
  })
  return response
}
