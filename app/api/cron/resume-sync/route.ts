import { timingSafeEqual } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import {
  recordSyncFailure,
  recordSyncResult,
  syncUserActivities,
} from "@/lib/strava-sync"
import { StravaAppInactiveError, StravaAuthError } from "@/lib/strava"

/**
 * GET /api/cron/resume-sync
 *
 * Finishes the history syncs that stopped short.
 *
 * A sync is chunked, and until now every chunk after the first depended on the
 * runner keeping the tab open: a run that hit Strava's app-wide rate limit told
 * them to "sync again in a few minutes", and if they closed the app instead,
 * the rest of their history sat there. With one athlete that was a nuisance.
 * With ten sharing one application's 100-reads-per-15-minutes, the first
 * backfill of the day rate-limits the rest of them, so the tab nobody keeps
 * open is the normal case rather than the unlucky one.
 *
 * This is that tab, on a schedule. It claims the runs that are due, continues
 * them exactly as the runner's own request would, and writes the same state
 * back through the same helper.
 */

// One chunk is up to eight Strava reads plus the upserts, and this route runs
// several of them back to back.
export const maxDuration = 60

/**
 * How many runners one tick will carry.
 *
 * The limit being waited on is Strava's, and it is per application rather than
 * per athlete: 100 reads per 15 minutes shared by everyone. Three runners at up
 * to eight reads each is 24, which leaves the window with room for the runs
 * people are triggering themselves — the whole point is to finish backfills in
 * the background, not to spend the budget the app needs to feel live.
 */
const MAX_RUNNERS_PER_TICK = 3

/** States a partial run leaves behind, from which this route resumes. */
const RESUMABLE_STATES = ["partial", "rate_limited"]

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Absent the secret
 * this route refuses everyone rather than defaulting open — it moves other
 * people's data with the service-role key, and an open endpoint that does that
 * is worse than a cron that never runs.
 */
function authorised(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const offered = request.headers.get("authorization") ?? ""
  const expected = `Bearer ${secret}`

  // Same-length comparison, so the check itself does not leak the secret one
  // byte at a time.
  const a = Buffer.from(offered)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

interface DueRow {
  user_id: string
  cursor_before: number | null
  resume_full: boolean
}

export async function GET(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const service = createServiceClient()

  // Due means unfinished and not still waiting on a rate-limit window. Oldest
  // first, so a runner whose backfill stalled is never overtaken by one whose
  // sync stalled a minute ago.
  const { data: due, error } = await service
    .from("sync_status")
    .select("user_id, cursor_before, resume_full")
    .in("state", RESUMABLE_STATES)
    .or(`resume_at.is.null,resume_at.lte.${new Date().toISOString()}`)
    .order("updated_at", { ascending: true })
    .limit(MAX_RUNNERS_PER_TICK)
    .returns<DueRow[]>()

  if (error) {
    console.error("[cron/resume-sync] Could not read due syncs:", error.message)
    return NextResponse.json({ error: "Could not read sync state" }, { status: 500 })
  }

  const rows = due ?? []
  let resumed = 0
  let synced = 0
  let finished = 0
  let stoppedOn: string | null = null

  for (const row of rows) {
    try {
      const result = await syncUserActivities(row.user_id, {
        fullSync: row.resume_full,
        resumeCursor: row.cursor_before,
      })
      const state = await recordSyncResult(row.user_id, result, row.resume_full)

      resumed++
      synced += result.synced
      if (state === "success") finished++

      // The rate limit is the application's, not this runner's. Once it is
      // spent every remaining runner in the batch would only burn a request to
      // be told the same thing, and each of those failures would overwrite a
      // resume_at that is already correct.
      if (state === "rate_limited") {
        stoppedOn = "rate_limited"
        break
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown sync error"
      console.error(`[cron/resume-sync] ${row.user_id} failed:`, message)
      await recordSyncFailure(row.user_id, message)

      // The app's own API access is off, so every runner in the batch is about
      // to fail the same way. Stop and leave the rest resumable.
      if (err instanceof StravaAppInactiveError) {
        stoppedOn = "app_inactive"
        break
      }
      // A revoked or missing authorisation is this runner's alone. It is now
      // recorded on their row, and the loop moves on.
      if (err instanceof StravaAuthError) continue
    }
  }

  // The one line worth having in the platform logs: a tick that resumed nothing
  // reads identically to a cron that is not firing at all.
  console.log(
    `[cron/resume-sync] due=${rows.length} resumed=${resumed} finished=${finished} ` +
      `activities=${synced}${stoppedOn ? ` stopped=${stoppedOn}` : ""}`,
  )

  return NextResponse.json({
    ok: true,
    due: rows.length,
    resumed,
    finished,
    synced,
    stoppedOn,
  })
}
