import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { recordServerError } from "@/lib/error-sink"
import { athleteDisplayName, placeholderEmailFor, type StravaAthlete } from "@/lib/strava-account"

/**
 * Strava as a way in, not only a source of runs.
 *
 * Supabase has no Strava provider and cannot be given one — Strava speaks
 * plain OAuth 2.0, so there is no OIDC id token to hand to
 * `signInWithIdToken`. The app already runs the whole Strava OAuth flow
 * itself, though, so the only missing piece is turning "this is athlete
 * 12345" into a signed-in browser. That is what this file is.
 *
 * The mapping it reads is `strava_tokens.athlete_id`, which is unique and was
 * written under the runner's own session when they connected. So signing in
 * with Strava never has to guess whether two accounts are the same person: it
 * follows a link that was authenticated when it was made.
 *
 * Server only. The pure half — the placeholder address, the athlete's name —
 * lives in `strava-account`, where the browser can reach it too.
 */

/**
 * The account this athlete already belongs to, if any.
 *
 * Read with the service client: the caller has no session yet, so RLS would
 * see an anonymous request and return nothing.
 */
export async function findUserIdForAthlete(athleteId: number): Promise<string | null> {
  const service = createServiceClient()
  const { data, error } = await service
    .from("strava_tokens")
    .select("user_id")
    .eq("athlete_id", athleteId)
    .maybeSingle()

  if (error) {
    await recordServerError("strava.identity.lookup", error)
    return null
  }

  return (data?.user_id as string | undefined) ?? null
}

/**
 * Make an account for an athlete who has never been here.
 *
 * `email_confirm: true` because there is nothing to confirm — the address is a
 * placeholder nobody can read, and the proof of identity was the Strava
 * consent screen. The name and photo go into user metadata, which is where
 * `handle_new_user` reads them from, so the profile row arrives populated
 * rather than being patched afterwards.
 */
export async function createAccountForAthlete(
  athlete: StravaAthlete,
): Promise<{ userId: string; email: string } | null> {
  const service = createServiceClient()
  const email = placeholderEmailFor(athlete.id)

  const { data, error } = await service.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      display_name: athleteDisplayName(athlete),
      avatar_url: athlete.profile_medium ?? athlete.profile ?? null,
      // Read by Profile to offer "set a password" rather than "change" it,
      // and to know this account has one way in until it has two.
      auth_source: "strava",
      strava_athlete_id: athlete.id,
    },
  })

  if (error || !data.user) {
    await recordServerError("strava.identity.create", error ?? "no user returned")
    return null
  }

  return { userId: data.user.id, email }
}

/**
 * Sign this account in on this browser.
 *
 * There is no admin "create a session" call, so the session is minted the long
 * way round: `generateLink` produces a one-time hash for the account without
 * sending any mail, and `verifyOtp` redeems it here on the server, which is
 * what writes the session cookies. The runner never sees a link.
 */
export async function startSessionForEmail(email: string): Promise<boolean> {
  const service = createServiceClient()

  const { data, error } = await service.auth.admin.generateLink({
    type: "magiclink",
    email,
  })

  const hashedToken = data?.properties?.hashed_token
  if (error || !hashedToken) {
    await recordServerError("strava.identity.link", error ?? "no hashed_token returned")
    return false
  }

  const supabase = await createClient()
  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: hashedToken,
  })

  if (verifyError) {
    await recordServerError("strava.identity.verify", verifyError)
    return false
  }

  return true
}
