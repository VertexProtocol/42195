const CACHE_NAME = "42195-v4"
const STATIC_ASSETS = ["/icon.svg", "/manifest.json"]

// Install: cache only non-HTML static assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  )
  self.skipWaiting()
})

// Activate: clean old caches, then reload all open windows
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.matchAll({ type: "window" }))
      .then((clients) => clients.forEach((client) => client.navigate(client.url)))
  )
  self.clients.claim()
})

// Fetch: never cache HTML pages — always fetch fresh from network
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)

  // Skip non-GET requests
  if (event.request.method !== "GET") return

  // Skip auth and API mutation routes
  if (url.pathname.startsWith("/api/auth")) return
  if (url.pathname.startsWith("/api/sync-strava")) return
  if (url.pathname.startsWith("/api/ai")) return

  // HTML navigation requests: always network-first, no caching
  // Next.js JS/CSS chunks use content hashes so they never go stale,
  // but HTML must always be fresh to pick up new chunk references.
  const isNavigation = event.request.mode === "navigate"
  const isHtml = event.request.headers.get("accept")?.includes("text/html")
  if (isNavigation || isHtml) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/"))
    )
    return
  }

  // API routes: network-first with cache fallback
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
          }
          return response
        })
        .catch(() => caches.match(event.request))
    )
    return
  }

  // Static assets (icons, fonts, Next.js chunks with content hashes):
  // cache-first since they are immutable once deployed
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
        }
        return response
      })
    })
  )
})
