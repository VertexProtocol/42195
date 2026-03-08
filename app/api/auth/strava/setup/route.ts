import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"

/**
 * POST /api/auth/strava/setup
 *
 * One-time bootstrap endpoint that seeds the strava_tokens table for the
 * currently signed-in user using the STRAVA_BOOTSTRAP_* environment variables.
 *
 * Flow:
 *  1. Verify the caller is signed in.
 *  2. Exchange the bootstrap refresh token for a fresh access token + new
 *     refresh token (ensures the stored tokens are always valid on first use).
 *  3. Fetch the authenticated Strava athlete to get their athlete_id.
 *  4. Upsert the tokens into strava_tokens (replaces any existing row).
 *
 * After calling this endpoint successfully, the STRAVA_BOOTSTRAP_* variables
 * can safely be removed from your environment.
 */
export async function POST(request: NextRequest) {
  // ── 1. Auth check ──────────────────────────────────────────────────────────
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // ── 2. Validate bootstrap env vars ────────────────────────────────────────
  const clientId = process.env.STRAVA_CLIENT_ID
  const clientSecret = process.env.STRAVA_CLIENT_SECRET
  const bootstrapRefreshToken = process.env.STRAVA_BOOTSTRAP_REFRESH_TOKEN

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "STRAVA_CLIENT_ID or STRAVA_CLIENT_SECRET is not configured" },
      { status: 500 },
    )
  }

  if (!bootstrapRefreshToken) {
    return NextResponse.json(
      { error: "STRAVA_BOOTSTRAP_REFRESH_TOKEN is not configured" },
      { status: 500 },
    )
  }

  // ── 3. Exchange refresh token for a fresh access token ────────────────────
  const tokenRes = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: bootstrapRefreshToken,
    }),
  })

  if (!tokenRes.ok) {
    const body = await tokenRes.text()
    console.error(`Strava bootstrap token refresh failed (${tokenRes.status}):`, body)
    return NextResponse.json(
      { error: "Failed to refresh bootstrap token. Check STRAVA_BOOTSTRAP_REFRESH_TOKEN." },
      { status: 502 },
    )
  }

  const refreshed = (await tokenRes.json()) as {
    access_token: string
    refresh_token: string
    expires_at: number
  }

  // ── 4. Verify activity scope before storing ────────────────────────────────
  // Strava returns 401 for activity:read scope issues (not 403), so we probe
  // the activities endpoint early to catch scope problems with a clear message.
  const scopeCheckRes = await fetch(
    "https://www.strava.com/api/v3/athlete/activities?per_page=1",
    { headers: { Authorization: `Bearer ${refreshed.access_token}` } },
  )
  if (!scopeCheckRes.ok) {
    const body = await scopeCheckRes.text()
    console.error(`Strava scope check failed (${scopeCheckRes.status}):`, body)
    return NextResponse.json(
      {
        error:
          "Bootstrap token lacks activity read permission (activity:read_all). " +
          "Obtain a token via the full OAuth flow which requests the correct scopes.",
      },
      { status: 403 },
    )
  }

  // ── 5. Fetch athlete info ──────────────────────────────────────────────────
  const athleteRes = await fetch("https://www.strava.com/api/v3/athlete", {
    headers: { Authorization: `Bearer ${refreshed.access_token}` },
  })

  if (!athleteRes.ok) {
    const body = await athleteRes.text()
    console.error(`Strava athlete fetch failed (${athleteRes.status}):`, body)
    return NextResponse.json(
      { error: "Failed to fetch Strava athlete profile." },
      { status: 502 },
    )
  }

  const athlete = (await athleteRes.json()) as {
    id: number
    firstname: string
    lastname: string
  }

  // ── 6. Upsert tokens ──────────────────────────────────────────────────────
  const service = createServiceClient()
  const { error: upsertError } = await service.from("strava_tokens").upsert(
    {
      user_id: user.id,
      athlete_id: athlete.id,
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: new Date(refreshed.expires_at * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  )

  if (upsertError) {
    console.error("Failed to save bootstrap Strava tokens:", upsertError)
    return NextResponse.json({ error: "Failed to save Strava tokens to database." }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    athlete: {
      id: athlete.id,
      name: `${athlete.firstname} ${athlete.lastname}`,
    },
    expires_at: new Date(refreshed.expires_at * 1000).toISOString(),
    message:
      "Strava tokens bootstrapped successfully. You can now remove STRAVA_BOOTSTRAP_* from your environment.",
  })
}
