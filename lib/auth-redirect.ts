/**
 * Where a runner lands once they are signed in.
 *
 * Signing in is never the thing someone came to do — it is in the way of it.
 * A runner who opened a group invite, or a link straight to a race, gets sent
 * to the login screen with where they were going carried along as `next`, and
 * the sign-in, the sign-up and the email confirmation all hand that
 * destination on rather than dropping everyone on Today.
 *
 * Everything that reads `next` reads it through `safeNext`: it comes from the
 * URL, so it is attacker-controlled, and a redirect target that is allowed to
 * be absolute is an open redirect.
 */

export const DEFAULT_AFTER_AUTH = "/"

/** Origin used only to parse relative targets; never appears in the result. */
const PARSE_ORIGIN = "http://redirect.invalid"

/**
 * The path a `next` parameter is allowed to mean.
 *
 * Anything that is not a same-origin relative path collapses to the app root:
 * absolute URLs, protocol-relative `//evil.com`, and the backslash spellings
 * of it that the URL parser folds into slashes. Auth routes collapse too — a
 * sign-in that returns you to the sign-in form is a loop, and the middleware
 * would bounce it straight back out again anyway.
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_AFTER_AUTH
  // Absolute paths only. A bare `some/path` would resolve to somewhere on
  // this origin and so be safe, but nothing this app writes produces one, and
  // a target that has to be resolved to be judged is harder to reason about
  // than one that is rejected.
  if (!raw.startsWith("/")) return DEFAULT_AFTER_AUTH

  let target: string
  try {
    const url = new URL(raw, PARSE_ORIGIN)
    if (url.origin !== PARSE_ORIGIN) return DEFAULT_AFTER_AUTH
    // The hash never reaches the server and survives a client-side navigation
    // to the same path anyway, so it is not worth carrying.
    target = `${url.pathname}${url.search}`
  } catch {
    return DEFAULT_AFTER_AUTH
  }

  if (!target.startsWith("/") || target.startsWith("//")) return DEFAULT_AFTER_AUTH
  if (target === "/auth" || target.startsWith("/auth/")) return DEFAULT_AFTER_AUTH

  return target
}

/**
 * An auth URL that carries a destination, or the plain one when the
 * destination is the app root — the default needs no parameter, and a login
 * link reading `?next=%2F` is noise in the address bar.
 */
export function withNext(path: string, next: string | null | undefined): string {
  const target = safeNext(next)
  if (target === DEFAULT_AFTER_AUTH) return path
  return `${path}?next=${encodeURIComponent(target)}`
}
