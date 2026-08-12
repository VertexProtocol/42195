import type { TranslationKey } from "@/lib/i18n"

/**
 * Auth errors name the problem and the way out.
 *
 * Supabase's raw message never reaches the page — some of them leak whether
 * an address is registered — so the message that arrives in the query string
 * only ever selects one of the app's own strings, and the screen renders that
 * string in the runner's language. Anything unrecognised says the same
 * neutral thing, which is also what an attacker-supplied message gets.
 */
export function authErrorKey(message: string | undefined): TranslationKey {
  if (!message) return "authError.generic"
  const m = message.toLowerCase()

  if (m === "strava_already_linked") return "authError.stravaAlreadyLinked"
  if (m === "strava_missing_scope") return "authError.stravaMissingScope"
  if (m === "strava_signup_closed") return "authError.stravaSignupClosed"
  // Recovery has its own two, because "sign in with your password" is not
  // advice you can give someone who came here having forgotten it.
  if (m === "recovery_wrong_browser") return "authError.recoveryWrongBrowser"
  if (m === "recovery_link_failed") return "authError.recoveryLinkFailed"
  if (m === "confirmed_elsewhere") return "authError.confirmedElsewhere"
  if (m === "strava_session_failed") return "authError.stravaSessionFailed"

  if (
    m.includes("invalid login credentials") ||
    m.includes("invalid credentials") ||
    m.includes("wrong password") ||
    m.includes("user not found")
  ) {
    return "authError.invalidCredentials"
  }
  if (m.includes("email not confirmed") || m.includes("confirm your email")) {
    return "authError.emailNotConfirmed"
  }
  if (m.includes("too many requests") || m.includes("rate limit")) {
    return "authError.tooManyRequests"
  }
  // The cross-browser confirmation failure: the account is live, but the PKCE
  // verifier stayed in whichever browser started the sign-up. Matched before
  // the expired-link case, whose words it otherwise contains.
  if (m.includes("different browser")) return "authError.confirmedElsewhere"
  if (m.includes("token") || m.includes("expired") || m.includes("invalid") || m.includes("otp")) {
    return "authError.linkExpired"
  }
  if (m.includes("user already registered") || m.includes("already exists")) {
    return "authError.alreadyRegistered"
  }

  return "authError.generic"
}
