import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import {
  withStravaRetry,
  stravaApiFetch,
  StravaAuthError,
  StravaRateLimitError,
  StravaUnauthorizedError,
} from "@/lib/strava"
import type { StreamPoint } from "@/lib/types"

interface StravaStreamData {
  data: number[]
}

interface StravaStreamsResponse {
  time?: StravaStreamData
  heartrate?: StravaStreamData
  velocity_smooth?: StravaStreamData
  altitude?: StravaStreamData
  cadence?: StravaStreamData
}

function velocityToPace(ms: number): number | null {
  if (ms < 0.5) return null // standing still or GPS noise
  return 1000 / ms / 60
}

function downsample<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) return arr
  const step = Math.floor(arr.length / maxPoints)
  return arr.filter((_, i) => i % step === 0)
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

  // 1. Return cached streams if available and not stale (7-day TTL)
  const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
  const { data: cached } = await service
    .from("activity_streams")
    .select("points, fetched_at")
    .eq("activity_id", id)
    .single<{ points: StreamPoint[]; fetched_at: string }>()

  if (cached) {
    const cacheAge = Date.now() - new Date(cached.fetched_at).getTime()
    if (cacheAge < CACHE_TTL_MS) {
      return NextResponse.json({ points: cached.points })
    }
    // Cache is stale — delete it now.
    // Strava API Agreement §7 prohibits retaining Strava data in cache longer
    // than 7 days. Explicitly delete rather than relying on upsert overwrite.
    await service.from("activity_streams").delete().eq("activity_id", id)
  }

  // 2. No cache — need to fetch from Strava
  if (!activity.strava_id) {
    return NextResponse.json({ points: [] })
  }

  let streams: StravaStreamsResponse
  try {
    streams = await withStravaRetry(user.id, async (token) => {
      const res = await stravaApiFetch(
        `https://www.strava.com/api/v3/activities/${activity.strava_id}/streams?keys=time,heartrate,velocity_smooth,altitude,cadence&key_by_type=true`,
        token,
      )
      if (res.status === 401) throw new StravaUnauthorizedError()
      if (!res.ok) throw new Error(`Strava streams fetch failed: ${res.status}`)
      return res.json() as Promise<StravaStreamsResponse>
    })
  } catch (err) {
    if (err instanceof StravaAuthError) {
      return NextResponse.json({ error: "No Strava account connected", code: err.code }, { status: 403 })
    }
    if (err instanceof StravaRateLimitError) {
      return NextResponse.json(
        { error: err.message, code: "STRAVA_RATE_LIMITED", resume_at: err.resetAt.toISOString() },
        { status: 429 },
      )
    }
    return NextResponse.json({ error: "Strava streams fetch failed" }, { status: 502 })
  }

  const timeData = streams.time?.data ?? []
  const hrData = streams.heartrate?.data
  const velocityData = streams.velocity_smooth?.data
  const altitudeData = streams.altitude?.data
  const cadenceData = streams.cadence?.data

  const rawPoints: StreamPoint[] = timeData.map((t, i) => ({
    time: t,
    hr: hrData ? (hrData[i] ?? null) : null,
    pace: velocityData ? velocityToPace(velocityData[i] ?? 0) : null,
    altitude: altitudeData ? (altitudeData[i] ?? null) : null,
    cadence: cadenceData ? (cadenceData[i] ?? null) : null,
  }))

  const points = downsample(rawPoints, 200)

  // 3. Persist to DB so subsequent loads are instant
  await service
    .from("activity_streams")
    .upsert({ activity_id: id, points, fetched_at: new Date().toISOString() })

  return NextResponse.json({ points })
}
