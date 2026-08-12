"use server"

import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import { safeNext } from "@/lib/auth-redirect"

export async function signUpAction(formData: FormData) {
  const supabase = await createClient()
  const headersList = await headers()

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    headersList.get("origin") ??
    ""

  const email = formData.get("email") as string
  // Where the runner was headed when they were asked to sign in. Validated
  // here as well as on the way in: this value reaches an email that is sent
  // out and clicked days later.
  const next = safeNext(formData.get("next") as string | null)

  const { data, error } = await supabase.auth.signUp({
    email,
    password: formData.get("password") as string,
    options: {
      // Confirming lands in the app, signed in. It used to land back on
      // "check your email, then sign in" — the screen for someone who has not
      // confirmed yet — which asked a runner who had just done the thing to
      // do it again.
      emailRedirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(next)}`,
      data: {
        display_name: formData.get("display_name") as string,
      },
    },
  })

  if (error) {
    redirect(`/auth/error?message=${encodeURIComponent(error.message)}`)
  }

  // Supabase returns a fake success with empty identities for already-registered
  // emails (to prevent email enumeration). Detect this and show a helpful message.
  if (data.user && data.user.identities?.length === 0) {
    redirect(
      `/auth/error?message=${encodeURIComponent(
        "An account with this email may already exist. Try signing in or resetting your password."
      )}`
    )
  }

  // If email confirmation is disabled in Supabase, a session is returned
  // immediately — send the user straight where they were going.
  if (data.session) {
    redirect(next)
  }

  // The address goes with them: a confirmation that never arrives is usually
  // a typo, and this is the screen where it can still be seen.
  const params = new URLSearchParams({ email })
  if (next !== "/") params.set("next", next)
  redirect(`/auth/sign-up-success?${params.toString()}`)
}
