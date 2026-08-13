/**
 * What this week should hold, derived rather than guessed.
 *
 * A weekly target used to be an empty number box. The app already knew the
 * answer — it just never offered it: the generated block carries a kilometre
 * figure for every week, the volume engine can produce one for a race with no
 * plan yet, and a runner with neither still has a history.
 *
 * Three sources, first match wins:
 *
 *   plan     an active block covers this week — use the week it prescribes
 *   target   a race with no usable block — run the volume engine for this week
 *   history  no races at all — hold the runner's own recent level
 *
 * The volume always comes from `computeWeeklyTargets`. It must: the block that
 * Plan shows and the block the AI generated are the same block, and a second
 * opinion about this week's kilometres would make one of the two screens lie.
 * `lib/training-volume.ts` records what the last set of parallel volume
 * calculations cost.
 *
 * Nothing here is written to the database. A suggestion is a pure function of
 * the goals, the plans, the activities and the week, so it is recomputed on
 * read; only a suggestion the runner accepts becomes a row. See
 * WEEKLY_GOALS_PLAN.md for why, and for what that costs.
 */

import type { Activity, Goal, WeeklyGoalMetric } from "@/lib/types"
import type { SafetyActivity } from "@/lib/training-safety-client"
import {
  classifyAthleteLevel,
  evaluateAcwrSafety,
  checkProlongedFatigue,
  computeRecentWeeklyVolumes,
} from "@/lib/training-safety"
import { assessComeback } from "@/lib/training-comeback"
import { computeVolumeBaseline, computeWeeklyTargets } from "@/lib/training-volume"
import { MAX_WEEKLY_INCREASE } from "@/lib/training-safety-client"
import { FITNESS_ANALYSIS_WEEKS, RUN_TYPES } from "@/lib/training-constants"
import { parseWeekStart, weekRange, weeksBetweenStarts } from "@/lib/week"

// ── Tunables ──────────────────────────────────────────────────────────────────

/**
 * A race this close caps the week regardless of which goal is setting the
 * pace. Ten days reaches back through the whole of the week before race week,
 * which is where a competing plan's volume does the damage.
 */
const TAPER_CLAMP_DAYS = 10

/**
 * Ceiling as a fraction of the runner's own baseline volume, by race
 * proximity — not as a fraction of the week being clamped. A fraction of the
 * target would lower every affected week by the same 35% no matter how light
 * it already was, which is a blanket cut wearing the word "ceiling".
 */
const RACE_WEEK_FRACTION = 0.4
const TAPER_WEEK_FRACTION = 0.65

/** Most sessions worth prescribing in a week that contains a race. */
const RACE_WEEK_MAX_SESSIONS = 3

/**
 * Below this many weeks with a run in them, the history source stops
 * progressing and only proposes holding level. Two weeks of data is not a
 * trend, and a suggestion carrying the app's authority must not read like one.
 */
const MIN_ACTIVE_WEEKS_FOR_PROGRESSION = 3

/** Sessions a week to propose when there is no history to count. */
const DEFAULT_SESSIONS_PER_WEEK = 3

/** Fallback weekly volume for a runner the engine knows nothing about. */
const DEFAULT_HISTORY_KM = 15

// ── Types ─────────────────────────────────────────────────────────────────────

/** The two metrics that can be derived honestly. See the note in `suggestWeeklyGoals`. */
export type SuggestableMetric = Extract<WeeklyGoalMetric, "distance_km" | "sessions">

export const SUGGESTABLE_METRICS: SuggestableMetric[] = ["distance_km", "sessions"]

export type WeeklySuggestionSource = "plan" | "target" | "history"

/**
 * One week of a generated block, stripped to what a suggestion needs.
 *
 * The stored plan is kilobytes of prose per goal. It is reduced to this on the
 * server — the same reasoning as `derivePlanBadges` — so the browser can
 * recompute suggestions against freshly synced activities without ever holding
 * the plan itself.
 */
export interface PlanWeekDigest {
  targetKm: number
  sessionCount: number
}

export interface PlanDigest {
  goalId: string
  /** `block_start_date` as stored: date-only or a full timestamp. */
  blockStartDate: string
  weeks: PlanWeekDigest[]
}

/** An `ai_training_plans` row, as far as a digest is concerned. */
export interface PlanDigestRow {
  goal_id: string
  block_start_date: string
  plan: unknown
}

/**
 * Reduce stored plans to the two numbers a suggestion needs.
 *
 * Runs where the rows are read — the page render, or the refresh that follows
 * a regeneration — so the plan prose never reaches the browser, and so the
 * client can keep recomputing suggestions against newly synced activities
 * without asking for it again.
 */
export function derivePlanDigests(rows: PlanDigestRow[]): PlanDigest[] {
  const digests: PlanDigest[] = []

  for (const row of rows) {
    const weeks = (row.plan as { weeks?: unknown } | null)?.weeks
    if (!Array.isArray(weeks)) continue

    digests.push({
      goalId: row.goal_id,
      blockStartDate: row.block_start_date,
      weeks: weeks.map((w) => {
        const week = (w ?? {}) as { targetKm?: unknown; sessions?: unknown }
        return {
          targetKm: typeof week.targetKm === "number" ? week.targetKm : 0,
          sessionCount: Array.isArray(week.sessions) ? week.sessions.length : 0,
        }
      }),
    })
  }

  return digests
}

/** The planning settings a goal carries, from `goal_preferences`. */
export interface GoalPlanningPrefs {
  sessionsPerWeek: number
  weeklyIncreasePct: number
  blockWeeks: number
  hasActiveInjury?: boolean
}

export type SuggestionReasonKey =
  | "weeklySuggestion.reason.planDistance"
  | "weeklySuggestion.reason.planSessions"
  | "weeklySuggestion.reason.targetDistance"
  | "weeklySuggestion.reason.targetSessions"
  | "weeklySuggestion.reason.historyDistance"
  | "weeklySuggestion.reason.historyDistanceThin"
  | "weeklySuggestion.reason.historySessions"
  | "weeklySuggestion.reason.historySessionsThin"

export interface WeeklySuggestion {
  metric: SuggestableMetric
  /** Rounded, ready to show and to store. */
  target: number
  source: WeeklySuggestionSource
  /** The race this came from, or null for a history-based suggestion. */
  sourceGoalId: string | null
  reasonKey: SuggestionReasonKey
  /** Interpolation values for `reasonKey`. Never pre-rendered prose. */
  reasonValues: Record<string, string | number>
  /**
   * The goal whose race proximity lowered this number, when that is not the
   * goal setting the pace. Present so the card can say why the week is easier
   * than the plan the runner is following.
   */
  clampedByGoalId?: string
  /** True when the number is a holding pattern rather than a projection. */
  lowConfidence?: boolean
}

export interface WeeklySuggestionInput {
  goals: Goal[]
  /** Digests for whichever goals have a stored block. Order does not matter. */
  plans?: PlanDigest[]
  /** Planning settings by goal id. Missing goals fall back to the DB defaults. */
  preferences?: Record<string, GoalPlanningPrefs>
  /** Full activity list; non-running types are filtered out here. */
  activities: Activity[]
  /** The Monday being suggested for, as `YYYY-MM-DD`. */
  weekStart: string
  /** Evaluation time. Passed in so the result is testable. */
  now?: Date
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * The suggestions for one week, at most one per metric.
 *
 * Only distance and sessions are suggested. Duration would be distance
 * restated through average pace — a second card carrying no second decision —
 * and nothing in the data model says whether a race is on trails, so an
 * elevation target would be invented rather than derived.
 *
 * Suggestions for metrics the runner has already set are returned too. The
 * caller decides what to do with them; the engine does not know whether it is
 * being asked to fill an empty screen or to offer a second opinion.
 */
export function suggestWeeklyGoals(input: WeeklySuggestionInput): WeeklySuggestion[] {
  const { goals, plans = [], preferences = {}, weekStart, now = new Date() } = input

  const runs = input.activities.filter((a) => RUN_TYPES.has(a.type)) as SafetyActivity[]
  const week = weekRange(weekStart)
  const planByGoal = new Map(plans.map((p) => [p.goalId, p]))

  const candidates = eligibleGoals(goals, week)
  const pacesetter = candidates.find((g) => g.goal_category === "event_training") ?? null

  const base = pacesetter
    ? fromGoal(pacesetter, planByGoal.get(pacesetter.id), preferences[pacesetter.id], runs, weekStart, now)
    : fromHistory(runs, now)

  return applyRaceProximity(base, candidates, planByGoal, weekStart, runs, now)
}

// ── Goal selection ────────────────────────────────────────────────────────────

/**
 * The goals that have any claim on this week: still live, race not yet run,
 * and started (or starting) by the end of the week.
 *
 * Ordered by `display_order`, which is the drag order on Plan → Targets. The
 * first event goal in that order sets the pace; the rest can only make the
 * week easier. Volume does not add — two 40 km plans are not an 80 km week —
 * so there is no merge here, only a choice and then a set of ceilings.
 */
function eligibleGoals(goals: Goal[], week: { start: Date; end: Date }): Goal[] {
  return goals
    .filter((g) => {
      if (!g.is_active) return false
      if (raceDate(g).getTime() < week.start.getTime()) return false
      if (g.start_date && parseWeekStart(g.start_date).getTime() >= week.end.getTime()) return false
      return true
    })
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
}

/** A goal's race day at local midnight, from a date-only or full timestamp. */
function raceDate(goal: Goal): Date {
  return parseWeekStart(goal.target_date)
}

// ── Source 1 and 2: a target goal ─────────────────────────────────────────────

function fromGoal(
  goal: Goal,
  digest: PlanDigest | undefined,
  prefs: GoalPlanningPrefs | undefined,
  runs: SafetyActivity[],
  weekStart: string,
  now: Date,
): WeeklySuggestion[] {
  const planned = digest ? planWeekFor(digest, weekStart) : null
  if (planned) {
    const fromPlan: WeeklySuggestion[] = [
      {
        metric: "distance_km",
        target: Math.round(planned.week.targetKm),
        source: "plan",
        sourceGoalId: goal.id,
        reasonKey: "weeklySuggestion.reason.planDistance",
        reasonValues: { week: planned.weekNumber, goal: goal.name },
      },
      {
        metric: "sessions",
        target: planned.week.sessionCount,
        source: "plan",
        sourceGoalId: goal.id,
        reasonKey: "weeklySuggestion.reason.planSessions",
        reasonValues: { week: planned.weekNumber, goal: goal.name },
      },
    ]
    // A generated week can legitimately prescribe nothing — a full rest week
    // in a taper. A target of zero is not a goal, so it is dropped rather than
    // shown as a bar that is already complete.
    return fromPlan.filter((s) => s.target > 0)
  }

  // No block covers this week — either none was generated or the last one has
  // run out. Ask the volume engine what a block starting now would open with:
  // that first week is exactly the question being asked.
  const sessionsPerWeek = prefs?.sessionsPerWeek ?? DEFAULT_SESSIONS_PER_WEEK
  const baseline = computeVolumeBaseline(runs, now)
  const { targets } = computeWeeklyTargets({
    avgWeeklyKm: baseline.avgWeeklyKm,
    blockWeeks: Math.max(1, prefs?.blockWeeks ?? 4),
    sessionsPerWeek,
    longestRecentRun: baseline.longestRecentRun,
    increasePct: prefs?.weeklyIncreasePct ?? 10,
    athleteLevel: classifyAthleteLevel(runs, now),
    acwr: evaluateAcwrSafety(runs, now),
    prolongedFatigue: checkProlongedFatigue(runs, now),
    comeback: assessComeback(
      runs.map((a) => ({ date: a.date, distance_km: a.distance_km })),
      prefs?.hasActiveInjury ?? false,
      now,
    ),
    priorWeeklyVolumes: computeRecentWeeklyVolumes(runs, 3, now),
  })

  const km = targets[0] ?? 0
  if (km <= 0) return fromHistory(runs, now)

  return [
    {
      metric: "distance_km",
      target: km,
      source: "target",
      sourceGoalId: goal.id,
      reasonKey: "weeklySuggestion.reason.targetDistance",
      reasonValues: { goal: goal.name },
    },
    {
      metric: "sessions",
      target: sessionsPerWeek,
      source: "target",
      sourceGoalId: goal.id,
      reasonKey: "weeklySuggestion.reason.targetSessions",
      reasonValues: { goal: goal.name },
    },
  ]
}

/** The block week covering `weekStart`, with its 1-based number, or null. */
function planWeekFor(
  digest: PlanDigest,
  weekStart: string,
): { week: PlanWeekDigest; weekNumber: number } | null {
  const index = weeksBetweenStarts(parseWeekStart(digest.blockStartDate), parseWeekStart(weekStart))
  if (index < 0 || index >= digest.weeks.length) return null
  return { week: digest.weeks[index], weekNumber: index + 1 }
}

// ── Source 3: history ─────────────────────────────────────────────────────────

/**
 * What the runner has been doing, nudged up if there is enough evidence to
 * call it a level rather than a fortnight.
 *
 * The median of the recent weeks, not the mean: one holiday or one injury week
 * should not decide what the app asks for next. Weeks without a run are
 * excluded for the same reason — they are absences, not light weeks.
 */
function fromHistory(runs: SafetyActivity[], now: Date): WeeklySuggestion[] {
  const weeks = computeRecentWeeklyVolumes(runs, FITNESS_ANALYSIS_WEEKS, now)
  const activeWeeks = weeks.filter((km) => km > 0)

  if (activeWeeks.length === 0) {
    return [
      {
        metric: "distance_km",
        target: DEFAULT_HISTORY_KM,
        source: "history",
        sourceGoalId: null,
        reasonKey: "weeklySuggestion.reason.historyDistanceThin",
        reasonValues: { weeks: 0 },
        lowConfidence: true,
      },
      {
        metric: "sessions",
        target: DEFAULT_SESSIONS_PER_WEEK,
        source: "history",
        sourceGoalId: null,
        reasonKey: "weeklySuggestion.reason.historySessionsThin",
        reasonValues: { weeks: 0 },
        lowConfidence: true,
      },
    ]
  }

  const typicalKm = median(activeWeeks)
  const thin = activeWeeks.length < MIN_ACTIVE_WEEKS_FOR_PROGRESSION
  const increase = thin ? 0 : MAX_WEEKLY_INCREASE[classifyAthleteLevel(runs, now)]
  const km = Math.max(1, Math.round(typicalKm * (1 + increase)))

  const sessions = Math.max(1, Math.round(median(sessionsPerActiveWeek(runs, now))))

  return [
    {
      metric: "distance_km",
      target: km,
      source: "history",
      sourceGoalId: null,
      reasonKey: thin
        ? "weeklySuggestion.reason.historyDistanceThin"
        : "weeklySuggestion.reason.historyDistance",
      reasonValues: { weeks: activeWeeks.length, km: Math.round(typicalKm) },
      lowConfidence: thin,
    },
    {
      metric: "sessions",
      target: sessions,
      source: "history",
      sourceGoalId: null,
      reasonKey: thin
        ? "weeklySuggestion.reason.historySessionsThin"
        : "weeklySuggestion.reason.historySessions",
      reasonValues: { weeks: activeWeeks.length, sessions },
      lowConfidence: thin,
    },
  ]
}

/** Run counts for each of the recent weeks that contained a run. */
function sessionsPerActiveWeek(runs: SafetyActivity[], now: Date): number[] {
  const weekMs = 7 * 24 * 60 * 60 * 1000
  const counts: number[] = []
  for (let w = FITNESS_ANALYSIS_WEEKS; w >= 1; w--) {
    const end = now.getTime() - (w - 1) * weekMs
    const start = end - weekMs
    const n = runs.filter((a) => {
      const t = new Date(a.date).getTime()
      return t >= start && t < end
    }).length
    if (n > 0) counts.push(n)
  }
  return counts.length > 0 ? counts : [DEFAULT_SESSIONS_PER_WEEK]
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

// ── The race-proximity clamp ──────────────────────────────────────────────────

/**
 * A race close enough to matter caps the week, whichever goal it belongs to.
 *
 * This is the whole answer to "what happens with more than one target goal".
 * Priority decides who sets the pace; proximity decides who can lower it, and
 * lowering is a `min`, never a contest. A marathon in November must not run a
 * 60 km week into a 10 km race on Saturday, no matter which of the two the
 * runner dragged to the top of the list.
 *
 * A goal whose own block already covers this week is taken at its word — the
 * generated plan has tapered it properly. Everything else gets a fraction of
 * the runner's baseline, so a week that is already easy stays as it is instead
 * of being cut a second time.
 */
function applyRaceProximity(
  suggestions: WeeklySuggestion[],
  candidates: Goal[],
  planByGoal: Map<string, PlanDigest>,
  weekStart: string,
  runs: SafetyActivity[],
  now: Date,
): WeeklySuggestion[] {
  const distance = suggestions.find((s) => s.metric === "distance_km")
  if (!distance) return suggestions

  const week = weekRange(weekStart)
  const baselineKm = computeVolumeBaseline(runs, now).avgWeeklyKm
  let ceilingKm = distance.target
  let clampedBy: string | undefined
  let raceThisWeek = false

  for (const goal of candidates) {
    // Only an event has a race day. A performance goal's target date is a
    // deadline — "10 km under 50 minutes by Friday" — and tapering a whole
    // week for one would be lowering the volume for a date the runner set as
    // an ambition rather than an appointment.
    if (goal.goal_category !== "event_training") continue

    const race = raceDate(goal)
    const racesThisWeek = race.getTime() < week.end.getTime()
    if (!racesThisWeek) {
      const daysOut = Math.ceil((race.getTime() - week.start.getTime()) / (24 * 60 * 60 * 1000))
      if (daysOut > TAPER_CLAMP_DAYS) continue
    } else {
      raceThisWeek = true
    }

    const digest = planByGoal.get(goal.id)
    const planned = digest ? planWeekFor(digest, weekStart) : null

    // With no history there is no baseline to take a fraction of, and a
    // ceiling of zero would delete the suggestion rather than ease it. A
    // runner in that position is getting the conservative default already.
    if (!planned && baselineKm <= 0) continue

    const ceiling = planned
      ? Math.round(planned.week.targetKm)
      : Math.round(baselineKm * (racesThisWeek ? RACE_WEEK_FRACTION : TAPER_WEEK_FRACTION))

    if (ceiling < ceilingKm) {
      ceilingKm = ceiling
      clampedBy = goal.id
    }
  }

  if (clampedBy === undefined && !raceThisWeek) return suggestions

  return suggestions.map((s) => {
    if (s.metric === "distance_km" && clampedBy !== undefined) {
      return { ...s, target: ceilingKm, clampedByGoalId: clampedBy }
    }
    if (s.metric === "sessions" && raceThisWeek && s.target > RACE_WEEK_MAX_SESSIONS) {
      return { ...s, target: RACE_WEEK_MAX_SESSIONS, clampedByGoalId: clampedBy ?? s.clampedByGoalId }
    }
    return s
  })
}
