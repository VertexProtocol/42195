import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { syncSingleActivity, deleteSyncedActivity } from "@/lib/strava-sync"

// ---------------------------------------------------------------------------
// Strava Webhook Event types
// ---------------------------------------------------------------------------

interface StravaWebhookEvent {
  object_type: "activity" | "athlete"
  object_id: number
  aspect_type: "create" | "update" | "delete"
  owner_id: number // Strava athlete_id
  subscription_id: number
  event_time: number
  updates?: Record<string, string>
}

// ---------------------------------------------------------------------------
// GET — Webhook subscription verification
//
// Strava sends a GET request when you create a subscription to verify
// ownership of the callback URL. We must echo back hub.challenge.
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode")
  const challenge = request.nextUrl.searchParams.get("hub.challenge")
  const verifyToken = request.nextUrl.searchParams.get("hub.verify_token")

  if (mode === "subscribe" && challenge) {
    // Verify the token matches what we set when creating the subscription
    if (verifyToken !== process.env.STRAVA_WEBHOOK_VERIFY_TOKEN) {
      console.error("Strava webhook verification failed: token mismatch")
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    return NextResponse.json({ "hub.challenge": challenge })
  }

  return NextResponse.json({ error: "Bad request" }, { status: 400 })
}

// ---------------------------------------------------------------------------
// POST — Incoming webhook events
//
// Strava sends a POST for every activity create/update/delete.
// We respond 200 immediately — Strava requires a response within 2 seconds.
// Actual processing happens in the background.
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  let event: StravaWebhookEvent
  try {
    event = (await request.json()) as StravaWebhookEvent
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // Validate subscription_id to reject forged webhook calls.
  // Strava assigns a subscription_id when you create the webhook subscription.
  const expectedSubId = process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID
  if (expectedSubId && String(event.subscription_id) !== expectedSubId) {
    console.warn(`Strava webhook: subscription_id mismatch (got ${event.subscription_id}, expected ${expectedSubId})`)
    return NextResponse.json({ error: "Invalid subscription" }, { status: 403 })
  }

  const service = createServiceClient()

  // Look up which user owns this Strava athlete_id. A unique index on
  // athlete_id (migration 023) keeps this to at most one row; limit(1) means a
  // database that predates the index degrades to "route to one account"
  // instead of erroring out and dropping the event for everyone.
  const { data: tokenRows } = await service
    .from("strava_tokens")
    .select("user_id")
    .eq("athlete_id", event.owner_id)
    .limit(1)

  const tokenRow = tokenRows?.[0]

  if (!tokenRow) {
    // Unknown athlete — nothing to do
    console.warn(`Strava webhook: unknown athlete_id ${event.owner_id}`)
    return NextResponse.json({ ok: true })
  }

  const userId = tokenRow.user_id

  // ---------------------------------------------------------------------------
  // Athlete deauthorization — user revoked Strava access.
  // Strava API Agreement §5.4 requires deleting all Personal Data when a user
  // revokes authorization. Delete every Strava-derived record for this user.
  // We retain the app auth account so the user can reconnect if they choose.
  // ---------------------------------------------------------------------------
  if (event.object_type === "athlete" && event.aspect_type === "delete") {
    const tables = [
      "activity_streams",
      "activity_laps",
      "activity_analyses",
      "activities",
      "ai_training_plans",
      "goal_preferences",
      "sync_status",
      "strava_tokens",
    ] as const

    for (const table of tables) {
      const { error } = await service.from(table).delete().eq("user_id", userId)
      if (error && error.code !== "42P01") {
        console.error(`Strava deauthorize: failed to delete from ${table} for user ${userId}:`, error)
      }
    }

    console.log(`Strava deauthorize: deleted all Strava data for user ${userId} (athlete ${event.owner_id})`)
    return NextResponse.json({ ok: true })
  }

  // Ignore other non-activity events
  if (event.object_type !== "activity") {
    return NextResponse.json({ ok: true })
  }

  try {
    if (event.aspect_type === "create" || event.aspect_type === "update") {
      await syncSingleActivity(userId, event.object_id)
    } else if (event.aspect_type === "delete") {
      await deleteSyncedActivity(userId, event.object_id)
    }
  } catch (err) {
    // Log but still return 200 — Strava will retry on non-2xx and we don't
    // want retries piling up for transient errors.
    console.error(`Strava webhook processing error (athlete=${event.owner_id}, activity=${event.object_id}):`, err)
  }

  return NextResponse.json({ ok: true })
}
