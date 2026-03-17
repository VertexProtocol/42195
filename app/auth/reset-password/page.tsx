"use client"

import { useState, useTransition } from "react"
import { createClient } from "@/lib/supabase/client"
import { useI18n } from "@/lib/i18n"

export default function ResetPasswordPage() {
  const { t } = useI18n()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const password = formData.get("password") as string
    const confirm = formData.get("confirm") as string
    setError(null)

    if (password !== confirm) {
      setError(t("auth.passwordMismatch"))
      return
    }

    if (password.length < 8) {
      setError(t("auth.passwordTooShort"))
      return
    }

    startTransition(async () => {
      try {
        const supabase = createClient()
        const { error } = await supabase.auth.updateUser({ password })

        if (error) {
          setError(error.message)
          return
        }

        setSuccess(true)
        setTimeout(() => {
          window.location.href = "/"
        }, 2000)
      } catch {
        setError(t("auth.errorDefault"))
      }
    })
  }

  if (success) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-bold tracking-tight">{t("auth.passwordUpdated")}</h1>
          <p className="text-sm text-muted-foreground">{t("auth.redirecting")}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-bold tracking-tight">{t("auth.setNewPasswordTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("auth.setNewPasswordDesc")}</p>
        </div>

        {error && (
          <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              {t("auth.newPasswordLabel")}
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              placeholder={t("auth.minCharsPlaceholder")}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="confirm" className="text-sm font-medium">
              {t("auth.confirmPasswordLabel")}
            </label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              placeholder={t("auth.repeatPasswordPlaceholder")}
            />
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            {isPending ? t("auth.updating") : t("auth.updatePassword")}
          </button>
        </form>
      </div>
    </div>
  )
}
