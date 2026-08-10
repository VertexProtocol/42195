"use client"

import { useState, useTransition } from "react"
import { Eye, EyeOff } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useI18n } from "@/lib/i18n"
import { AuthShell, AuthError, Field } from "@/components/auth-shell"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export default function ResetPasswordPage() {
  const { t } = useI18n()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

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
          // Never relay the raw Supabase error to the UI.
          setError(t("auth.errorDefault"))
          return
        }

        // Revoke every session for this account, not just this device: if an
        // attacker held a session, changing the password has to end it.
        await supabase.auth.signOut({ scope: "global" })

        setSuccess(true)
        setTimeout(() => {
          // Login, not "/" — the global sign-out means re-authentication.
          window.location.href = "/auth/login"
        }, 2000)
      } catch {
        setError(t("auth.errorDefault"))
      }
    })
  }

  if (success) {
    return (
      <AuthShell title={t("auth.passwordUpdated")} lede={t("auth.redirecting")}>
        <p className="sr-only" role="status">
          {t("auth.redirecting")}
        </p>
      </AuthShell>
    )
  }

  return (
    <AuthShell title={t("auth.setNewPasswordTitle")} lede={t("auth.setNewPasswordDesc")}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <AuthError>{error}</AuthError>}

        <Field
          id="password"
          label={t("auth.newPasswordLabel")}
          hint={t("auth.minCharsPlaceholder")}
        >
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={8}
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

        <Field id="confirm" label={t("auth.confirmPasswordLabel")}>
          <div className="relative">
            <Input
              id="confirm"
              name="confirm"
              type={showConfirm ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={8}
              className="pr-11"
            />
            <button
              type="button"
              onClick={() => setShowConfirm(!showConfirm)}
              className="press absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
              aria-label={showConfirm ? t("auth.hidePassword") : t("auth.showPassword")}
            >
              {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </Field>

        <Button type="submit" block loading={isPending} className="mt-1">
          {isPending ? t("auth.updating") : t("auth.updatePassword")}
        </Button>
      </form>
    </AuthShell>
  )
}
