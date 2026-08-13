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
 *
 * Once the race has been run the row settles. The first sync after the date
 * writes the verdict — the same one the runner's own goal screen shows — and
 * stamps settled_at, and a settled row is never recomputed again. A final
 * standing that keeps moving for months is not a final standing.
 */

import { createServiceClient } from "@/lib/supabase/service"
import type { Activity, SharedGoalMetric, TrainingPlan } from "@/lib/types"
import { goalFitness, memberPosition, blockAdherence } from "@/lib/shared-goal-progress"
import { goalOutcome, isDatePast } from "@/lib/format"

/** Activity columns the position needs — enough for the index and for week sums. */
const ACTIVITY_COLUMNS = "date, distance_km, duration_seconds, elevation_gain_m"

type ProgressActivity = Pick<
  Activity,
  "date" | "distance_km" | "duration_seconds" | "elevation_gain_m"
>

/** Shapes a partial row into a full Activity for the form index. */
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
): { baseline_seconds: number | null; baseline_source: string } {
  const asOf = new Date(joinedAt).getTime()
  const index = goalFitness(
    activities.map(asActivity),
    goalDistanceKm,
    Number.isFinite(asOf) ? asOf : Date.now(),
  )
  // The reason is stored alongside the number so a starting point that was
  // refused can be told apart from one that was never attempted.
  return { baseline_seconds: index.seconds, baseline_source: index.reason }
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
      .select(
        "shared_goal_id, goal_id, baseline_seconds, settled_at, shared_goals(distance_km, metric, race_date)",
      )
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
      .select("id, target_time_seconds, target_distance_km, goal_category")
      .eq("user_id", userId)
      .in("id", goalIds)

    const { data: planRows } = await service
      .from("ai_training_plans")
      .select("goal_id, plan, block_start_date")
      .eq("user_id", userId)
      .in("goal_id", goalIds)
      .is("archived_at", null)

    const goals = new Map((goalRows ?? []).map((g) => [g.id as string, g]))
    const plans = new Map((planRows ?? []).map((p) => [p.goal_id as string, p]))

    const now = new Date().toISOString()

    await Promise.all(
      memberships.map(async (member) => {
        // Settled means finished: the race has been run and the verdict is
        // written. Recomputing it would move a number somebody has already
        // read as final.
        if (member.settled_at) return

        const goal = goals.get(member.goal_id)
        if (!goal) return

        // The shared goal's distance is the race everyone is running. PostgREST
        // returns a many-to-one embed as an object, but hands back an array
        // when it cannot see the foreign key, so accept either rather than
        // silently measuring against the member's own distance instead.
        const embed = member.shared_goals as unknown
        const shared = (Array.isArray(embed) ? embed[0] : embed) as
          | { distance_km: number; metric: SharedGoalMetric; race_date: string }
          | null
        const distanceKm = Number(shared?.distance_km ?? goal.target_distance_km)
        const metric: SharedGoalMetric = shared?.metric ?? "adherence"
        const raceRun = shared?.race_date ? isDatePast(shared.race_date) : false

        const planRow = plans.get(member.goal_id)
        const adherence = blockAdherence(
          (planRow?.plan ?? null) as TrainingPlan | null,
          activities.map((a) => ({ date: a.date, distance_km: Number(a.distance_km) })),
          planRow?.block_start_date as string | undefined,
        )

        // An adherence group needs no fitness estimate at all, so it does not
        // pay for one. The index walks every activity the runner has.
        const currentSeconds =
          metric === "progress" ? goalFitness(asActivities, distanceKm).seconds : null

        const position = memberPosition(metric, {
          baselineSeconds: member.baseline_seconds,
          currentSeconds,
          targetSeconds: goal.target_time_seconds,
          adherence,
        })

        // The verdict, in the same two words and by the same rule the
        // runner's own goal screen uses: only a performance goal has a mark
        // to be judged against, and an event goal simply ends. Saying more
        // than their own screen says about them would be the group inventing
        // a result nobody asked it for.
        const outcome = raceRun
          ? goalOutcome(
              goal.goal_category as string | null,
              asActivities,
              Number(goal.target_distance_km),
              goal.target_time_seconds,
            )
          : null

        const { error } = await service
          .from("shared_goal_members")
          .update({
            position_pct: position.pct,
            adherence_done: adherence.weeks > 0 ? adherence.doneKm : null,
            adherence_target: adherence.weeks > 0 ? adherence.targetKm : null,
            updated_at: now,
            ...(raceRun ? { outcome, settled_at: now } : {}),
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
