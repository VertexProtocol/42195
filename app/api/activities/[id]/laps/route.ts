import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { withStravaRetry, stravaApiFetch, StravaAuthError, StravaUnauthorizedError } from "@/lib/strava"
import type { Lap } from "@/lib/types"

interface StravaLap {
  lap_index: number
  distance: number // metres
  moving_time: number // seconds
  average_speed: number // m/s
  average_heartrate?: number
}

function speedToPace(ms: number): number {
  if (ms <= 0) return 0
  return 1000 / ms / 60
}

export async function GET(
  _request: Request,
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

  // Verify the activity belongs to this user and get strava_id
  const { data: activity, error: activityError } = await service
    .from("activities")
    .select("id, strava_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single<{ id: string; strava_id: number | null }>()

  if (activityError || !activity) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 })
  }

  // 1. Return cached laps if available and not stale (7-day TTL)
  const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
  const { data: cached } = await service
    .from("activity_laps")
    .select("laps, fetched_at")
    .eq("activity_id", id)
    .single<{ laps: Lap[]; fetched_at: string }>()

  if (cached) {
    const cacheAge = Date.now() - new Date(cached.fetched_at).getTime()
    if (cacheAge < CACHE_TTL_MS) {
      return NextResponse.json({ laps: cached.laps })
    }
    // Cache is stale — fall through to re-fetch from Strava
  }

  // 2. No cache — need to fetch from Strava
  if (!activity.strava_id) {
    return NextResponse.json({ laps: [] })
  }

  let stravaLaps: StravaLap[]
  try {
    stravaLaps = await withStravaRetry(user.id, async (token) => {
      const res = await stravaApiFetch(
        `https://www.strava.com/api/v3/activities/${activity.strava_id}/laps`,
        token,
      )
      if (res.status === 401) throw new StravaUnauthorizedError()
      if (!res.ok) throw new Error(`Strava laps fetch failed: ${res.status}`)
      return res.json() as Promise<StravaLap[]>
    })
  } catch (err) {
    if (err instanceof StravaAuthError) {
      return NextResponse.json({ error: "No Strava account connected", code: err.code }, { status: 403 })
    }
    return NextResponse.json({ error: "Strava laps fetch failed" }, { status: 502 })
  }

  const laps: Lap[] = stravaLaps.map((lap) => ({
    index: lap.lap_index,
    distance_km: lap.distance / 1000,
    duration_seconds: lap.moving_time,
    pace_min_per_km: speedToPace(lap.average_speed),
    avg_heart_rate: lap.average_heartrate ?? null,
  }))

  // 3. Persist to DB so subsequent loads are instant
  await service
    .from("activity_laps")
    .upsert({ activity_id: id, laps, fetched_at: new Date().toISOString() })

  return NextResponse.json({ laps })
}
