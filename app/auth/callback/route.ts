import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { safeNext } from "@/lib/auth-redirect"

/**
 * GET /auth/callback
 *
 * Handles the OAuth/magic-link/email-confirmation redirect from Supabase.
 *
 * Two flows are supported:
 *  1. PKCE flow: Supabase appends ?code=... — we exchange the code for a session.
 *     This requires the code_verifier cookie set during signup, so it can fail
 *     when the email confirmation link opens in a different browser (common on mobile).
 *
 *  2. Token-hash flow (fallback): Supabase appends ?token_hash=...&type=...
 *     This works cross-browser because no cookie is required.
 *
 * Both paths establish a session and redirect the user to their destination.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get("code")
  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type") as
    | "signup"
    | "recovery"
    | "invite"
    | "magiclink"
    | "email"
    | null
  // Anything that is not a same-origin relative path collapses to the app
  // root — prevents open-redirect abuse via the next parameter.
  const next = safeNext(searchParams.get("next"))

  // Recovery needs its own answers when something goes wrong. A confirmation
  // that fails can be told to sign in; someone who just clicked "forgot
  // password" cannot, and that was the advice they were getting.
  const isRecovery = type === "recovery" || next.startsWith("/auth/reset-password")

  const supabase = await createClient()

  const getRedirectUrl = () => {
    // Prefer the canonical site URL from the environment — this is the only
    // fully trusted source for the host. x-forwarded-host is only consulted
    // when the env var is absent (e.g. during local development previews) and
    // is validated against the canonical host to prevent header-spoofing redirects.
    // Trailing slash stripped: `next` always starts with one, and this is now
    // the path every confirmed sign-up comes through.
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "")
    if (siteUrl) return `${siteUrl}${next}`

    const forwardedHost = request.headers.get("x-forwarded-host")
    const isLocalEnv = process.env.NODE_ENV === "development"
    if (isLocalEnv) return `${origin}${next}`
    if (forwardedHost) {
      // Only trust x-forwarded-host when it matches the request origin host,
      // guarding against spoofed headers on non-Vercel infrastructure.
      const originHost = new URL(origin).host
      if (forwardedHost === originHost) return `https://${forwardedHost}${next}`
    }
    return `${origin}${next}`
  }

  // The destination survives a failed confirmation too: the runner will be
  // sent to sign in, and an invite link they followed should still be waiting
  // on the other side of it.
  const errorUrl = (message: string) => {
    const params = new URLSearchParams({ message })
    if (next !== "/") params.set("next", next)
    return `${origin}/auth/error?${params.toString()}`
  }

  // --- PKCE flow (code exchange) ---
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      return NextResponse.redirect(getRedirectUrl())
    }

    // If PKCE fails (e.g. missing code_verifier cookie on mobile), show a
    // helpful message instead of a cryptic error.
    const isMissingVerifier =
      error.message.includes("code_verifier") ||
      error.message.includes("code verifier") ||
      error.message.includes("both pkce")

    if (isMissingVerifier) {
      // The verifier is written where the flow started, and this browser is
      // not it — a link opened from a mail app, or a request made against a
      // different host than the one the link points at.
      return NextResponse.redirect(
        errorUrl(isRecovery ? "recovery_wrong_browser" : "confirmed_elsewhere"),
      )
    }

    return NextResponse.redirect(errorUrl(isRecovery ? "recovery_link_failed" : error.message))
  }

  // --- Token-hash flow (works cross-browser, no cookie needed) ---
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    })

    if (!error) {
      return NextResponse.redirect(getRedirectUrl())
    }

    return NextResponse.redirect(errorUrl(isRecovery ? "recovery_link_failed" : error.message))
  }

  return NextResponse.redirect(
    errorUrl(isRecovery ? "recovery_link_failed" : "No authorization code received."),
  )
}
