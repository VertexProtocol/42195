/**
 * Application logging.
 *
 * On the server these are the only observability the app has, so they always
 * pass through to the platform logs. In the browser they are silenced in
 * production: a user's console is not a log sink, and several of these call
 * sites print raw Supabase error objects, which is detail that has no business
 * being handed to whoever opens devtools.
 *
 * Anything a user needs to know about belongs on screen, not in here.
 */

const silent =
  typeof window !== "undefined" && process.env.NODE_ENV === "production"

export function logError(context: string, ...detail: unknown[]): void {
  if (silent) return
  console.error(`[${context}]`, ...detail)
}

export function logWarn(context: string, ...detail: unknown[]): void {
  if (silent) return
  console.warn(`[${context}]`, ...detail)
}
