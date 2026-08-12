import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { withNext } from "@/lib/auth-redirect"
import { decodeStravaState, withSyncOnArrival } from "@/lib/strava-oauth-state"
import { stravaSignupEnabled, type StravaAthlete } from "@/lib/strava-account"
import {
  createAccountForAthlete,
  findUserIdForAthlete,
  startSessionForEmail,
} from "@/lib/strava-identity"

interface StravaTokenResponse {
  token_type: string
  expires_at: number // Unix timestamp
  expires_in: number
  refresh_token: string
  access_token: string
  athlete: StravaAthlete
}

/**
 * GET /api/auth/strava/callback
 *
 * Handles the OAuth redirect from Strava.
 * 1. Verifies the CSRF state cookie matches the `state` query parameter.
 * 2. Exchanges the authorization code for tokens.
 * 3. Establishes who this is — see the fork below.
 * 4. Stores tokens in strava_tokens via the service client (bypasses RLS).
 *
 * Step 3 is the part that makes this an authentication route and not only a
 * connection one. A signed-in runner is linking their athlete, as before. A
 * signed-out one is signing in, and there are three possible answers: the
 * athlete is already someone's, in which case that is who they are; the
 * athlete is nobody's, in which case an account is made for them; or the
 * athlete belongs to a different account than the session holds, which is
 * refused, exactly as it was before.
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
  const grantedScope = searchParams.get("scope") ?? ""

  // User explicitly denied access on Strava's side
  if (errorParam) {
    return errorRedirect("Strava access was denied.")
  }

  if (!code) {
    return errorRedirect("No authorization code received from Strava.")
  }

  // Strava lets the athlete untick individual permissions on the consent
  // screen. Without activity:read_all there is nothing to sync, so say that
  // now rather than failing on the first sync.
  if (!grantedScope.split(",").includes("activity:read_all")) {
    return errorRedirect("strava_missing_scope")
  }

  // CSRF check. The cookie carries the nonce Strava echoed back, plus which
  // flow this is and where the runner was heading — checked before anything
  // is exchanged or written.
  const state = decodeStravaState(request.cookies.get("strava_oauth_state")?.value)
  if (!state || stateParam !== state.nonce) {
    return errorRedirect("Invalid OAuth state. Please try connecting again.")
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // A link that started signed in and arrived signed out is a session that
  // expired mid-round-trip. Sign in and try again — do not silently turn it
  // into a sign-up for whoever is holding the phone.
  if (state.flow === "link" && !user) {
    const res = NextResponse.redirect(`${baseUrl}${withNext("/auth/login", state.next)}`)
    res.cookies.delete("strava_oauth_state")
    return res
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
  const athleteId = tokens.athlete.id

  // ── Who is this? ─────────────────────────────────────────────────────────
  // The athlete's existing owner, if it has one. This is the whole of the
  // account matching: the row was written under someone's own session, so
  // following it is not a guess about identity, it is a record of one.
  const ownerUserId = await findUserIdForAthlete(athleteId)

  // One athlete, one account. Two accounts sharing an athlete_id would make the
  // webhook's athlete_id lookup ambiguous and silently drop every delivery for
  // both of them, so refuse the second link.
  if (user && ownerUserId && ownerUserId !== user.id) {
    return errorRedirect("strava_already_linked")
  }

  // Whether this athlete has just been given an account, which decides where
  // they land: everyone else goes to the app, a new runner is asked for an
  // address on the way through.
  let created = false
  let userId = user?.id ?? null

  if (!userId) {
    if (ownerUserId) {
      // Coming back. Sign in as the account this athlete already belongs to.
      const { data: owner } = await createServiceClient().auth.admin.getUserById(ownerUserId)
      const ownerEmail = owner.user?.email
      if (!ownerEmail || !(await startSessionForEmail(ownerEmail))) {
        return errorRedirect("strava_session_failed")
      }
      userId = ownerUserId
    } else {
      // New here. The gate, not the Supabase project setting — the admin call
      // below is not subject to that one.
      if (!stravaSignupEnabled()) {
        return errorRedirect("strava_signup_closed")
      }

      const account = await createAccountForAthlete(tokens.athlete)
      if (!account || !(await startSessionForEmail(account.email))) {
        return errorRedirect("strava_session_failed")
      }
      userId = account.userId
      created = true
    }
  }

  // Store tokens using the service client — never accessible from the browser
  const service = createServiceClient()

  const { error: upsertError } = await service.from("strava_tokens").upsert(
    {
      user_id: userId,
      athlete_id: athleteId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: new Date(tokens.expires_at * 1000).toISOString(),
      scope: grantedScope,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  )

  if (upsertError) {
    // 23505 = unique violation on athlete_id: another account claimed this
    // athlete between the check above and the write.
    if (upsertError.code === "23505") {
      return errorRedirect("strava_already_linked")
    }
    console.error("Failed to save Strava tokens:", upsertError)
    return errorRedirect("Failed to save Strava connection.")
  }

  // Success — clear state cookie and send the runner on.
  //
  // ?strava_connected=1 makes Today pull the whole history on arrival, and it
  // belongs only to a connection that did not exist a moment ago: a new
  // account, or an athlete linking for the first time. Signing in with Strava
  // is not that. Sending every sign-in through a full history sync would put
  // a returning runner through their entire back catalogue — and Strava's
  // rate limit — to fetch what the app already has.
  const isNewConnection = created || !ownerUserId
  const destination = isNewConnection ? withSyncOnArrival(state.next) : state.next

  // A brand-new account has no address anyone can reach. Ask for one now,
  // while it is obvious why — the screen hands over to `destination` either
  // way, so nobody is held there.
  const res = NextResponse.redirect(
    created
      ? `${baseUrl}${withNext("/auth/finish", destination)}`
      : `${baseUrl}${destination}`,
  )
  res.cookies.delete("strava_oauth_state")
  return res
}
