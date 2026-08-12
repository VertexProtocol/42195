"use client"

import { useActionState } from "react"
import Link from "next/link"
import { useI18n } from "@/lib/i18n"
import { AuthShell, AuthError, Field } from "@/components/auth-shell"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { SAVE_EMAIL_IDLE, saveEmailAction, type SaveEmailStatus } from "./actions"

const ERROR_COPY: Partial<Record<SaveEmailStatus, "auth.finishInvalid" | "auth.finishTaken" | "auth.finishFailed">> = {
  invalid: "auth.finishInvalid",
  taken: "auth.finishTaken",
  failed: "auth.finishFailed",
}

export function FinishSignUp({ next }: { next: string }) {
  const { t } = useI18n()
  const [state, action, saving] = useActionState(saveEmailAction, SAVE_EMAIL_IDLE)
  const errorKey = ERROR_COPY[state.status]

  return (
    <AuthShell title={t("auth.finishTitle")} lede={t("auth.finishBody")}>
      <form action={action} className="flex flex-col gap-4">
        {errorKey && <AuthError>{t(errorKey)}</AuthError>}

        <input type="hidden" name="next" value={next} />

        <Field id="email" label={t("auth.emailLabel")} hint={t("auth.finishHint")}>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            placeholder="you@example.com"
          />
        </Field>

        <Button type="submit" block loading={saving} className="mt-1">
          {saving ? t("auth.finishSaving") : t("auth.finishSave")}
        </Button>

        {/* Not a trap. Somebody who cannot get at their address right now
            should still reach the app they just signed into — Profile takes
            it whenever they can. */}
        <Link
          href={next}
          className="self-center py-1 text-label text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {t("auth.finishLater")}
        </Link>
      </form>
    </AuthShell>
  )
}
