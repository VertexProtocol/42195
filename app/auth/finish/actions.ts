"use server"

import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { safeNext } from "@/lib/auth-redirect"
import { isPlaceholderEmail } from "@/lib/strava-account"
import { logError } from "@/lib/log"

export type SaveEmailStatus = "idle" | "invalid" | "taken" | "failed"
export interface SaveEmailState {
  status: SaveEmailStatus
}

export const SAVE_EMAIL_IDLE: SaveEmailState = { status: "idle" }

/**
 * Put a real address on an account that arrived through Strava.
 *
 * Set with the admin client and `email_confirm: true` rather than
 * `updateUser`, which would send a change-confirmation mail and hand the
 * runner back the inbox round trip that signing in with Strava just saved
 * them. The address is for reaching them later, and it is theirs to correct
 * in Profile — it is not standing in for the proof of identity, which Strava
 * already gave.
 *
 * Only ever fills a placeholder. An account that already has a real address
 * changes it in Profile, where changing an email is a deliberate act with a
 * confirmation behind it.
 */
export async function saveEmailAction(
  _previous: SaveEmailState,
  formData: FormData,
): Promise<SaveEmailState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase()
  // The browser has already checked the shape; this is the copy that counts.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { status: "invalid" }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { status: "failed" }
  if (!isPlaceholderEmail(user.email)) return { status: "failed" }

  const { error } = await createServiceClient().auth.admin.updateUserById(user.id, {
    email,
    email_confirm: true,
  })

  if (error) {
    // The one failure worth naming: somebody already signs in with it.
    const message = error.message.toLowerCase()
    if (message.includes("already been registered") || message.includes("already exists")) {
      return { status: "taken" }
    }
    logError("auth.finish.email", error.message)
    return { status: "failed" }
  }

  // profiles.email is filled by the new-user trigger and not by this update,
  // so it still holds the placeholder.
  const { error: profileError } = await createServiceClient()
    .from("profiles")
    .update({ email })
    .eq("id", user.id)

  if (profileError) logError("auth.finish.profile", profileError.message)

  // Straight on to wherever they were going. There is nothing to confirm and
  // nothing more to fill in, so a "saved" screen would be a step for its own
  // sake.
  redirect(safeNext(formData.get("next") as string | null))
}
