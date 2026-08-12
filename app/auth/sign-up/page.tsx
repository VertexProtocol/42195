"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { Eye, EyeOff } from "lucide-react"
import { withNext } from "@/lib/auth-redirect"
import { useNextTarget } from "@/hooks/use-next-target"
import { useI18n } from "@/lib/i18n"
import { signUpAction } from "./actions"
import { AuthShell, AuthError, Field } from "@/components/auth-shell"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export default function SignUpPage() {
  const { t } = useI18n()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  // Carried in a hidden field so the destination survives the server action,
  // the confirmation email and the callback — see lib/auth-redirect.
  const next = useNextTarget()

  // There is no confirm field to check against. Typing a password twice
  // guards against a typo you cannot see, and both halves of that are gone:
  // the field can be revealed, and a password that still went in wrong is a
  // reset link away. What it cost was the longest screen on the way in.
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      try {
        await signUpAction(formData)
      } catch {
        // Supabase's own failures redirect to /auth/error from the action.
        // What lands here is the request never arriving — a phone that went
        // through a tunnel mid-signup — and that belongs on this form, with
        // everything the runner typed still in it.
        setError(t("auth.errorSignUpDefault"))
      }
    })
  }

  return (
    <AuthShell
      title={t("auth.createAccount")}
      lede={t("auth.createAccountTagline")}
      footer={
        <>
          {t("auth.haveAccount")}{" "}
          <Link
            href={withNext("/auth/login", next)}
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            {t("auth.signIn")}
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <AuthError>{error}</AuthError>}

        <input type="hidden" name="next" value={next} />

        <Field id="display_name" label={t("auth.nameLabel")}>
          <Input
            id="display_name"
            name="display_name"
            type="text"
            autoComplete="name"
            required
            placeholder={t("auth.namePlaceholder")}
          />
        </Field>

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

        <Field id="password" label={t("auth.passwordLabel")} hint={t("auth.minCharsPlaceholder")}>
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

        <Button type="submit" block loading={isPending} className="mt-1">
          {isPending ? t("auth.creatingAccount") : t("auth.createAccount")}
        </Button>
      </form>
    </AuthShell>
  )
}
