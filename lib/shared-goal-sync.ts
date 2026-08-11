/**
 * Writing a runner's shared-goal position.
 *
 * Working out where someone stands needs their activities, and no other member
 * of the group may read those — every activity policy in this schema is
 * select-own, and that is the point. So the number is computed on the side that
 * already holds the data: after a sync, the runner's own membership rows are
 * updated with their position and their block adherence. The group screen then
 * reads rows it is allowed to read, and the privacy boundary sits in the
 * schema rather than in a query someone might forget to write correctly.
 *
 * A member row that has never been measured keeps a null position. The group
 * screen shows that as a dash: a zero would claim the runner has made no
 * progress, which is a different statement from not knowing yet.
 */

import { createServiceClient } from "@/lib/supabase/service"
import type { Activity, PaceSource, TrainingPlan } from "@/lib/types"
import { predictGoalSeconds, sharedGoalPosition, blockAdherence } from "@/lib/shared-goal-progress"

/** Activity columns the position needs — enough for Riegel and for week sums. */
const ACTIVITY_COLUMNS = "date, distance_km, duration_seconds, elevation_gain_m"

type ProgressActivity = Pick<
  Activity,
  "date" | "distance_km" | "duration_seconds" | "elevation_gain_m"
>

/** Shapes a partial row into what predictRaceTimes reads. */
function asActivity(row: ProgressActivity): Activity {
  return {
    id: "",
    user_id: "",
    strava_id: null,
    type: "Run",
    name: "",
    date: row.date,
    distance_km: Number(row.distance_km),
    duration_seconds: Number(row.duration_seconds),
    pace_min_per_km: null,
    elevation_gain_m: row.elevation_gain_m == null ? null : Number(row.elevation_gain_m),
    avg_heart_rate: null,
    avg_cadence: null,
    calories: null,
    created_at: "",
  }
}

/**
 * The starting point, as it stood on the day the runner joined.
 *
 * Computed with the same window and weighting as today's number — only the
 * clock moves — because a baseline produced by a different calculation is not
 * comparable with the figure it is subtracted from.
 */
export function computeBaseline(
  activities: ProgressActivity[],
  goalDistanceKm: number,
  joinedAt: Date | string = new Date(),
): { baseline_seconds: number | null; baseline_source: PaceSource } {
  const asOf = new Date(joinedAt).getTime()
  const { seconds, source } = predictGoalSeconds(
    activities.map(asActivity),
    goalDistanceKm,
    Number.isFinite(asOf) ? asOf : Date.now(),
  )
  return { baseline_seconds: seconds, baseline_source: source }
}

/**
 * Recompute and store this runner's position in every group they belong to.
 *
 * Never throws: it runs at the tail of a Strava sync, and a group screen going
 * stale is not a reason to fail a sync that has already written activities.
 */
export async function refreshSharedGoalPositions(userId: string): Promise<void> {
  const service = createServiceClient()

  try {
    const { data: memberships, error: memberError } = await service
      .from("shared_goal_members")
      .select("shared_goal_id, goal_id, baseline_seconds, shared_goals(distance_km)")
      .eq("user_id", userId)

    if (memberError) throw memberError
    if (!memberships || memberships.length === 0) return

    const { data: activityRows, error: activityError } = await service
      .from("activities")
      .select(ACTIVITY_COLUMNS)
      .eq("user_id", userId)

    if (activityError) throw activityError
    const activities = (activityRows ?? []) as ProgressActivity[]
    const asActivities = activities.map(asActivity)

    // The target time and the plan live on the member's own goal rows.
    const goalIds = Array.from(new Set(memberships.map((m) => m.goal_id)))
    const { data: goalRows } = await service
      .from("goals")
      .select("id, target_time_seconds, target_distance_km")
      .eq("user_id", userId)
      .in("id", goalIds)

    const { data: planRows } = await service
      .from("ai_training_plans")
      .select("goal_id, plan, block_start_date")
      .eq("user_id", userId)
      .in("goal_id", goalIds)

    const goals = new Map((goalRows ?? []).map((g) => [g.id as string, g]))
    const plans = new Map((planRows ?? []).map((p) => [p.goal_id as string, p]))

    const now = new Date().toISOString()

    await Promise.all(
      memberships.map(async (member) => {
        const goal = goals.get(member.goal_id)
        if (!goal) return

        // The shared goal's distance is the race everyone is running. PostgREST
        // returns a many-to-one embed as an object, but hands back an array
        // when it cannot see the foreign key, so accept either rather than
        // silently measuring against the member's own distance instead.
        const embed = member.shared_goals as unknown
        const shared = (Array.isArray(embed) ? embed[0] : embed) as { distance_km: number } | null
        const distanceKm = Number(shared?.distance_km ?? goal.target_distance_km)

        const { seconds: currentSeconds } = predictGoalSeconds(asActivities, distanceKm)
        const position = sharedGoalPosition(
          member.baseline_seconds,
          currentSeconds,
          goal.target_time_seconds,
        )

        const planRow = plans.get(member.goal_id)
        const adherence = blockAdherence(
          (planRow?.plan ?? null) as TrainingPlan | null,
          activities.map((a) => ({ date: a.date, distance_km: Number(a.distance_km) })),
          planRow?.block_start_date as string | undefined,
        )

        const { error } = await service
          .from("shared_goal_members")
          .update({
            position_pct: position.pct,
            adherence_done: adherence.weeks > 0 ? adherence.doneKm : null,
            adherence_target: adherence.weeks > 0 ? adherence.targetKm : null,
            updated_at: now,
          })
          .eq("shared_goal_id", member.shared_goal_id)
          .eq("user_id", userId)

        if (error) {
          console.error(
            `[sharedGoals] Failed to update position for ${member.shared_goal_id}:`,
            error,
          )
        }
      }),
    )
  } catch (err) {
    console.error("[sharedGoals] Position refresh failed:", err)
  }
}
