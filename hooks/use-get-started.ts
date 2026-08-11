"use client"

import { useCallback, useMemo, useState } from "react"
import {
  deriveGetStartedSteps,
  getStartedProgress,
  type GetStartedInput,
  type GetStartedProgress,
  type GetStartedStep,
} from "@/lib/onboarding"

interface UseGetStartedArgs extends GetStartedInput {
  /** The account's data has landed. Nothing is decided before it has. */
  ready: boolean
  /** The runner closed the checklist on this account. */
  dismissed: boolean
}

export interface GetStartedState {
  steps: GetStartedStep[]
  progress: GetStartedProgress
  /** Whether the checklist belongs on the screen at all. */
  visible: boolean
  /** Bring it back after the runner asked for it from Profile. */
  reveal: () => void
}

/**
 * Decides whether the checklist is on the screen.
 *
 * Two rules beyond "not dismissed":
 *
 * - An account that was already set up before the checklist existed has
 *   nothing to be taught, so it never appears. The latch records whether
 *   there was work left the moment the data first landed; only then does the
 *   closing state get to show when the last step lands.
 * - Asking for it from Profile overrides both, otherwise a runner who set
 *   everything up and then went looking for the list would find nothing.
 */
export function useGetStarted({
  ready,
  dismissed,
  ...input
}: UseGetStartedArgs): GetStartedState {
  const steps = useMemo(
    () =>
      deriveGetStartedSteps({
        stravaConnected: input.stravaConnected,
        activityCount: input.activityCount,
        goalCount: input.goalCount,
        weeklyGoalCount: input.weeklyGoalCount,
      }),
    [input.stravaConnected, input.activityCount, input.goalCount, input.weeklyGoalCount],
  )

  const progress = useMemo(() => getStartedProgress(steps), [steps])

  // One-time latch, set on the first render where the data is real and never
  // written again. A render-phase update rather than an effect: the answer is
  // knowable from what this render already has, and an effect would let one
  // frame of the closing state through on an account that has nothing to be
  // taught.
  const [startedIncomplete, setStartedIncomplete] = useState<boolean | null>(null)
  if (ready && startedIncomplete === null) {
    setStartedIncomplete(!progress.complete)
  }

  const [revealed, setRevealed] = useState(false)
  const reveal = useCallback(() => setRevealed(true), [])

  const visible =
    ready && !dismissed && (revealed || !progress.complete || startedIncomplete === true)

  return { steps, progress, visible, reveal }
}
