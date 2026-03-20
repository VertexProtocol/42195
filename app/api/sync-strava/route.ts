import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { syncUserActivities } from "@/lib/strava-sync"
import { StravaAuthError } from "@/lib/strava"

export async function POST(request: NextRequest) {
  const fullSync = request.nextUrl.searchParams.get("full") === "1"

  // 1. Authenticate the calling user
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

  // 2. Rate limit & concurrency checks
  const { data: prevSync } = await service
    .from("sync_status")
    .select("last_sync_at, state, updated_at")
    .eq("user_id", userId)
    .maybeSingle()

  if (prevSync?.last_sync_at) {
    const lastSync = new Date(prevSync.last_sync_at).getTime()
    if (Date.now() - lastSync < 30_000) {
      return NextResponse.json(
        { error: "Please wait at least 30 seconds before syncing again" },
        { status: 429 },
      )
    }
  }

  if (prevSync?.state === "syncing") {
    const stuckThreshold = 2 * 60 * 1000
    if (prevSync.updated_at && Date.now() - new Date(prevSync.updated_at).getTime() < stuckThreshold) {
      return NextResponse.json(
        { error: "A sync is already in progress" },
        { status: 409 },
      )
    }
  }

  // 3. Mark sync as in-progress
  await service.from("sync_status").upsert(
    { user_id: userId, state: "syncing", error_message: null, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  )

  try {
    const result = await syncUserActivities(userId, fullSync)

    // Mark sync as success
    await service.from("sync_status").upsert(
      {
        user_id: userId,
        state: "success",
        last_sync_at: new Date().toISOString(),
        error_message: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )

    // Invalidate HR analysis cache so the profile page recomputes it with fresh data
    if (result.synced > 0) {
      await service.from("profiles").update({ hr_analysis_cache: null }).eq("id", userId)
    }

    return NextResponse.json({ ok: true, ...result })
  } catch (err: unknown) {
    console.error("Strava sync error:", err)

    const message =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : typeof err === "object" && err !== null && "message" in err
            ? String((err as { message: unknown }).message)
            : "Unknown sync error"

    await service.from("sync_status").upsert(
      {
        user_id: userId,
        state: "error",
        error_message: message,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )

    if (err instanceof StravaAuthError) {
      return NextResponse.json({ error: message, code: err.code }, { status: 403 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
