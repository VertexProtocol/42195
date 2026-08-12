"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Eye, EyeOff } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { withNext } from "@/lib/auth-redirect"
import { useNextTarget } from "@/hooks/use-next-target"
import { useI18n } from "@/lib/i18n"
import { AuthShell, AuthError, Field } from "@/components/auth-shell"
import { StravaSignIn } from "@/components/strava-sign-in"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { TrackMark } from "@/components/ui/track-mark"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sanitizeAuthError(message: string, t: (k: any) => string): string {
  const m = message.toLowerCase()
  if (
    m.includes("invalid login credentials") ||
    m.includes("invalid credentials") ||
    m.includes("wrong password") ||
    m.includes("user not found")
  ) {
    return t("auth.errorInvalidCredentials")
  }
  if (m.includes("email not confirmed") || m.includes("confirm your email")) {
    return t("auth.errorEmailNotConfirmed")
  }
  if (m.includes("too many requests") || m.includes("rate limit") || m.includes("too many")) {
    return t("auth.errorTooManyRequests")
  }
  return t("auth.errorDefault")
}

/**
 * Resolves once the session cookie is readable from this document.
 *
 * `signInWithPassword` resolves as soon as the session is in memory; the
 * cookie write follows it. Whatever is in `document.cookie` at the moment we
 * hand over is what the request for the app carries, and handing over early is
 * what sends a runner who just signed in to the signed-out screen. Waiting for
 * the cookie is the part the old full page load was really buying.
 */
async function sessionCookieReady(timeoutMs = 1500): Promise<boolean> {
  // @supabase/ssr writes `sb-<project-ref>-auth-token`, chunked as `.0`, `.1`
  // when the session is too large for one cookie. Anchored on the `=` so the
  // PKCE `…-auth-token-code-verifier` cookie, which is set before a session
  // exists, cannot pass for one.
  const written = () => /(^|;\s*)sb-[^=;]*?auth-token(\.\d+)?=/.test(document.cookie)
  const deadline = performance.now() + timeoutMs
  while (!written()) {
    if (performance.now() > deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  return true
}

export default function LoginPage() {
  const { t } = useI18n()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [showPassword, setShowPassword] = useState(false)
  const [handingOff, setHandingOff] = useState(false)

  // Where this runner was going before the middleware sent them here.
  const next = useNextTarget()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const email = formData.get("email") as string
    const password = formData.get("password") as string
    setError(null)

    startTransition(async () => {
      try {
        const supabase = createClient()
        const { error } = await supabase.auth.signInWithPassword({ email, password })

        if (error) {
          setError(sanitizeAuthError(error.message, t))
          return
        }

        setHandingOff(true)

        // This used to be a hard `window.location.href` so the app would be
        // requested with the freshly-set cookies. It worked, but it made this
        // screen the outgoing page of a document load, and a browser stops
        // rendering a document it is replacing — so the wait it shows froze on
        // its first frame for the whole load.
        //
        // Navigating client-side keeps the page alive, and the race the hard
        // load was avoiding is handled directly: wait for the cookie, then go.
        // The request for "/" still passes the proxy, which sends anyone
        // without a session back here — so the cookie is the whole of it.
        // `replace`, not `push`: back from the app should not return to a
        // login form for an account that is already signed in.
        //
        // Where it goes is `next`, the destination the proxy attached when it
        // sent this runner here — an invite link opened signed out survives
        // the sign-in instead of landing them on Today with no idea what
        // happened to it. This replaces carrying `window.location.search`
        // onto "/" directly: the same invite case, but the whole path is
        // carried rather than the query alone, and the same value goes
        // through sign-up and the confirmation email. It is safe for the
        // reason the query-only version was — `safeNext` has already reduced
        // it to a relative path on this origin.
        if (await sessionCookieReady()) {
          router.replace(next)
        } else {
          // The cookie never appeared where we can see it. Whatever is going
          // on, a fresh document request is the one that has always worked.
          window.location.href = next
        }
      } catch {
        setError(t("auth.errorDefault"))
      }
    })
  }

  if (handingOff) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-5">
        {/* The lap only runs because the hand-off above stays on this
            document. If this ever goes back to a full page load, the browser
            stops rendering here and the arc freezes for the length of it. */}
        <TrackMark size={26} running className="text-foreground" />
        <p className="measure text-label font-bold tracking-[-0.03em] text-muted-foreground">
          42195
        </p>
        {/* What is happening, not what is being fetched: an account created
            five seconds ago has no training to load, and the first thing the
            app would ever have told that runner would have been wrong. */}
        <p className="text-body text-muted-foreground" role="status">
          {t("auth.signingIn")}
        </p>
      </div>
    )
  }

  return (
    <AuthShell
      id="login-root"
      title={t("auth.signIn")}
      lede={t("auth.signInTagline")}
      footer={
        <>
          {t("auth.noAccount")}{" "}
          <Link
            href={withNext("/auth/sign-up", next)}
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            {t("auth.signUp")}
          </Link>
        </>
      }
    >
      <StravaSignIn next={next} />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <AuthError>{error}</AuthError>}

        <Field id="email" label={t("auth.emailLabel")}>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
          />
        </Field>

        <Field id="password" label={t("auth.passwordLabel")}>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              className="pr-11"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="press absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
              aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </Field>

        <Button type="submit" block loading={isPending} className="mt-1">
          {isPending ? t("auth.signingIn") : t("auth.signIn")}
        </Button>

        <Link
          href="/auth/forgot-password"
          className="self-center py-1 text-label text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {t("auth.forgotPassword")}
        </Link>
      </form>
    </AuthShell>
  )
}
