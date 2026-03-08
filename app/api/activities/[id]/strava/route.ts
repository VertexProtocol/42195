import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { getStravaAccessToken } from "@/lib/strava"

/**
 * DELETE /api/activities/[id]/strava
 * Deletes an activity from both the app database and Strava.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const service = createServiceClient()

  // Fetch the activity to get the strava_id
  const { data: activity, error: fetchError } = await service
    .from("activities")
    .select("id, strava_id, user_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single()

  if (fetchError || !activity) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 })
  }

  if (!activity.strava_id) {
    return NextResponse.json(
      { error: "Activity is not linked to Strava" },
      { status: 400 },
    )
  }

  // Delete from Strava
  try {
    const accessToken = await getStravaAccessToken(user.id)
    const res = await fetch(
      `https://www.strava.com/api/v3/activities/${activity.strava_id}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    )

    if (!res.ok && res.status !== 404) {
      const body = await res.text()
      console.error(`Strava delete failed (${res.status}):`, body)
      return NextResponse.json(
        { error: "Failed to delete from Strava" },
        { status: 502 },
      )
    }
  } catch (err) {
    console.error("Strava delete error:", err)
    return NextResponse.json(
      { error: "Failed to connect to Strava" },
      { status: 502 },
    )
  }

  // Delete from our database
  const { error: deleteError } = await service
    .from("activities")
    .delete()
    .eq("id", id)

  if (deleteError) {
    console.error("DB delete after Strava delete failed:", deleteError)
    return NextResponse.json(
      { error: "Deleted from Strava but failed to remove from app" },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true })
}
