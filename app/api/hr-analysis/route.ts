import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { analyzeHeartRateZones } from "@/lib/hr-analysis-engine"
import type { Activity } from "@/lib/types"

/**
 * GET /api/hr-analysis
 *
 * Runs the heart rate zone calibration analysis for the authenticated user.
 * Returns current zones, recommended zones, calibration status, and explanations.
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Fetch all activities with HR data
  const { data: rawActivities, error: actError } = await supabase
    .from("activities")
    .select(
      "id, user_id, strava_id, type, name, date, distance_km, duration_seconds, pace_min_per_km, elevation_gain_m, avg_heart_rate, avg_cadence, calories, map_polyline, created_at",
    )
    .eq("user_id", user.id)
    .order("date", { ascending: false })
    .limit(300)

  if (actError) {
    console.error("Failed to fetch activities for HR analysis:", actError)
    return NextResponse.json({ error: "Failed to fetch activity data" }, { status: 500 })
  }

  const activities: Activity[] = (rawActivities ?? []).map((a) => ({
    id: a.id,
    user_id: a.user_id,
    strava_id: a.strava_id,
    type: a.type,
    name: a.name,
    date: a.date,
    distance_km: Number(a.distance_km),
    duration_seconds: a.duration_seconds,
    pace_min_per_km: a.pace_min_per_km ? Number(a.pace_min_per_km) : null,
    elevation_gain_m: a.elevation_gain_m ? Number(a.elevation_gain_m) : null,
    avg_heart_rate: a.avg_heart_rate,
    avg_cadence: a.avg_cadence ?? null,
    calories: a.calories,
    map_polyline: a.map_polyline,
    created_at: a.created_at,
  }))

  const result = analyzeHeartRateZones(activities)

  return NextResponse.json({ analysis: result })
}
