/**
 * How long after a finished sync the next one is declined as too soon.
 *
 * Shared by the route that enforces it and the screen that has to stop
 * offering a button which cannot work yet. Two copies of this number would
 * drift, and the drift shows up as a press that looks available and is not.
 */
export const SYNC_COOLDOWN_MS = 30_000

/**
 * Whether a sync started now would be turned away, given when the last one
 * finished. `null` last_sync_at means there has never been one.
 */
export function syncCooldownRemainingMs(
  lastSyncAt: string | null | undefined,
  now: number = Date.now(),
): number {
  if (!lastSyncAt) return 0
  const elapsed = now - new Date(lastSyncAt).getTime()
  // A clock skew that puts the last sync in the future must not lock the
  // button for longer than the cooldown itself.
  if (elapsed < 0) return SYNC_COOLDOWN_MS
  return Math.max(0, SYNC_COOLDOWN_MS - elapsed)
}
