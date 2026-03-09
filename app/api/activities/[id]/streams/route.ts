import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { getStravaAccessToken } from "@/lib/strava"
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

  // 1. Return cached streams if available
  const { data: cached } = await service
    .from("activity_streams")
    .select("points")
    .eq("activity_id", id)
    .single<{ points: StreamPoint[] }>()

  if (cached) {
    return NextResponse.json({ points: cached.points })
  }

  // 2. No cache — need to fetch from Strava
  if (!activity.strava_id) {
    return NextResponse.json({ points: [] })
  }

  let accessToken: string
  try {
    accessToken = await getStravaAccessToken(user.id)
  } catch {
    return NextResponse.json({ error: "No Strava account connected" }, { status: 403 })
  }

  const res = await fetch(
    `https://www.strava.com/api/v3/activities/${activity.strava_id}/streams?keys=time,heartrate,velocity_smooth,altitude,cadence&key_by_type=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )

  if (!res.ok) {
    return NextResponse.json({ error: "Strava streams fetch failed" }, { status: 502 })
  }

  const streams = (await res.json()) as StravaStreamsResponse

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
