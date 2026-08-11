/**
 * First run, as a checklist rather than a tour.
 *
 * The guide never stores "step 2 complete". It asks the account what is
 * already true — are there runs, is there a race, is there a week — so the
 * list is correct after a Strava sync, after a goal is deleted, and on a
 * second device that never saw the first run. The only thing worth
 * persisting is that the runner closed it (profiles.onboarding_dismissed_at).
 */

export type GetStartedStepId = "runs" | "race" | "week"

export interface GetStartedInput {
  stravaConnected: boolean
  activityCount: number
  goalCount: number
  weeklyGoalCount: number
}

export interface GetStartedStep {
  id: GetStartedStepId
  done: boolean
}

export interface GetStartedProgress {
  done: number
  total: number
  complete: boolean
}

/**
 * The three steps, in the order the app needs them: something to measure,
 * something to measure it against, and the week it is measured in.
 *
 * A run entered by hand counts the same as a Strava connection — the app
 * takes activities either way, and a runner who does not want to connect
 * Strava should not be left with a step they can never finish.
 */
export function deriveGetStartedSteps(input: GetStartedInput): GetStartedStep[] {
  return [
    { id: "runs", done: input.stravaConnected || input.activityCount > 0 },
    { id: "race", done: input.goalCount > 0 },
    { id: "week", done: input.weeklyGoalCount > 0 },
  ]
}

export function getStartedProgress(steps: GetStartedStep[]): GetStartedProgress {
  const total = steps.length
  const done = steps.reduce((n, step) => (step.done ? n + 1 : n), 0)
  return { done, total, complete: total > 0 && done === total }
}
