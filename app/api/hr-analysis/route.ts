import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { analyzeHeartRateZones } from "@/lib/hr-analysis-engine"
import type { Activity } from "@/lib/types"

/**
 * GET /api/hr-analysis
 *
 * Runs the heart rate zone calibration analysis for the authenticated user
 * and caches the result on their profile.
 *
 * The athlete's configured max/resting HR are read from the profile and
 * passed in. That is what makes the verdict meaningful: without a configured
 * max HR the engine reports `not_configured` rather than comparing the
 * recommendation against an invented baseline.
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

  const [{ data: profile }, { data: rawActivities, error: actError }] = await Promise.all([
    supabase.from("profiles").select("max_hr, resting_hr").eq("id", user.id).single(),
    // Only the columns the engine reads — no map_polyline, which would pull
    // hundreds of encoded routes across the wire to compute an average.
    supabase
      .from("activities")
      .select(
        "id, user_id, strava_id, type, name, date, distance_km, duration_seconds, pace_min_per_km, elevation_gain_m, avg_heart_rate, max_heart_rate, created_at",
      )
      .eq("user_id", user.id)
      .not("avg_heart_rate", "is", null)
      .gt("avg_heart_rate", 0)
      .order("date", { ascending: false })
      .limit(300),
  ])

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
    max_heart_rate: a.max_heart_rate ?? null,
    avg_cadence: null,
    calories: null,
    map_polyline: null,
    created_at: a.created_at,
  }))

  const result = analyzeHeartRateZones(activities, {
    configuredMaxHr: profile?.max_hr ?? null,
    restingHr: profile?.resting_hr ?? null,
  })

  // Persist so the profile screen can restore it across sessions
  await supabase.from("profiles").update({ hr_analysis_cache: result }).eq("id", user.id)

  return NextResponse.json({ analysis: result })
}
