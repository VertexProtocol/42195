"use client"

import { useEffect, useState } from "react"
import {
  isChunkLoadError,
  shouldReloadForChunkError,
  CHUNK_RELOAD_KEY,
} from "@/lib/chunk-error"

/**
 * The error boundary is part of the product, not a debug dump.
 *
 * It names what happened, offers the one action that might fix it, and shows
 * the digest so a support conversation has something to go on. The stack is
 * printed only in development — in production it is noise to the runner and
 * detail an attacker does not need.
 *
 * One failure it handles rather than reports: a page left open across a
 * deployment asks for a chunk filename that no longer exists the first time it
 * opens a screen it has not opened before. Nothing is wrong with the code and
 * `reset()` cannot fix it — a re-render imports the same missing file. A
 * reload can, so it reloads, once.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const isDev = process.env.NODE_ENV === "development"
  const stale = isChunkLoadError(error)
  const [reloading, setReloading] = useState(stale)

  useEffect(() => {
    if (!stale) return
    let last: string | null = null
    try {
      last = window.sessionStorage.getItem(CHUNK_RELOAD_KEY)
    } catch {
      // Private mode with storage disabled. One reload attempt is still better
      // than none; the worst case is a loop the runner can leave by closing
      // the tab, and the alternative is a dead end for everyone.
    }
    if (!shouldReloadForChunkError(last)) {
      setReloading(false)
      return
    }
    try {
      window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()))
    } catch {
      // As above.
    }
    window.location.reload()
  }, [stale])

  // Reloading is about to replace this document, so say nothing rather than
  // flash a failure the runner never needed to read.
  if (reloading) {
    return <div className="min-h-dvh bg-background" aria-busy="true" />
  }

  return (
    <div className="flex min-h-dvh flex-col justify-center bg-background px-5 py-10">
      <main className="mx-auto w-full max-w-sm">
        <p className="measure text-label font-bold tracking-[-0.03em] text-muted-foreground">
          42195
        </p>
        <h1 className="mt-5 text-screen font-semibold text-foreground">
          This screen stopped loading
        </h1>
        <p className="mt-2 max-w-[46ch] text-body leading-relaxed text-muted-foreground">
          Your training data is safe. Reloading the screen usually clears it.
        </p>

        {error.digest && (
          <p className="measure mt-4 text-micro text-muted-foreground">
            Reference: {error.digest}
          </p>
        )}

        {isDev && (
          <pre className="measure mt-4 max-h-64 overflow-auto rounded-md bg-surface-sunken p-3 text-micro leading-relaxed text-foreground">
            {error.message}
            {"\n\n"}
            {error.stack}
          </pre>
        )}

        <button
          // `reset()` re-renders the tree, which is the right move for a
          // transient failure and useless for a missing file — that import is
          // already cached as rejected. The button says reload, so when the
          // page is the problem it reloads.
          onClick={() => (stale ? window.location.reload() : reset())}
          className="press mt-6 inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-label font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Reload this screen
        </button>
      </main>
    </div>
  )
}
