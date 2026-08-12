"use server"

import { createClient } from "@supabase/supabase-js"
import { resolveSiteUrl } from "@/lib/site-url"
import { logError } from "@/lib/log"

/**
 * Send a password reset link that works in any browser.
 *
 * Not the app's usual Supabase client. `@supabase/ssr` initiates every client
 * in the PKCE flow, and PKCE covers password recovery — so the link it
 * produces carries a `pkce_`-prefixed token that can only be redeemed by the
 * browser holding the verifier it was issued against. Mail apps open links in
 * their own browser, so that is the common case, not the edge one, and the
 * runner lands on "we could not sign you in" having done nothing wrong.
 *
 * A plain supabase-js client uses the implicit flow, which issues a token hash
 * that stands on its own. `verifyOtp` in /auth/callback then redeems it
 * wherever the link was opened. Nothing is stored on this client: it exists
 * for the length of one call and holds no session.
 *
 * It reports nothing back. Whether an address has an account is not something
 * this endpoint will say, and the screen says the same thing either way.
 */
export async function sendPasswordResetAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim()
  if (!email) return

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false } },
  )

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    // Only used if the email template falls back to {{ .ConfirmationURL }}.
    // The template this app ships builds its own link and ignores it.
    redirectTo: `${await resolveSiteUrl()}/auth/callback?next=/auth/reset-password`,
  })

  if (error) logError("auth.reset", error.message)
}
