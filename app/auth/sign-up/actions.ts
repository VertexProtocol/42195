"use server"

import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { createClient } from "@/lib/supabase/server"

export async function signUpAction(formData: FormData) {
  const supabase = await createClient()
  const headersList = await headers()

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    headersList.get("origin") ??
    ""

  const { data, error } = await supabase.auth.signUp({
    email: formData.get("email") as string,
    password: formData.get("password") as string,
    options: {
      emailRedirectTo: `${siteUrl}/auth/callback?next=/auth/sign-up-success`,
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
  // immediately — send the user straight into the app.
  if (data.session) {
    redirect("/")
  }

  redirect("/auth/sign-up-success")
}
