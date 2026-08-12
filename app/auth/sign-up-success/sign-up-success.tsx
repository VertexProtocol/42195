"use client"

import Link from "next/link"
import { withNext } from "@/lib/auth-redirect"
import { useI18n } from "@/lib/i18n"
import { AuthShell } from "@/components/auth-shell"
import { Button } from "@/components/ui/button"

export function SignUpSuccess({ email, next }: { email: string | null; next: string }) {
  const { t } = useI18n()

  return (
    <AuthShell
      title={t("auth.confirmEmailTitle")}
      lede={
        email
          ? t("auth.confirmEmailBody", { email })
          : t("auth.confirmEmailBodyGeneric")
      }
      footer={
        <>
          {t("auth.confirmEmailOtherBrowser")}{" "}
          <Link
            href={withNext("/auth/login", next)}
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            {t("auth.signIn")}
          </Link>
        </>
      }
    >
      {/* The address is the thing worth checking on this screen, so the only
          control is the one that fixes a typo in it. */}
      <Button asChild block variant="secondary">
        <Link href={withNext("/auth/sign-up", next)}>{t("auth.confirmEmailWrongAddress")}</Link>
      </Button>
    </AuthShell>
  )
}
