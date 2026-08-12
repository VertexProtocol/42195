import { describe, it, expect } from "vitest"
import { authErrorKey } from "./auth-error"

describe("authErrorKey", () => {
  it("says the same neutral thing for anything it does not know", () => {
    expect(authErrorKey(undefined)).toBe("authError.generic")
    expect(authErrorKey("")).toBe("authError.generic")
    // A message put in the query string by hand cannot become page copy.
    expect(authErrorKey("<script>alert(1)</script>")).toBe("authError.generic")
    expect(authErrorKey("Database error saving new user")).toBe("authError.generic")
  })

  it("recognises the Strava sentinels exactly", () => {
    expect(authErrorKey("strava_already_linked")).toBe("authError.stravaAlreadyLinked")
    expect(authErrorKey("strava_missing_scope")).toBe("authError.stravaMissingScope")
    expect(authErrorKey("strava_signup_closed")).toBe("authError.stravaSignupClosed")
    expect(authErrorKey("strava_session_failed")).toBe("authError.stravaSessionFailed")
  })

  it("keeps recovery apart from confirmation", () => {
    // Both are "the link did not work", but only one of them can be answered
    // with "sign in with your password".
    expect(authErrorKey("recovery_wrong_browser")).toBe("authError.recoveryWrongBrowser")
    expect(authErrorKey("recovery_link_failed")).toBe("authError.recoveryLinkFailed")
    expect(authErrorKey("confirmed_elsewhere")).toBe("authError.confirmedElsewhere")
  })

  it("maps Supabase's wording for a bad sign-in", () => {
    expect(authErrorKey("Invalid login credentials")).toBe("authError.invalidCredentials")
    expect(authErrorKey("Email not confirmed")).toBe("authError.emailNotConfirmed")
    expect(authErrorKey("Request rate limit reached")).toBe("authError.tooManyRequests")
    expect(authErrorKey("User already registered")).toBe("authError.alreadyRegistered")
  })

  it("tells a confirmed-elsewhere runner apart from an expired link", () => {
    // Both mention a token; only one of them means "ask for a new link".
    expect(
      authErrorKey(
        "Email confirmed, but the session could not be created because the confirmation link was opened in a different browser. Please sign in with your email and password.",
      ),
    ).toBe("authError.confirmedElsewhere")
    expect(authErrorKey("Token has expired or is invalid")).toBe("authError.linkExpired")
  })
})
