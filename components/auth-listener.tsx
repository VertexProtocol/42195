"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

/**
 * Invisible component that keeps the Supabase session alive.
 *
 * Without this, the access token expires (default 1 hour) and the
 * middleware sees no valid session → redirects to login.
 *
 * How it works:
 * - `createBrowserClient` auto-refreshes the token in the background
 * - `onAuthStateChange` fires when the token is refreshed or the user signs out
 * - On TOKEN_REFRESHED we call router.refresh() so the middleware
 *   picks up the new cookie on the next server request
 * - On SIGNED_OUT we redirect to login
 */
export function AuthListener() {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "TOKEN_REFRESHED") {
        // New tokens are written to cookies by @supabase/ssr automatically.
        // Refresh the router so the next server request uses the fresh cookie.
        router.refresh()
      }

      if (event === "SIGNED_OUT") {
        router.push("/auth/login")
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [router])

  return null
}
