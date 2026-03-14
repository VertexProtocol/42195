import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { extractDerivedMetrics, validatePrediction } from "@/lib/test-run-benchmark"
import { predictRaceTimes } from "@/lib/training-utils"
import type { Activity, TestRunType } from "@/lib/types"

/**
 * GET /api/test-runs
 *
 * Returns all test runs for the authenticated user, optionally filtered by type.
 * Query params: ?type=5k_time_trial (optional)
 */
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const typeFilter = url.searchParams.get("type")

  let query = supabase
    .from("test_runs")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })

  if (typeFilter) {
    query = query.eq("test_type", typeFilter)
  }

  const { data, error } = await query

  if (error) {
    console.error("Failed to fetch test runs:", error)
    return NextResponse.json({ error: "Failed to fetch test runs" }, { status: 500 })
  }

  return NextResponse.json({ test_runs: data ?? [] })
}

/**
 * POST /api/test-runs
 *
 * Creates a test run from an existing activity.
 * Body: {
 *   activity_id: string,
 *   test_type?: TestRunType,
 *   notes?: string,
 *   prediction_distance_km?: number  // links to a prediction distance for validation
 * }
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const {
    activity_id,
    test_type = "custom",
    notes = null,
    prediction_distance_km = null,
  } = body as {
    activity_id: string
    test_type?: TestRunType
    notes?: string | null
    prediction_distance_km?: number | null
  }

  if (!activity_id) {
    return NextResponse.json({ error: "activity_id is required" }, { status: 400 })
  }

  // Fetch the activity and verify ownership
  const { data: activity, error: activityError } = await supabase
    .from("activities")
    .select(
      "id, user_id, strava_id, type, name, date, distance_km, duration_seconds, pace_min_per_km, elevation_gain_m, avg_heart_rate, avg_cadence, calories, map_polyline, created_at",
    )
    .eq("id", activity_id)
    .eq("user_id", user.id)
    .single()

  if (activityError || !activity) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 })
  }

  // Map to Activity type for metric extraction
  const act: Activity = {
    id: activity.id,
    user_id: activity.user_id,
    strava_id: activity.strava_id,
    type: activity.type,
    name: activity.name,
    date: activity.date,
    distance_km: Number(activity.distance_km),
    duration_seconds: activity.duration_seconds,
    pace_min_per_km: activity.pace_min_per_km ? Number(activity.pace_min_per_km) : null,
    elevation_gain_m: activity.elevation_gain_m ? Number(activity.elevation_gain_m) : null,
    avg_heart_rate: activity.avg_heart_rate,
    avg_cadence: activity.avg_cadence ?? null,
    calories: activity.calories,
    map_polyline: activity.map_polyline,
    created_at: activity.created_at,
  }

  // Extract derived metrics
  const derived = extractDerivedMetrics(act, test_type)

  // Compute prediction validation if a prediction distance is specified
  let predictionValidation = null
  if (prediction_distance_km != null) {
    // Fetch all activities for prediction calculation
    const { data: allActivities } = await supabase
      .from("activities")
      .select(
        "id, user_id, strava_id, type, name, date, distance_km, duration_seconds, pace_min_per_km, elevation_gain_m, avg_heart_rate, avg_cadence, calories, map_polyline, created_at",
      )
      .eq("user_id", user.id)
      .order("date", { ascending: false })
      .limit(200)

    if (allActivities && allActivities.length > 0) {
      const activities: Activity[] = allActivities.map((a) => ({
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

      const { predictions } = predictRaceTimes(activities)
      const matchingPrediction = predictions.find(
        (p) => Math.abs(p.distance_km - prediction_distance_km) < 0.5,
      )

      if (matchingPrediction) {
        predictionValidation = validatePrediction(
          matchingPrediction,
          act.duration_seconds,
          act.distance_km,
        )
      }
    }
  }

  // Check for existing test run on this activity
  const { data: existing } = await supabase
    .from("test_runs")
    .select("id")
    .eq("activity_id", activity_id)
    .maybeSingle()

  if (existing) {
    return NextResponse.json(
      { error: "This activity is already tagged as a test run" },
      { status: 409 },
    )
  }

  // Insert test run
  const { data: testRun, error: insertError } = await supabase
    .from("test_runs")
    .insert({
      user_id: user.id,
      activity_id,
      test_type,
      distance_km: act.distance_km,
      time_seconds: act.duration_seconds,
      avg_pace: act.pace_min_per_km,
      avg_hr: act.avg_heart_rate,
      max_hr: null,
      elevation_m: act.elevation_gain_m,
      derived_metrics: derived,
      prediction_validation: predictionValidation,
      notes,
    })
    .select()
    .single()

  if (insertError) {
    console.error("Failed to create test run:", insertError)
    return NextResponse.json({ error: "Failed to create test run" }, { status: 500 })
  }

  return NextResponse.json({ test_run: testRun }, { status: 201 })
}

/**
 * DELETE /api/test-runs
 *
 * Removes a test run tag from an activity.
 * Query params: ?activity_id=xxx
 */
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const activityId = url.searchParams.get("activity_id")

  if (!activityId) {
    return NextResponse.json({ error: "activity_id is required" }, { status: 400 })
  }

  const { error } = await supabase
    .from("test_runs")
    .delete()
    .eq("activity_id", activityId)
    .eq("user_id", user.id)

  if (error) {
    console.error("Failed to delete test run:", error)
    return NextResponse.json({ error: "Failed to remove test run tag" }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
