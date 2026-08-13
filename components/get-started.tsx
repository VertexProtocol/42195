"use client"

import { useState } from "react"
import { useI18n, type TranslationKey } from "@/lib/i18n"
import type { GetStartedProgress, GetStartedStep, GetStartedStepId } from "@/lib/onboarding"
import { PromptDialog } from "@/components/ui/prompt-dialog"
import { Button } from "@/components/ui/button"
import { ConnectWithStravaButton } from "@/components/strava-brand"

/**
 * Get started.
 *
 * First run is not a tour. A carousel over the top of the app teaches the
 * menus in the one moment the runner has no data to see in them, and it can
 * only be taken once. What is already done is read from the account rather
 * than remembered, so the list is right on a second device and after data is
 * deleted.
 *
 * It is asked one thing at a time. As a checklist it was three tasks, three
 * paragraphs and four controls in a single surface — everything the app wanted
 * from a new account, all at once, on the screen they had come to look at. As
 * a sequence of small prompts each one is a single question with the single
 * control that answers it, and the app behind stays visible through the scrim.
 *
 * Only the outstanding steps are walked through: a runner who already has
 * Strava connected should not have to press Next past a tick to reach the
 * thing they have not done. Closing puts it away until the next session.
 * Hiding it is remembered on the account, and Profile brings it back.
 */

const STEP_COPY: Record<
  GetStartedStepId,
  { title: TranslationKey; body: TranslationKey }
> = {
  runs: { title: "getStarted.runsTitle", body: "getStarted.runsBody" },
  race: { title: "getStarted.raceTitle", body: "getStarted.raceBody" },
  week: { title: "getStarted.weekTitle", body: "getStarted.weekBody" },
}

interface GetStartedDialogProps {
  open: boolean
  steps: GetStartedStep[]
  progress: GetStartedProgress
  stravaConnected: boolean
  onConnectStrava: () => void
  onAddActivity: () => void
  onAddGoal: () => void
  onAddWeeklyGoal: () => void
  onViewInsights: () => void
  /** Put it away for now. It returns next session while there is work left. */
  onClose: () => void
  /** Stop offering it. Remembered on the account; Profile brings it back. */
  onHide: () => void
}

export function GetStartedDialog({
  open,
  steps,
  progress,
  stravaConnected,
  onConnectStrava,
  onAddActivity,
  onAddGoal,
  onAddWeeklyGoal,
  onViewInsights,
  onClose,
  onHide,
}: GetStartedDialogProps) {
  const { t } = useI18n()

  const outstanding = steps.filter((step) => !step.done)
  // A runner who finished everything and then asked for the list from Profile
  // still gets an answer: the one page the checklist always ended on.
  const pages: (GetStartedStep | null)[] = outstanding.length > 0 ? outstanding : [null]

  const [rawIndex, setRawIndex] = useState(0)
  // Clamped rather than stored clamped: finishing a step shortens the list
  // under us, and an index past the end would render nothing at all.
  const index = Math.min(rawIndex, pages.length - 1)
  const page = pages[index]

  const isLast = index === pages.length - 1

  // Every step's control opens an editor, and an editor is a sheet. Two
  // stacked modals is one modal the runner cannot see the top of, so this one
  // gets out of the way first.
  const andClose = (action: () => void) => () => {
    onClose()
    action()
  }

  const title = page ? t(STEP_COPY[page.id].title) : t("getStarted.readyTitle")
  const body = page ? t(STEP_COPY[page.id].body) : t("getStarted.readyBody")

  return (
    <PromptDialog
      open={open}
      onClose={onClose}
      title={title}
      description={body}
      closeLabel={t("getStarted.closeForNow")}
      footer={
        <div className="flex flex-col gap-3">
          {/* Position, not navigation — the same reading as the goal rail on
              Today. Hidden from screen readers, which get the count in words
              on the button beside it. */}
          {pages.length > 1 && (
            <div className="flex justify-center gap-1.5" aria-hidden>
              {pages.map((_, i) => (
                <span
                  key={i}
                  className={`size-1.5 rounded-full ${i === index ? "bg-primary" : "bg-border"}`}
                  style={{ transition: "background-color var(--dur-state) var(--ease-out)" }}
                />
              ))}
            </div>
          )}

          {/* Both full-height controls: a dialog's own navigation is not a
              control inside a row with a hit area of its own, so neither drops
              under the 44px floor. The step count is left to the dots rather
              than printed on the button, which is what keeps the two of them
              side by side on a 320px screen. */}
          <div className="flex items-center justify-between gap-2">
            {index > 0 ? (
              <Button variant="ghost" onClick={() => setRawIndex(index - 1)}>
                {t("common.back")}
              </Button>
            ) : (
              <Button variant="ghost" onClick={onHide}>
                {t("getStarted.hide")}
              </Button>
            )}

            <Button onClick={isLast ? onClose : () => setRawIndex(index + 1)}>
              {isLast ? t("getStarted.done") : t("getStarted.next")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-2">
        {page?.id === "runs" && (
          <>
            {!stravaConnected && <ConnectWithStravaButton onClick={andClose(onConnectStrava)} />}
            <Button variant="secondary" block onClick={andClose(onAddActivity)}>
              {t("getStarted.addRun")}
            </Button>
          </>
        )}
        {page?.id === "race" && (
          <Button block onClick={andClose(onAddGoal)}>
            {t("getStarted.addRace")}
          </Button>
        )}
        {page?.id === "week" && (
          <Button block onClick={andClose(onAddWeeklyGoal)}>
            {t("getStarted.addWeek")}
          </Button>
        )}
        {page === null && (
          <Button block onClick={andClose(onViewInsights)}>
            {t("getStarted.openInsights")}
          </Button>
        )}

        {/* Said once, on the page that offers to hide it. */}
        {index === 0 && progress.done > 0 && outstanding.length > 0 && (
          <p className="pt-1 text-micro text-muted-foreground">
            {t("getStarted.alreadyDone", { done: progress.done, total: progress.total })}
          </p>
        )}
      </div>
    </PromptDialog>
  )
}
