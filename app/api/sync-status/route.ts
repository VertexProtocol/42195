import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const service = createServiceClient()

  // Check if Strava is connected (strava_tokens row exists)
  const { data: tokenRow } = await service
    .from("strava_tokens")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle()

  // Load current sync status
  const { data: syncData } = await supabase
    .from("sync_status")
    .select("last_sync_at, state, error_message")
    .eq("user_id", user.id)
    .maybeSingle()

  return NextResponse.json({
    strava_connected: !!tokenRow,
    sync_status: syncData
      ? {
          state: syncData.state as string,
          last_sync_at: syncData.last_sync_at as string | null,
          error_message: syncData.error_message as string | null,
        }
      : null,
  })
}
