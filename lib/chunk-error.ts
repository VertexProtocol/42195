/**
 * Telling a stale deployment apart from a real failure.
 *
 * This app is installed to a home screen and its tab stays open for days. A
 * deployment in the meantime replaces every hashed chunk, so the next time the
 * running page lazily imports a screen it has not opened yet, it asks for a
 * filename that no longer exists and the import rejects.
 *
 * It reads as a crash and is not one: the code is fine, the page is just old.
 * The remedy is the one thing the runner cannot be expected to know to do —
 * a hard reload, which fetches the current HTML and its current chunks.
 *
 * Browsers word this failure differently, hence the alternation.
 */
const CHUNK_LOAD_ERROR =
  /loading chunk|loading css chunk|failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false
  const err = error as { name?: unknown; message?: unknown }
  if (typeof err.name === "string" && err.name === "ChunkLoadError") return true
  return typeof err.message === "string" && CHUNK_LOAD_ERROR.test(err.message)
}

/** Key for the one-reload-per-window guard. */
export const CHUNK_RELOAD_KEY = "42195:chunk-reload-at"

/**
 * Whether to reload now, given when the last attempt was.
 *
 * A reload that lands on the same broken chunk would loop, so one attempt is
 * allowed and then the boundary gives up and shows itself. The window reopens
 * after a minute, because a second deployment while the tab is still open is a
 * new problem rather than the same one repeating.
 */
export function shouldReloadForChunkError(
  lastAttempt: string | null,
  now: number = Date.now(),
): boolean {
  if (!lastAttempt) return true
  const at = Number(lastAttempt)
  if (!Number.isFinite(at)) return true
  return now - at > 60_000
}
