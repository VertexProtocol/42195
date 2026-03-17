"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useI18n } from "@/lib/i18n"

export default function ForgotPasswordPage() {
  const { t } = useI18n()
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const email = formData.get("email") as string
    setError(null)

    startTransition(async () => {
      try {
        const supabase = createClient()
        const siteUrl = window.location.origin
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${siteUrl}/auth/callback?next=/auth/reset-password`,
        })

        if (error) {
          setError(error.message)
          return
        }

        setSent(true)
      } catch {
        setError(t("auth.errorDefault"))
      }
    })
  }

  if (sent) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">{t("auth.checkEmailTitle")}</h1>
            <p className="text-sm text-muted-foreground">{t("auth.checkEmailDesc")}</p>
          </div>
          <Link
            href="/auth/login"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90"
          >
            {t("auth.backToSignIn")}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-bold tracking-tight">{t("auth.resetPasswordTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("auth.resetPasswordDesc")}</p>
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

          <button
            type="submit"
            disabled={isPending}
            className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            {isPending ? t("auth.sending") : t("auth.sendResetLink")}
          </button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          <Link href="/auth/login" className="font-medium text-primary underline-offset-4 hover:underline">
            {t("auth.backToSignIn")}
          </Link>
        </p>
      </div>
    </div>
  )
}
