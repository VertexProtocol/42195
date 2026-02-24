import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * GET /auth/callback
 *
 * Handles the OAuth/magic-link/email-confirmation redirect from Supabase.
 * Supabase appends ?code=... (PKCE flow) to this URL. We exchange the code
 * for a session and then redirect the user to their destination.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get("code")
  const next = searchParams.get("next") ?? "/"

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // Use the forwarded host header so redirects work behind proxies/tunnels
      const forwardedHost = request.headers.get("x-forwarded-host")
      const isLocalEnv = process.env.NODE_ENV === "development"

      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${next}`)
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`)
      } else {
        return NextResponse.redirect(`${origin}${next}`)
      }
    }

    return NextResponse.redirect(
      `${origin}/auth/error?message=${encodeURIComponent(error.message)}`,
    )
  }

  return NextResponse.redirect(
    `${origin}/auth/error?message=${encodeURIComponent("No authorization code received.")}`,
  )
}
