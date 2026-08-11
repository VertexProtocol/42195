"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { Eye, EyeOff } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useI18n } from "@/lib/i18n"
import { AuthShell, AuthError, Field } from "@/components/auth-shell"
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

export default function LoginPage() {
  const { t } = useI18n()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [showPassword, setShowPassword] = useState(false)
  const [handingOff, setHandingOff] = useState(false)

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

        // A hard navigation so the browser sends the freshly-set session
        // cookies in a brand-new request. router.push() is a client-side
        // navigation that can race with the cookie write and hand the
        // middleware an empty session.
        setHandingOff(true)
        window.location.href = "/"
      } catch {
        setError(t("auth.errorDefault"))
      }
    })
  }

  if (handingOff) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-5">
        {/* The one screen with nothing on it yet, so the mark itself runs the
            lap rather than standing still above a line of text. */}
        <TrackMark size={26} running className="text-foreground" />
        <p className="measure text-label font-bold tracking-[-0.03em] text-muted-foreground">
          42195
        </p>
        <p className="text-body text-muted-foreground" role="status">
          {t("auth.loadingData")}
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
            href="/auth/sign-up"
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            {t("auth.signUp")}
          </Link>
        </>
      }
    >
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
