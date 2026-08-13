"use server"

import { createClient } from "@/lib/supabase/server"
import { safeNext } from "@/lib/auth-redirect"
import { resolveSiteUrl } from "@/lib/site-url"
import { logError } from "@/lib/log"
import type { ResendState } from "./state"

/**
 * Send the confirmation email again.
 *
 * The address comes from the URL, so what this reports back has to be the
 * same for an address with an account, an address whose account is already
 * confirmed, and an address that has never been here — otherwise the button
 * answers "does this person have a 42195 account?" to anyone who asks. Every
 * outcome but a throttle reads as sent, and the real reason goes to the
 * server log.
 *
 * Supabase applies its own per-address interval on top of this. That one is
 * worth surfacing: it is the only failure where trying again in a minute is
 * the actual fix.
 */
export async function resendConfirmationAction(
  _previous: ResendState,
  formData: FormData,
): Promise<ResendState> {
  const email = String(formData.get("email") ?? "").trim()
  if (!email) return { status: "failed" }

  const next = safeNext(formData.get("next") as string | null)
  const supabase = await createClient()

  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: {
      emailRedirectTo: `${await resolveSiteUrl()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  })

  if (error) {
    const message = error.message.toLowerCase()
    if (
      message.includes("rate limit") ||
      message.includes("too many") ||
      message.includes("security purposes")
    ) {
      return { status: "throttled" }
    }
    logError("auth.resend", error.message)
  }

  return { status: "sent" }
}
