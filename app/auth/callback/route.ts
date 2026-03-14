import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"

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
  const next = searchParams.get("next") ?? "/"

  const supabase = await createClient()

  const getRedirectUrl = () => {
    const forwardedHost = request.headers.get("x-forwarded-host")
    const isLocalEnv = process.env.NODE_ENV === "development"
    if (isLocalEnv) return `${origin}${next}`
    if (forwardedHost) return `https://${forwardedHost}${next}`
    return `${origin}${next}`
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
      return NextResponse.redirect(
        `${origin}/auth/error?message=${encodeURIComponent(
          "Email confirmed, but the session could not be created because the confirmation link was opened in a different browser. Please sign in with your email and password."
        )}`,
      )
    }

    return NextResponse.redirect(
      `${origin}/auth/error?message=${encodeURIComponent(error.message)}`,
    )
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

    return NextResponse.redirect(
      `${origin}/auth/error?message=${encodeURIComponent(error.message)}`,
    )
  }

  return NextResponse.redirect(
    `${origin}/auth/error?message=${encodeURIComponent("No authorization code received.")}`,
  )
}
