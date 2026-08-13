import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { recordSyncFailure, recordSyncResult, syncUserActivities } from "@/lib/strava-sync"
import { StravaAppInactiveError, StravaAuthError } from "@/lib/strava"
import { syncCooldownRemainingMs } from "@/lib/sync-constants"

// A history sync is chunked (see syncUserActivities), but one chunk still needs
// room for up to eight Strava reads plus the upserts.
export const maxDuration = 60

/** States a partial run leaves behind, from which the next call resumes. */
const RESUMABLE_STATES = new Set(["partial", "rate_limited"])

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
    .select("last_sync_at, state, updated_at, cursor_before, resume_at, resume_full")
    .eq("user_id", userId)
    .maybeSingle()

  // Continuing an unfinished sync is not a new sync: it skips the throttle and
  // picks up where the previous chunk stopped.
  const isContinuation = !!prevSync && RESUMABLE_STATES.has(prevSync.state)
  const resumeCursor = isContinuation ? (prevSync.cursor_before as number | null) : null

  // Whether this run is walking the whole history. A continuation inherits it
  // from the run it is continuing: the `full=1` on the first chunk is what the
  // remaining chunks are still finishing, and dropping it mid-history would
  // stop the walk at the previous successful sync.
  const isFullRun = isContinuation ? !!prevSync.resume_full : fullSync

  if (isContinuation && prevSync.resume_at) {
    const resumeAt = new Date(prevSync.resume_at as string)
    if (resumeAt > new Date()) {
      return NextResponse.json(
        {
          error: "Strava's rate limit for this app is spent. Syncing resumes automatically.",
          code: "STRAVA_RATE_LIMITED",
          resume_at: resumeAt.toISOString(),
          done: false,
        },
        { status: 429 },
      )
    }
  }

  // A deliberate full re-read of the history is exempt. The cooldown is there
  // to absorb repeated presses of an ordinary sync, which would find nothing;
  // a full re-sync is asked for once, behind a confirmation, and does have
  // something to do. Strava's own rate limit still bounds it.
  if (!isContinuation && !fullSync && prevSync?.last_sync_at) {
    const remainingMs = syncCooldownRemainingMs(prevSync.last_sync_at as string)
    if (remainingMs > 0) {
      // Not a failure. The previous sync finished, and finished recently — this
      // one is turned away because there is nothing new for it to fetch yet.
      // The code is what stops the client painting a red line over a sync that
      // worked, the same reason SYNC_IN_PROGRESS below carries one.
      return NextResponse.json(
        {
          error: "Just synced. Give Strava a moment before asking again.",
          code: "SYNC_TOO_SOON",
          retry_after_seconds: Math.ceil(remainingMs / 1000),
          last_sync_at: prevSync.last_sync_at,
        },
        { status: 429, headers: { "Retry-After": String(Math.ceil(remainingMs / 1000)) } },
      )
    }
  }

  if (prevSync?.state === "syncing") {
    const stuckThreshold = 2 * 60 * 1000
    if (prevSync.updated_at && Date.now() - new Date(prevSync.updated_at).getTime() < stuckThreshold) {
      // Not a failure. Another run — another tab, a reload that landed on
      // top of the first one — already owns this sync, and its results will
      // arrive for both. The code is what lets the client say "syncing"
      // instead of painting an error over a sync that is working.
      return NextResponse.json(
        { error: "A sync is already in progress", code: "SYNC_IN_PROGRESS" },
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
    const result = await syncUserActivities(userId, { fullSync: isFullRun, resumeCursor })

    await recordSyncResult(userId, result, isFullRun)

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

    await recordSyncFailure(userId, message)

    // The app's own API access is off. Nothing the athlete does — reconnecting
    // included — changes that, so it gets its own code rather than looking like
    // a broken connection.
    if (err instanceof StravaAppInactiveError) {
      return NextResponse.json({ error: message, code: err.code }, { status: 503 })
    }
    if (err instanceof StravaAuthError) {
      return NextResponse.json({ error: message, code: err.code }, { status: 403 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
