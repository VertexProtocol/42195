import Link from "next/link"

function sanitizeAuthErrorMessage(message: string | undefined): string {
  if (!message) return "An unexpected error occurred. Please try again."
  const m = message.toLowerCase()
  if (m.includes("invalid login credentials") || m.includes("invalid credentials") || m.includes("wrong password") || m.includes("user not found")) {
    return "Invalid email or password. Please try again."
  }
  if (m.includes("email not confirmed") || m.includes("confirm your email")) {
    return "Please confirm your email address before signing in."
  }
  if (m.includes("too many requests") || m.includes("rate limit")) {
    return "Too many attempts. Please wait a few minutes and try again."
  }
  if (m.includes("token") || m.includes("expired") || m.includes("invalid") || m.includes("otp")) {
    return "This link has expired or is invalid. Please request a new one."
  }
  if (m.includes("user already registered") || m.includes("already exists")) {
    return "An account with this email already exists."
  }
  return "An unexpected error occurred. Please try again."
}

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>
}) {
  const { message } = await searchParams
  const displayMessage = sanitizeAuthErrorMessage(message)

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Authentication error</h1>
          <p className="text-sm text-muted-foreground">{displayMessage}</p>
        </div>

        <Link
          href="/auth/login"
          className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  )
}
