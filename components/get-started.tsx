"use client"

import { Check } from "lucide-react"
import { useI18n, type TranslationKey } from "@/lib/i18n"
import type { GetStartedProgress, GetStartedStep, GetStartedStepId } from "@/lib/onboarding"
import { AppCard, CardRow } from "@/components/ui/app-card"
import { BottomSheet } from "@/components/ui/bottom-sheet"
import { Button } from "@/components/ui/button"
import { ConnectWithStravaButton } from "@/components/strava-brand"

/**
 * Get started.
 *
 * First run is not a tour. A carousel over the top of the app teaches the
 * menus in the one moment the runner has no data to see in them, and it can
 * only be taken once. This is a checklist: three things worth doing, each with
 * the control that does it and the surface it belongs to named in the copy.
 * What is already done is read from the account rather than remembered, so the
 * list is right on a second device and after data is deleted.
 *
 * It arrives as a sheet over Today rather than as a section inside it. As a
 * section it was the first thing on the screen and the widest, so for a new
 * account Today was the setup list with the app underneath — and it stayed
 * that way, one step shorter at a time, for as long as any step was
 * outstanding. Asked once per session and dismissed with a tap, it stops being
 * something to scroll past on the screen the runner opens before every run.
 *
 * Closing it puts it away until the next session. Hiding it is remembered on
 * the account, and Profile brings it back.
 */

const STEP_COPY: Record<
  GetStartedStepId,
  { title: TranslationKey; body: TranslationKey }
> = {
  runs: { title: "getStarted.runsTitle", body: "getStarted.runsBody" },
  race: { title: "getStarted.raceTitle", body: "getStarted.raceBody" },
  week: { title: "getStarted.weekTitle", body: "getStarted.weekBody" },
}

interface GetStartedSheetProps {
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

export function GetStartedSheet({
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
}: GetStartedSheetProps) {
  const { t } = useI18n()

  const progressText = `${progress.done} ${t("getStarted.of")} ${progress.total} ${t(
    "getStarted.completed",
  )}`

  // Every step's control opens an editor, and an editor is a sheet too. Two
  // stacked sheets is one sheet the runner cannot see the top of, so this one
  // gets out of the way first.
  const andClose = (action: () => void) => () => {
    onClose()
    action()
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t("getStarted.title")}
      description={progressText}
      closeLabel={t("getStarted.closeForNow")}
    >
      <AppCard variant="rows">
        {steps.map((step, i) => (
          <CardRow key={step.id} className="flex items-start gap-3">
            <span
              aria-hidden
              className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${
                step.done ? "bg-success/14 text-success" : "bg-surface-sunken text-muted-foreground"
              }`}
            >
              {step.done ? (
                <Check size={12} />
              ) : (
                <span className="measure text-micro font-semibold leading-none">{i + 1}</span>
              )}
            </span>

            <div className="min-w-0 flex-1">
              <p
                className={`text-label font-semibold ${
                  step.done ? "text-muted-foreground" : "text-card-foreground"
                }`}
              >
                {/* The marker is decorative, so the state is spelled out here
                    for anyone who cannot see the tick. */}
                <span className="sr-only">
                  {step.done ? t("getStarted.stepDone") : t("getStarted.stepTodo")}:{" "}
                </span>
                {t(STEP_COPY[step.id].title)}
              </p>

              {/* A finished step collapses to its title: the list gets shorter
                  as the runner works through it, and the remaining work stays
                  the largest thing on the card. */}
              {!step.done && (
                <>
                  <p className="mt-1 max-w-[42ch] text-micro leading-relaxed text-muted-foreground">
                    {t(STEP_COPY[step.id].body)}
                  </p>

                  <div className="mt-3 flex flex-col gap-2">
                    {step.id === "runs" && (
                      <>
                        {!stravaConnected && (
                          <ConnectWithStravaButton onClick={andClose(onConnectStrava)} />
                        )}
                        <Button variant="secondary" block onClick={andClose(onAddActivity)}>
                          {t("getStarted.addRun")}
                        </Button>
                      </>
                    )}
                    {step.id === "race" && (
                      <Button className="self-start" onClick={andClose(onAddGoal)}>
                        {t("getStarted.addRace")}
                      </Button>
                    )}
                    {step.id === "week" && (
                      <Button className="self-start" onClick={andClose(onAddWeeklyGoal)}>
                        {t("getStarted.addWeek")}
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
          </CardRow>
        ))}

        {/* The last thing the checklist does is name the surface it never had
            a step for, and then get out of the way. */}
        {progress.complete && (
          <CardRow className="flex flex-col gap-2">
            <p className="text-label font-semibold text-card-foreground">
              {t("getStarted.readyTitle")}
            </p>
            <p className="max-w-[46ch] text-micro leading-relaxed text-muted-foreground">
              {t("getStarted.readyBody")}
            </p>
            <div className="mt-1">
              <Button onClick={andClose(onViewInsights)}>{t("getStarted.openInsights")}</Button>
            </div>
          </CardRow>
        )}
      </AppCard>

      {/* Hiding is a different act from closing, so it is a control of its own
          rather than the X in the corner quietly meaning "never again". */}
      <div className="mt-4 flex flex-col items-start gap-1.5">
        <Button variant="ghost" onClick={onHide}>
          {t("getStarted.hide")}
        </Button>
        <p className="text-micro text-muted-foreground">{t("getStarted.hideHint")}</p>
      </div>
    </BottomSheet>
  )
}
