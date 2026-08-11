import { createServiceClient } from "@/lib/supabase/service"

/**
 * Invite allowlist.
 *
 * Sign-up is refused unless the address has a row in `allowed_signups`. The
 * table is service-role only, so the list of invited addresses is never
 * readable from the browser.
 *
 * Invites are added by hand in SQL:
 *   insert into allowed_signups (email, note) values ('runner@example.com', 'Beta 1');
 */

/** Addresses are stored and compared lower-cased and trimmed. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * True when the address may create an account.
 *
 * Fails closed: any error reading the allowlist is treated as "not invited"
 * rather than letting an unexpected database problem open sign-up to everyone.
 */
export async function isEmailAllowed(email: string): Promise<boolean> {
  const normalized = normalizeEmail(email)
  if (!normalized) return false

  const service = createServiceClient()
  const { data, error } = await service
    .from("allowed_signups")
    .select("email")
    .eq("email", normalized)
    .maybeSingle()

  if (error) {
    console.error("Allowlist lookup failed:", error)
    return false
  }

  return !!data
}

/**
 * Records that an invite has been used. Best-effort bookkeeping — a failure
 * here must never fail the sign-up that already succeeded.
 */
export async function claimAllowlistEntry(email: string, userId?: string): Promise<void> {
  const normalized = normalizeEmail(email)
  if (!normalized) return

  const service = createServiceClient()
  const { error } = await service
    .from("allowed_signups")
    .update({ claimed_at: new Date().toISOString(), claimed_by: userId ?? null })
    .eq("email", normalized)
    .is("claimed_at", null)

  if (error) {
    console.error("Failed to mark allowlist entry as claimed:", error)
  }
}
