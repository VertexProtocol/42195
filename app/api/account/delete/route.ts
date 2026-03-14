import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"

/**
 * DELETE /api/account/delete
 *
 * Deletes all user data and the user's auth account.
 * Requires an authenticated session.
 *
 * Deletes (in order):
 *  1. activity_streams & activity_laps (cached data, FK cascades from activities)
 *  2. activities
 *  3. goals
 *  4. weekly_goals
 *  5. ai_training_plans (if exists)
 *  6. goal_preferences (if exists)
 *  7. sync_status
 *  8. strava_tokens
 *  9. profiles
 * 10. auth.users (via admin API)
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
    // activity_streams and activity_laps cascade from activities, but delete explicitly for clarity.
    const tables = [
      "activity_streams",
      "activity_laps",
      "activities",
      "ai_training_plans",
      "goal_preferences",
      "goals",
      "weekly_goals",
      "sync_status",
      "strava_tokens",
      "profiles",
    ]

    for (const table of tables) {
      const { error } = await service.from(table).delete().eq("user_id", userId)
      if (error) {
        // Some tables might not exist yet — skip gracefully
        if (error.code === "42P01") continue // relation does not exist
        console.error(`Failed to delete from ${table}:`, error)
      }
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
