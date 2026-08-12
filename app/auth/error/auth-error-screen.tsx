"use client"

import Link from "next/link"
import { withNext } from "@/lib/auth-redirect"
import { useI18n, type TranslationKey } from "@/lib/i18n"
import { AuthShell } from "@/components/auth-shell"
import { Button } from "@/components/ui/button"

export function AuthErrorScreen({
  messageKey,
  next,
}: {
  messageKey: TranslationKey
  next: string
}) {
  const { t } = useI18n()

  return (
    <AuthShell title={t("authError.title")} lede={t(messageKey)}>
      {/* Signing in from here still ends up where the runner was going —
          following an invite link should not have to be done twice. */}
      <Button asChild block>
        <Link href={withNext("/auth/login", next)}>{t("auth.backToSignIn")}</Link>
      </Button>
    </AuthShell>
  )
}
