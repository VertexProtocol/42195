"use client"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "600px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.25rem", fontWeight: 700 }}>Something went wrong</h1>
      <pre style={{ fontSize: "0.8rem", background: "#f5f5f5", padding: "1rem", borderRadius: "8px", overflow: "auto", marginTop: "1rem" }}>
        {error.message}
        {"\n\n"}
        {error.stack}
      </pre>
      <button
        onClick={reset}
        style={{ marginTop: "1rem", padding: "0.5rem 1rem", borderRadius: "6px", background: "#000", color: "#fff", border: "none", cursor: "pointer" }}
      >
        Try again
      </button>
    </div>
  )
}
