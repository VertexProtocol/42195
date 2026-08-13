import { logError } from "@/lib/log"

/**
 * Whether this Supabase project is currently accepting new accounts.
 *
 * There used to be a second switch for this. Registration is closed at the
 * project level, and `auth.admin.createUser` — which is how an account arrives
 * from Strava, since Strava is not a Supabase auth provider — is not subject
 * to that setting. So the Strava path carried its own environment variable,
 * and the two could disagree.
 *
 * They did. Closing registration in Supabase left the environment variable on,
 * the Strava door stayed open, and an athlete who had never been invited
 * signed themselves in. The variable is gone: this asks the project.
 *
 * `/auth/v1/settings` is GoTrue's public settings document — the same one the
 * browser client reads to decide which providers to offer. `disable_signup`
 * mirrors "Allow new users to sign up" in the dashboard, so the dashboard
 * toggle is now the only thing that decides, for both ways in, and it takes
 * effect the moment it is flipped rather than on the next deployment.
 */

/**
 * Reads the answer out of a settings document.
 *
 * Fails closed, deliberately and in every direction: a payload that is not an
 * object, or that has no `disable_signup`, or whose `disable_signup` is not a
 * boolean, all count as closed. The cost of being wrong that way is an
 * invited runner seeing "not open for new accounts yet" and telling us. The
 * cost of the other way is the thing this function exists to prevent.
 */
export function parseSignupsAllowed(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null) return false
  const disabled = (payload as { disable_signup?: unknown }).disable_signup
  if (typeof disabled !== "boolean") return false
  return !disabled
}

/**
 * Asks the project whether it is open.
 *
 * Called once per Strava sign-in that finds no existing account, which is
 * rare enough not to be worth caching — and a cache here would reintroduce
 * exactly the lag the environment variable had.
 */
export async function signupsAllowed(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    logError("auth.settings", "Supabase URL or anon key missing")
    return false
  }

  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/settings`, {
      headers: { apikey: anonKey },
      // The answer changes the moment the dashboard toggle does, which is the
      // whole point of asking rather than reading a build-time variable.
      cache: "no-store",
    })

    if (!res.ok) {
      logError("auth.settings", `settings responded ${res.status}`)
      return false
    }

    return parseSignupsAllowed(await res.json())
  } catch (err) {
    logError("auth.settings", err instanceof Error ? err.message : String(err))
    return false
  }
}
