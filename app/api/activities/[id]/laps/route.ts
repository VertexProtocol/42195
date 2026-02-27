import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { getStravaAccessToken } from "@/lib/strava"
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
  const { data: activity, error: activityError } = await service
    .from("activities")
    .select("strava_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single<{ strava_id: number }>()

  if (activityError || !activity?.strava_id) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 })
  }

  let accessToken: string
  try {
    accessToken = await getStravaAccessToken(user.id)
  } catch {
    return NextResponse.json({ error: "No Strava account connected" }, { status: 403 })
  }

  const res = await fetch(
    `https://www.strava.com/api/v3/activities/${activity.strava_id}/laps`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )

  if (!res.ok) {
    return NextResponse.json({ error: "Strava laps fetch failed" }, { status: 502 })
  }

  const stravaLaps = (await res.json()) as StravaLap[]

  const laps: Lap[] = stravaLaps.map((lap) => ({
    index: lap.lap_index,
    distance_km: lap.distance / 1000,
    duration_seconds: lap.moving_time,
    pace_min_per_km: speedToPace(lap.average_speed),
    avg_heart_rate: lap.average_heartrate ?? null,
  }))

  return NextResponse.json({ laps })
}
