import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * GET /api/auth/strava
 *
 * Redirects the authenticated user to Strava's OAuth authorization page.
 * The user must already be signed in to Supabase.
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

  // Use NEXT_PUBLIC_APP_URL so the redirect_uri always matches the domain
  // configured in the Strava API Application settings.
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
  const callbackUrl = new URL("/api/auth/strava/callback", baseUrl).toString()

  const stravaAuthUrl = new URL("https://www.strava.com/oauth/authorize")
  stravaAuthUrl.searchParams.set("client_id", clientId)
  stravaAuthUrl.searchParams.set("redirect_uri", callbackUrl)
  stravaAuthUrl.searchParams.set("response_type", "code")
  stravaAuthUrl.searchParams.set("approval_prompt", "auto")
  stravaAuthUrl.searchParams.set("scope", "activity:read_all")

  return NextResponse.redirect(stravaAuthUrl.toString())
}
