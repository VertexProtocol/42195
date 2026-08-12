import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { getStravaAccessToken } from "@/lib/strava"
import { isPlaceholderEmail } from "@/lib/strava-account"
import { logError, logWarn } from "@/lib/log"

/**
 * POST /api/auth/strava/disconnect
 *
 * Ends the connection between this account and its Strava athlete.
 *
 * Three things happen, in an order chosen so a failure part-way through
 * leaves the runner able to try again rather than half-disconnected:
 *
 *  1. Strava is told, with the athlete's own token, before anything local is
 *     removed. "Disconnect" that only means "we stop looking" would leave the
 *     app holding a live grant on someone's Strava account. Best effort: a
 *     grant the athlete already revoked from Strava's own settings page
 *     answers 401, which is the state we were heading for anyway.
 *  2. The tokens go. This is what makes the app stop syncing.
 *  3. The sync record goes, so the connection reads as never-synced rather
 *     than as a sync that mysteriously stopped.
 *
 * The runs stay. They are the training log — the reason the runner is here —
 * and they are unique on (user_id, strava_id), so reconnecting later updates
 * them in place rather than filling the log with doubles.
 */
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // An account that arrived through Strava has no other credential until it
  // is given one. Disconnecting would be the runner locking themselves out
  // with a button labelled as tidying up, so it is refused until there is a
  // second way in: an address they can be reached at, and a password.
  const metadata = user.user_metadata ?? {}
  const cameFromStrava = metadata.auth_source === "strava"
  const hasPassword = !cameFromStrava || metadata.has_password === true
  const hasEmail = !isPlaceholderEmail(user.email)

  if (!hasPassword || !hasEmail) {
    return NextResponse.json(
      { error: "strava_only_credential", needsPassword: !hasPassword, needsEmail: !hasEmail },
      { status: 409 },
    )
  }

  // 1 · Tell Strava.
  try {
    const accessToken = await getStravaAccessToken(user.id)
    const res = await fetch("https://www.strava.com/oauth/deauthorize", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) {
      logWarn("strava.disconnect.deauthorize", `Strava answered ${res.status}`)
    }
  } catch (err) {
    // No tokens, an expired refresh token, Strava unreachable. None of them
    // is a reason to leave the connection in place on our side.
    logWarn("strava.disconnect.deauthorize", err instanceof Error ? err.message : String(err))
  }

  const service = createServiceClient()

  // 2 · Forget the tokens.
  const { error: tokenError } = await service
    .from("strava_tokens")
    .delete()
    .eq("user_id", user.id)

  if (tokenError) {
    logError("strava.disconnect.tokens", tokenError.message)
    return NextResponse.json({ error: "disconnect_failed" }, { status: 500 })
  }

  // 3 · Forget the sync. Not fatal if it fails — the connection is already
  // gone, and a stale row here only misreports when the last sync was.
  const { error: syncError } = await service
    .from("sync_status")
    .delete()
    .eq("user_id", user.id)

  if (syncError) logError("strava.disconnect.sync", syncError.message)

  return NextResponse.json({ ok: true })
}
