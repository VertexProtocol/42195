"use client"

/**
 * The global boundary replaces the whole document, so it cannot rely on the
 * app's stylesheet being applied. Its colours are inlined from the same
 * palette, and it honours the reader's colour scheme.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const isDev = process.env.NODE_ENV === "development"

  return (
    <html lang="en">
      <head>
        <meta name="color-scheme" content="light dark" />
        <style>{`
          :root { color-scheme: light dark; --bg:#e0d9d1; --fg:#3b2f29; --muted:#6f6259; --sunken:#d3cac1; --accent:#bc411e; --on-accent:#fff9f3 }
          @media (prefers-color-scheme: dark) {
            :root { --bg:#17110e; --fg:#efe9e3; --muted:#a4968b; --sunken:#0f0a07; --accent:#e88a55; --on-accent:#241812 }
          }
          body { margin:0; background:var(--bg); color:var(--fg);
                 font-family: ui-sans-serif, system-ui, sans-serif;
                 min-height:100dvh; display:flex; align-items:center; justify-content:center; padding:2.5rem 1.25rem }
        `}</style>
      </head>
      <body>
        <main style={{ width: "100%", maxWidth: "24rem" }}>
          <p
            style={{
              margin: 0,
              fontFamily: "ui-monospace, monospace",
              fontSize: "0.8125rem",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              color: "var(--muted)",
            }}
          >
            42195
          </p>
          <h1 style={{ margin: "1.25rem 0 0", fontSize: "1.75rem", lineHeight: 1.2, letterSpacing: "-0.026em" }}>
            The app could not start
          </h1>
          <p style={{ margin: "0.5rem 0 0", fontSize: "1.0625rem", lineHeight: 1.6, color: "var(--muted)" }}>
            Your training data is safe. Reloading usually clears it.
          </p>

          {error.digest && (
            <p
              style={{
                margin: "1rem 0 0",
                fontFamily: "ui-monospace, monospace",
                fontSize: "0.75rem",
                color: "var(--muted)",
              }}
            >
              Reference: {error.digest}
            </p>
          )}

          {isDev && (
            <pre
              style={{
                margin: "1rem 0 0",
                maxHeight: "16rem",
                overflow: "auto",
                background: "var(--sunken)",
                padding: "0.75rem",
                borderRadius: "10px",
                fontSize: "0.75rem",
                lineHeight: 1.6,
              }}
            >
              {error.message}
              {"\n\n"}
              {error.stack}
            </pre>
          )}

          <button
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              width: "100%",
              height: "2.75rem",
              borderRadius: "10px",
              background: "var(--accent)",
              color: "var(--on-accent)",
              border: "none",
              fontSize: "0.8125rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload the app
          </button>
        </main>
      </body>
    </html>
  )
}
