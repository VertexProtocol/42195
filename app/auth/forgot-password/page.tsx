"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useI18n } from "@/lib/i18n"
import { sendPasswordResetAction } from "./actions"
import { AuthShell, AuthError, Field } from "@/components/auth-shell"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export default function ForgotPasswordPage() {
  const { t } = useI18n()
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    setError(null)

    startTransition(async () => {
      try {
        // Sent from the server, on a client that is not in the PKCE flow —
        // see the action. Asking from the browser client here is what made
        // the reset link refuse to open anywhere but this exact browser.
        await sendPasswordResetAction(formData)
        setSent(true)
      } catch {
        setError(t("auth.errorDefault"))
      }
    })
  }

  if (sent) {
    return (
      <AuthShell title={t("auth.checkEmailTitle")} lede={t("auth.checkEmailDesc")}>
        <Button asChild block>
          <Link href="/auth/login">{t("auth.backToSignIn")}</Link>
        </Button>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title={t("auth.resetPasswordTitle")}
      lede={t("auth.resetPasswordDesc")}
      footer={
        <Link
          href="/auth/login"
          className="font-semibold text-primary underline-offset-4 hover:underline"
        >
          {t("auth.backToSignIn")}
        </Link>
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

        <Button type="submit" block loading={isPending} className="mt-1">
          {isPending ? t("auth.sending") : t("auth.sendResetLink")}
        </Button>
      </form>
    </AuthShell>
  )
}
