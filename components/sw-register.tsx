"use client"

import { useEffect } from "react"

export function ServiceWorkerRegistration() {
  useEffect(() => {
    // Only register service worker in production and when the file exists
    if (typeof window !== "undefined" && "serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      // Check if sw.js exists before trying to register
      fetch("/sw.js", { method: "HEAD" })
        .then((response) => {
          if (response.ok && !response.redirected) {
            navigator.serviceWorker.register("/sw.js").catch(() => {
              // Silently fail - SW is optional
            })
          }
        })
        .catch(() => {
          // Silently fail - SW is optional
        })
    }
  }, [])

  return null
}
