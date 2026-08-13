import { NextRequest, NextResponse, after } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { syncSingleActivity, deleteSyncedActivity, recordSyncFailure } from "@/lib/strava-sync"
import { StravaAppInactiveError, StravaAuthError } from "@/lib/strava"
import { recordServerError } from "@/lib/error-sink"

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
      // The documented way creating a subscription fails, and it fails from
      // Strava's side where nobody sees it. Recorded rather than logged: the
      // person running the script needs to be able to find out why.
      await recordServerError(
        "webhook.strava.verify",
        new Error(
          process.env.STRAVA_WEBHOOK_VERIFY_TOKEN
            ? "hub.verify_token did not match STRAVA_WEBHOOK_VERIFY_TOKEN"
            : "STRAVA_WEBHOOK_VERIFY_TOKEN is not set on this deployment",
        ),
      )
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    return NextResponse.json({ "hub.challenge": challenge })
  }

  return NextResponse.json({ error: "Bad request" }, { status: 400 })
}

// ---------------------------------------------------------------------------
// POST — Incoming webhook events
//
// Strava sends a POST for every activity create/update/delete, and wants the
// 200 within two seconds. The lookups needed to decide *whether* an event is
// ours are quick and happen inline; fetching the activity is not, and runs
// after the response via after().
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
    // Not a forged call so much as a misconfiguration: this rejects *every*
    // event for as long as it stands, and from inside the app it looks exactly
    // like Strava having gone quiet. Recorded so it is findable.
    await recordServerError(
      "webhook.strava.subscription",
      new Error(
        `subscription_id mismatch: Strava sent ${event.subscription_id}, ` +
          `STRAVA_WEBHOOK_SUBSCRIPTION_ID is ${expectedSubId}`,
      ),
    )
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

  // Strava wants the 200 within two seconds and retries when it does not get
  // one. This work does not fit in two seconds: syncSingleActivity refreshes
  // the token if needed, fetches the activity, upserts it, and then recalcs
  // every goal and shared-goal position the runner has. Awaiting it before
  // answering — which is what this did, under a comment claiming the opposite
  // — put the response behind all of it, and a subscription whose deliveries
  // keep timing out is one Strava eventually deletes.
  //
  // after() runs it once the response is on the wire, and keeps the serverless
  // invocation alive while it does, which returning an unawaited promise does
  // not.
  after(async () => {
    try {
      if (event.aspect_type === "create" || event.aspect_type === "update") {
        await syncSingleActivity(userId, event.object_id)
      } else if (event.aspect_type === "delete") {
        await deleteSyncedActivity(userId, event.object_id)
      }
    } catch (err) {
      // The 200 has already gone, so throwing here would not reach Strava, and
      // a retry is not wanted anyway. But swallowing it into console.error is
      // how a delivery path can stop working for months and look exactly like
      // a runner who stopped running: nothing arrives, and nothing says why.
      await recordServerError(`webhook.strava.${event.aspect_type}`, err, { userId })

      // Two failures are the runner's to act on and will not fix themselves:
      // their Strava authorization is gone, or the app's API access is off.
      // Those are surfaced the same way the manual sync surfaces them, so the
      // app says what is wrong instead of going quiet. Anything else is left
      // alone — a transient blip should not paint an error over a working app,
      // and the next sync picks up what this missed.
      if (err instanceof StravaAuthError || err instanceof StravaAppInactiveError) {
        await recordSyncFailure(userId, err.message)
      }
    }
  })

  return NextResponse.json({ ok: true })
}
