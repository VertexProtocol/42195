"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useI18n } from "@/lib/i18n"

function sanitizeAuthError(message: string, t: (k: any) => string): string {
  const m = message.toLowerCase()
  if (m.includes("invalid login credentials") || m.includes("invalid credentials") || m.includes("wrong password") || m.includes("user not found")) {
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

        // Hard navigation so the browser sends the freshly-set session cookies
        // in a brand-new HTTP request. router.push() is a client-side navigation
        // that can race with cookie writes and send the middleware an empty session.
        const root = document.getElementById("login-root")
        if (root) {
          root.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100dvh;flex-direction:column;gap:8px"><div style="width:24px;height:24px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin 0.6s linear infinite"></div><p style="font-size:14px;color:inherit;opacity:0.7">Loading your data…</p><style>@keyframes spin{to{transform:rotate(360deg)}}</style></div>'
        }
        window.location.href = "/"
      } catch (err) {
        setError(t("auth.errorDefault"))
      }
    })
  }

  return (
    <div id="login-root" className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-bold tracking-tight">42195</h1>
          <p className="text-sm text-muted-foreground">{t("auth.signInTagline")}</p>
        </div>

        {error && (
          <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">
              {t("auth.emailLabel")}
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              {t("auth.passwordLabel")}
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            {isPending ? t("auth.signingIn") : t("auth.signIn")}
          </button>

          <div className="text-center">
            <Link href="/auth/forgot-password" className="text-sm text-muted-foreground hover:text-primary underline-offset-4 hover:underline">
              {t("auth.forgotPassword")}
            </Link>
          </div>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          {t("auth.noAccount")}{" "}
          <Link href="/auth/sign-up" className="font-medium text-primary underline-offset-4 hover:underline">
            {t("auth.signUp")}
          </Link>
        </p>
      </div>
    </div>
  )
}
