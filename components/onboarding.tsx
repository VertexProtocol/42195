"use client"

import { Check, ChevronRight } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { Pill } from "@/components/ui/pill"

/**
 * First run.
 *
 * The old flow was a three-step carousel that hid the app behind a full-screen
 * overlay and made the user press "next" twice before doing anything. It is
 * now a single screen that states the two things worth doing and lets the
 * runner do either of them, in any order, or neither. Progress is visible: a
 * finished step is marked done instead of disappearing.
 */

interface OnboardingProps {
  stravaConnected: boolean
  onConnectStrava: () => void
  onCreateGoal: () => void
  onDismiss: () => void
}

export function Onboarding({
  stravaConnected,
  onConnectStrava,
  onCreateGoal,
  onDismiss,
}: OnboardingProps) {
  const { t } = useI18n()

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-background"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
        <p className="measure text-label font-bold tracking-[-0.03em] text-muted-foreground">
          42195
        </p>

        <h1 id="onboarding-title" className="mt-5 text-screen font-semibold text-foreground">
          {t("onboarding.welcome")}
        </h1>
        <p className="mt-2 max-w-[46ch] text-body leading-relaxed text-muted-foreground">
          {t("onboarding.step1Desc")}
        </p>

        <ol className="mt-8 flex flex-col gap-3">
          <li className="surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-body font-semibold text-card-foreground">
                  {t("onboarding.step1Title")}
                </p>
                <p className="mt-1 max-w-[42ch] text-label leading-relaxed text-muted-foreground">
                  {t("onboarding.step2Desc")}
                </p>
              </div>
              {stravaConnected && (
                <Pill tone="positive" icon={<Check size={11} />}>
                  {t("profile.stravaConnected")}
                </Pill>
              )}
            </div>
            {!stravaConnected && (
              <Button className="mt-3.5" size="sm" onClick={onConnectStrava}>
                {t("onboarding.connectStrava")}
              </Button>
            )}
          </li>

          <li className="surface p-4">
            <p className="text-body font-semibold text-card-foreground">
              {t("onboarding.step2Title")}
            </p>
            <p className="mt-1 max-w-[42ch] text-label leading-relaxed text-muted-foreground">
              {t("onboarding.step3Desc")}
            </p>
            <Button
              className="mt-3.5"
              size="sm"
              variant={stravaConnected ? "default" : "secondary"}
              onClick={() => {
                onCreateGoal()
                onDismiss()
              }}
            >
              {t("onboarding.createGoal")}
              <ChevronRight size={15} />
            </Button>
          </li>
        </ol>

        <Button variant="ghost" className="mt-6 self-center" onClick={onDismiss}>
          {t("onboarding.skip")}
        </Button>
      </div>
    </div>
  )
}
