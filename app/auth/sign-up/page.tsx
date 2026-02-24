import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import Link from "next/link"

export default function SignUpPage() {
  async function signUp(formData: FormData) {
    "use server"

    const supabase = await createClient()
    const headersList = await headers()

    // Prefer an explicit site URL so email links work outside localhost
    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ??
      headersList.get("origin") ??
      ""

    const { data, error } = await supabase.auth.signUp({
      email: formData.get("email") as string,
      password: formData.get("password") as string,
      options: {
        // /auth/callback exchanges the PKCE code for a session, then redirects
        emailRedirectTo: `${siteUrl}/auth/callback?next=/auth/sign-up-success`,
        data: {
          display_name: formData.get("display_name") as string,
        },
      },
    })

    if (error) {
      redirect(`/auth/error?message=${encodeURIComponent(error.message)}`)
    }

    // If email confirmation is disabled in Supabase, a session is returned
    // immediately — send the user straight into the app.
    if (data.session) {
      redirect("/")
    }

    // Otherwise the user must confirm their email first.
    redirect("/auth/sign-up-success")
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-bold tracking-tight">42195</h1>
          <p className="text-sm text-muted-foreground">Create your account</p>
        </div>

        <form action={signUp} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="display_name" className="text-sm font-medium">
              Name
            </label>
            <input
              id="display_name"
              name="display_name"
              type="text"
              autoComplete="name"
              required
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              placeholder="Alex Runner"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              placeholder="Min. 8 characters"
            />
          </div>

          <button
            type="submit"
            className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Create account
          </button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/auth/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
