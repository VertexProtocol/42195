"use client"

/**
 * The error boundary is part of the product, not a debug dump.
 *
 * It names what happened, offers the one action that might fix it, and shows
 * the digest so a support conversation has something to go on. The stack is
 * printed only in development — in production it is noise to the runner and
 * detail an attacker does not need.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const isDev = process.env.NODE_ENV === "development"

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
          onClick={reset}
          className="press mt-6 inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-label font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Reload this screen
        </button>
      </main>
    </div>
  )
}
