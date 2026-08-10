"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useI18n } from "@/lib/i18n"
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
    const email = formData.get("email") as string
    setError(null)

    startTransition(async () => {
      try {
        const supabase = createClient()
        // The canonical site URL keeps the reset link pointing at the right
        // host regardless of preview/staging context.
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${siteUrl}/auth/callback?next=/auth/reset-password`,
        })

        if (error) {
          // Never relay the raw Supabase error: rate-limit messages are scoped
          // to a specific address and would enable user enumeration.
          setError(t("auth.errorDefault"))
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
