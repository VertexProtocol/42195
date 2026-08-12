import Link from "next/link"
import { withNext } from "@/lib/auth-redirect"
import { AuthShell } from "@/components/auth-shell"
import { Button } from "@/components/ui/button"

/**
 * Auth errors name the problem and the way out. Supabase's raw message never
 * reaches the page — some of them leak whether an address is registered.
 */
function sanitizeAuthErrorMessage(message: string | undefined): string {
  if (!message) return "Something went wrong on our side. Try signing in again."
  const m = message.toLowerCase()
  if (m === "strava_already_linked") {
    return "That Strava account is already connected to another 42195 account. Disconnect it there first, or sign in with that account."
  }
  if (m === "strava_missing_scope") {
    return "42195 needs permission to read your activities. Connect again and leave every box ticked on Strava's screen."
  }
  if (
    m.includes("invalid login credentials") ||
    m.includes("invalid credentials") ||
    m.includes("wrong password") ||
    m.includes("user not found")
  ) {
    return "That email and password did not match. Check both and try again."
  }
  if (m.includes("email not confirmed") || m.includes("confirm your email")) {
    return "Confirm your email address first — the link is in your inbox."
  }
  if (m.includes("too many requests") || m.includes("rate limit")) {
    return "Too many attempts. Wait a few minutes, then try again."
  }
  if (m.includes("token") || m.includes("expired") || m.includes("invalid") || m.includes("otp")) {
    return "This link has expired or has already been used. Request a new one."
  }
  if (m.includes("user already registered") || m.includes("already exists")) {
    return "An account with this email already exists. Sign in instead."
  }
  return "Something went wrong on our side. Try signing in again."
}

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; next?: string }>
}) {
  const { message, next } = await searchParams

  return (
    <AuthShell title="We could not sign you in" lede={sanitizeAuthErrorMessage(message)}>
      {/* Signing in from here still ends up where the runner was going —
          following an invite link should not have to be done twice. */}
      <Button asChild block>
        <Link href={withNext("/auth/login", next)}>Back to sign in</Link>
      </Button>
    </AuthShell>
  )
}
