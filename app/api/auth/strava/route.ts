import { NextResponse, type NextRequest } from "next/server"
import { randomUUID } from "crypto"
import { createClient } from "@/lib/supabase/server"
import { safeNext } from "@/lib/auth-redirect"
import { encodeStravaState } from "@/lib/strava-oauth-state"

/**
 * GET /api/auth/strava
 *
 * Sends the athlete to Strava's authorisation page. Two callers:
 *
 *  - A signed-in runner connecting their athlete (`flow: "link"`).
 *  - A signed-out runner using Strava as the way in (`flow: "login"`).
 *
 * Which one it is depends only on whether there is a session, and the answer
 * travels in the state cookie so the callback does not have to work it out
 * again from a session that the login flow will have created by then.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const clientId = process.env.STRAVA_CLIENT_ID
  if (!clientId) {
    return NextResponse.json({ error: "STRAVA_CLIENT_ID is not configured" }, { status: 500 })
  }

  const rawBaseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
  const baseUrl = rawBaseUrl.replace(/\/+$/, "")
  const callbackUrl = `${baseUrl}/api/auth/strava/callback`

  const nonce = randomUUID()
  const state = encodeStravaState({
    nonce,
    flow: user ? "link" : "login",
    next: safeNext(request.nextUrl.searchParams.get("next")),
  })

  const stravaAuthUrl = new URL("https://www.strava.com/oauth/authorize")
  stravaAuthUrl.searchParams.set("client_id", clientId)
  stravaAuthUrl.searchParams.set("redirect_uri", callbackUrl)
  stravaAuthUrl.searchParams.set("response_type", "code")
  stravaAuthUrl.searchParams.set("approval_prompt", "auto")
  stravaAuthUrl.searchParams.set("scope", "read,activity:read_all")
  // Strava only ever sees the nonce. Everything else stays in the cookie.
  stravaAuthUrl.searchParams.set("state", nonce)

  const response = NextResponse.redirect(stravaAuthUrl.toString())
  response.cookies.set("strava_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  })
  return response
}
