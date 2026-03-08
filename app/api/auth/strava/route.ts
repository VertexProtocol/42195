import { NextResponse, type NextRequest } from "next/server"
import { randomUUID } from "crypto"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"

/**
 * GET /api/auth/strava
 *
 * Redirects the authenticated user to Strava's OAuth authorization page.
 * The user must already be signed in to Supabase.
 *
 * A random `state` value is generated per request and stored both in a
 * cookie (primary) and in the strava_tokens table (fallback for mobile
 * Safari which can drop cookies on redirects).
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

  // Store state server-side as fallback (mobile Safari can lose cookies on redirects)
  const service = createServiceClient()
  await service.from("strava_tokens").upsert(
    {
      user_id: user.id,
      oauth_state: state,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  )

  const stravaAuthUrl = new URL("https://www.strava.com/oauth/authorize")
  stravaAuthUrl.searchParams.set("client_id", clientId)
  stravaAuthUrl.searchParams.set("redirect_uri", callbackUrl)
  stravaAuthUrl.searchParams.set("response_type", "code")
  stravaAuthUrl.searchParams.set("approval_prompt", "force")
  stravaAuthUrl.searchParams.set("scope", "read,activity:read_all,activity:write")
  stravaAuthUrl.searchParams.set("state", state)

  const response = NextResponse.redirect(stravaAuthUrl.toString())
  // Cookie as primary CSRF check; DB as fallback
  response.cookies.set("strava_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  })
  return response
}
