"use client"

import { useCallback, useSyncExternalStore } from "react"
import { safeNext } from "@/lib/auth-redirect"

/**
 * Where this runner was going before they were asked to sign in.
 *
 * Read from the live URL rather than through `useSearchParams`, which would
 * pull the whole auth screen out of static prerendering for a parameter that
 * is absent on most visits. Subscribing the same way the app shell does keeps
 * the first render matching the server's — the destination arrives on the
 * render after hydration, which is before any of it can be clicked.
 */
export function useNextTarget(): string {
  const subscribe = useCallback((onChange: () => void) => {
    window.addEventListener("popstate", onChange)
    return () => window.removeEventListener("popstate", onChange)
  }, [])

  const search = useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => "",
  )

  return safeNext(new URLSearchParams(search).get("next"))
}
