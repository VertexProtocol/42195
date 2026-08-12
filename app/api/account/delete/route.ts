import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"

/**
 * DELETE /api/account/delete
 *
 * Deletes all user data and the user's auth account.
 * Requires an authenticated session.
 *
 * Almost everything hangs off auth.users with ON DELETE CASCADE, so deleting
 * the auth user at the end is what actually clears it. Two tables do not:
 * ai_training_plans and goal_preferences are ON DELETE NO ACTION, and would
 * make that final delete fail with a foreign-key violation. Those two are the
 * load-bearing entries in the list below — the rest are belt and braces, and
 * are kept so that a failure part-way through still leaves as little behind
 * as possible.
 */
export async function DELETE() {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = user.id
  const service = createServiceClient()

  try {
    // Delete all user data. Order matters for foreign key constraints.
    //
    // activity_streams and activity_laps are not here: they are keyed by
    // activity_id and have no user_id at all, so the deletes that used to name
    // them could never match a row. They cascade from activities, which is
    // two lines down, and always did.
    const tables = [
      "test_runs",
      "activities",
      // Both ON DELETE NO ACTION. Without these two the admin delete below
      // fails on a foreign-key violation and the account survives.
      "ai_training_plans",
      "goal_preferences",
      "goals",
      "weekly_goals",
      "sync_status",
      "strava_tokens",
    ]

    for (const table of tables) {
      const { error } = await service.from(table).delete().eq("user_id", userId)
      if (error) {
        // Some tables might not exist yet — skip gracefully
        if (error.code === "42P01") continue // relation does not exist
        console.error(`Failed to delete from ${table}:`, error)
      }
    }

    // profiles is keyed by id, not user_id — it is the auth user's own row.
    // Deleting it by user_id, as this used to, raised "column does not exist"
    // on every account deletion and was logged and stepped over. The row went
    // anyway, on the cascade from auth.users, which is why nothing looked
    // wrong from outside.
    const { error: profileError } = await service.from("profiles").delete().eq("id", userId)
    if (profileError && profileError.code !== "42P01") {
      console.error("Failed to delete from profiles:", profileError)
    }

    // Delete the auth user via Supabase admin API
    const { error: deleteAuthError } = await service.auth.admin.deleteUser(userId)
    if (deleteAuthError) {
      console.error("Failed to delete auth user:", deleteAuthError)
      return NextResponse.json(
        { error: "Failed to delete authentication account. Please try again." },
        { status: 500 },
      )
    }

    return NextResponse.json({ ok: true, message: "Account and all data deleted successfully." })
  } catch (err) {
    console.error("Account deletion error:", err)
    return NextResponse.json(
      { error: "An unexpected error occurred during account deletion." },
      { status: 500 },
    )
  }
}
