import type { SupabaseClient } from "@supabase/supabase-js"
import type { Activity } from "@/lib/types"

/**
 * The one activity list query.
 *
 * Two things were previously wrong at every call site. The server render
 * capped at 200 rows and the client paths relied on PostgREST's implicit
 * 1000-row ceiling, so a runner with a long history silently lost the tail
 * from their totals, personal records and training calendar — with nothing on
 * screen to say so. And every query pulled `map_polyline`, which is a few
 * kilobytes of encoded route per activity and is only ever read on one screen.
 *
 * So: the list columns exclude the polyline, and the fetch pages until the
 * table is exhausted. The route for a single activity is loaded by the detail
 * screen when it opens.
 */

/** List columns. Deliberately no `map_polyline` — see above. */
export const ACTIVITY_LIST_COLUMNS =
  "id, user_id, strava_id, type, name, date, distance_km, duration_seconds, " +
  "pace_min_per_km, elevation_gain_m, avg_heart_rate, avg_cadence, calories, created_at"

const PAGE_SIZE = 1000

/**
 * A runaway guard, not a product limit: 5000 activities is roughly thirteen
 * years of running every single day. If a real account ever reaches it, the
 * fetch stops rather than paging forever.
 */
const MAX_ACTIVITIES = 5000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapActivityRow(a: any): Activity {
  return {
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
    // Not selected by the list query; the detail screen loads it on open.
    map_polyline: a.map_polyline ?? null,
    created_at: a.created_at,
  }
}

/**
 * Every activity the caller can see, newest first.
 *
 * Pages explicitly because PostgREST caps a single response at its `max-rows`
 * setting and returns the truncated set without an error.
 */
export async function fetchAllActivities(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any>,
): Promise<Activity[]> {
  const out: Activity[] = []

  for (let from = 0; from < MAX_ACTIVITIES; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE, MAX_ACTIVITIES) - 1
    const { data, error } = await client
      .from("activities")
      .select(ACTIVITY_LIST_COLUMNS)
      .order("date", { ascending: false })
      .range(from, to)

    if (error) {
      // Return what we have rather than nothing: a partial history still
      // renders, and the caller's own error handling decides what to say.
      break
    }
    if (!data || data.length === 0) break

    out.push(...data.map(mapActivityRow))
    if (data.length < to - from + 1) break
  }

  return out
}
