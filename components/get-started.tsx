"use client"

import { Check } from "lucide-react"
import { useI18n, type TranslationKey } from "@/lib/i18n"
import type { GetStartedProgress, GetStartedStep, GetStartedStepId } from "@/lib/onboarding"
import { AppCard, CardRow } from "@/components/ui/app-card"
import { Section, SectionHeader, SectionAction } from "@/components/ui/section"
import { Button } from "@/components/ui/button"
import { ConnectWithStravaButton } from "@/components/strava-brand"

/**
 * Get started.
 *
 * First run is not a tour. A carousel over the top of the app teaches the
 * menus in the one moment the runner has no data to see in them, and it can
 * only be taken once. This is a checklist that sits at the top of Today,
 * inside the app rather than over it: three things worth doing, each with the
 * control that does it and the surface it belongs to named in the copy. The
 * app underneath stays usable throughout, a finished step collapses to a
 * marked line instead of vanishing, and hiding it is remembered on the
 * account — Profile brings it back.
 */

const STEP_COPY: Record<
  GetStartedStepId,
  { title: TranslationKey; body: TranslationKey }
> = {
  runs: { title: "getStarted.runsTitle", body: "getStarted.runsBody" },
  race: { title: "getStarted.raceTitle", body: "getStarted.raceBody" },
  week: { title: "getStarted.weekTitle", body: "getStarted.weekBody" },
}

interface GetStartedProps {
  steps: GetStartedStep[]
  progress: GetStartedProgress
  stravaConnected: boolean
  onConnectStrava: () => void
  onAddActivity: () => void
  onAddGoal: () => void
  onAddWeeklyGoal: () => void
  onViewInsights: () => void
  onDismiss: () => void
}

export function GetStarted({
  steps,
  progress,
  stravaConnected,
  onConnectStrava,
  onAddActivity,
  onAddGoal,
  onAddWeeklyGoal,
  onViewInsights,
  onDismiss,
}: GetStartedProps) {
  const { t } = useI18n()

  const progressText = `${progress.done} ${t("getStarted.of")} ${progress.total} ${t(
    "getStarted.completed",
  )}`

  return (
    <Section>
      <SectionHeader
        title={t("getStarted.title")}
        hint={progressText}
        action={<SectionAction onClick={onDismiss}>{t("getStarted.hide")}</SectionAction>}
      />

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
                          <ConnectWithStravaButton onClick={onConnectStrava} />
                        )}
                        <Button variant="secondary" block onClick={onAddActivity}>
                          {t("getStarted.addRun")}
                        </Button>
                      </>
                    )}
                    {step.id === "race" && (
                      <Button className="self-start" onClick={onAddGoal}>
                        {t("getStarted.addRace")}
                      </Button>
                    )}
                    {step.id === "week" && (
                      <Button className="self-start" onClick={onAddWeeklyGoal}>
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
            <div className="mt-1 flex flex-wrap gap-2">
              <Button onClick={onViewInsights}>{t("getStarted.openInsights")}</Button>
              <Button variant="ghost" onClick={onDismiss}>
                {t("getStarted.hide")}
              </Button>
            </div>
          </CardRow>
        )}
      </AppCard>

      {!progress.complete && (
        <p className="text-micro text-muted-foreground">{t("getStarted.hideHint")}</p>
      )}
    </Section>
  )
}
