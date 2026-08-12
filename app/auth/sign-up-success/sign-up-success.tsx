"use client"

import { useActionState } from "react"
import Link from "next/link"
import { withNext } from "@/lib/auth-redirect"
import { useI18n } from "@/lib/i18n"
import { AuthShell, AuthError } from "@/components/auth-shell"
import { Button } from "@/components/ui/button"
import { RESEND_IDLE, resendConfirmationAction } from "./actions"

export function SignUpSuccess({ email, next }: { email: string | null; next: string }) {
  const { t } = useI18n()
  const [resend, resendAction, resending] = useActionState(
    resendConfirmationAction,
    RESEND_IDLE,
  )

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
      <div className="flex flex-col gap-3">
        {/* Nothing arrives, and there are two reasons for it: the mail is
            somewhere the runner has not looked, or the address is wrong. One
            control each, and the address is on the screen above to tell them
            apart. Without an address in the URL — someone who reached this
            page directly — only the second one can be offered. */}
        {email && (
          <form action={resendAction} className="flex flex-col gap-3">
            <input type="hidden" name="email" value={email} />
            <input type="hidden" name="next" value={next} />

            {resend.status === "throttled" && (
              <AuthError>{t("auth.resendThrottled")}</AuthError>
            )}

            {resend.status === "sent" && (
              <p
                role="status"
                className="rounded-md bg-success/12 px-3 py-2.5 text-label leading-relaxed text-success"
              >
                {t("auth.resendSent")}
              </p>
            )}

            {/* The button stays after a send. A second mail that also does
                not arrive is the runner's evidence that the address is the
                problem, and taking the control away would leave them
                waiting on a mail that is never coming. */}
            <Button type="submit" block loading={resending}>
              {resending ? t("auth.resending") : t("auth.resend")}
            </Button>
          </form>
        )}

        <Button asChild block variant="secondary">
          <Link href={withNext("/auth/sign-up", next)}>{t("auth.confirmEmailWrongAddress")}</Link>
        </Button>
      </div>
    </AuthShell>
  )
}
