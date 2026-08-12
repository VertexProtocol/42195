import { safeNext } from "@/lib/auth-redirect"

/**
 * What the Strava round trip has to remember.
 *
 * It used to be a bare nonce, because there was only one thing the callback
 * could be: an already-signed-in runner linking their athlete. Now the same
 * redirect also signs people in, so the callback has to know which of the two
 * it is looking at — and where the runner was heading before any of this
 * started.
 *
 * It lives in an httpOnly cookie, not in the `state` parameter Strava echoes
 * back. Strava sees only the nonce, and the two are compared on return, so
 * `state` keeps doing the one job it had.
 */

export type StravaFlow = "link" | "login"

export interface StravaOAuthState {
  /** Compared against the `state` Strava echoes back. */
  nonce: string
  flow: StravaFlow
  /** Where to land afterwards. Already reduced by `safeNext`. */
  next: string
}

export function encodeStravaState(state: StravaOAuthState): string {
  const json = JSON.stringify({ n: state.nonce, f: state.flow, x: state.next })
  return Buffer.from(json, "utf8").toString("base64url")
}

/**
 * Read a cookie back. Returns null for anything that is not one of ours —
 * a cookie from before this shape existed, a truncated value, a hand-written
 * one. The caller treats null the same as a missing cookie: refuse.
 */
export function decodeStravaState(raw: string | undefined): StravaOAuthState | null {
  if (!raw) return null

  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
    if (typeof parsed?.n !== "string" || !parsed.n) return null
    if (parsed.f !== "link" && parsed.f !== "login") return null

    return {
      nonce: parsed.n,
      flow: parsed.f,
      // Validated again on the way out: the cookie is ours and httpOnly, but
      // this value began life in a URL and ends up in a redirect.
      next: safeNext(typeof parsed.x === "string" ? parsed.x : null),
    }
  } catch {
    return null
  }
}

/**
 * The destination with the flag that makes Today start a sync on arrival.
 * A runner who has just authorised Strava should not have to ask for their
 * own history.
 */
export function withSyncOnArrival(next: string): string {
  const url = new URL(safeNext(next), "http://redirect.invalid")
  url.searchParams.set("strava_connected", "1")
  return `${url.pathname}${url.search}`
}
