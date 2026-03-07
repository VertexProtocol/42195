"use client"

import { useState } from "react"
import { Target, Activity, Sparkles, ChevronRight, Check } from "lucide-react"

interface OnboardingProps {
  stravaConnected: boolean
  onConnectStrava: () => void
  onCreateGoal: () => void
  onDismiss: () => void
}

const STEPS = [
  {
    id: "welcome",
    icon: Sparkles,
    title: "Welcome to 42195",
    description: "Your personal running training companion. Let's get you set up in a few quick steps.",
  },
  {
    id: "strava",
    icon: Activity,
    title: "Connect Strava",
    description: "Sync your runs automatically from Strava to track your progress effortlessly.",
  },
  {
    id: "goal",
    icon: Target,
    title: "Set Your First Goal",
    description: "Whether it's a marathon, a 10K, or a weekly distance target — we'll help you get there.",
  },
] as const

export function Onboarding({ stravaConnected, onConnectStrava, onCreateGoal, onDismiss }: OnboardingProps) {
  const [currentStep, setCurrentStep] = useState(0)

  const step = STEPS[currentStep]
  const Icon = step.icon
  const isLastStep = currentStep === STEPS.length - 1
  const isStravaStep = step.id === "strava"
  const isGoalStep = step.id === "goal"

  const handleNext = () => {
    if (isStravaStep && !stravaConnected) {
      onConnectStrava()
      return
    }
    if (isGoalStep) {
      onCreateGoal()
      onDismiss()
      return
    }
    if (isLastStep) {
      onDismiss()
      return
    }
    setCurrentStep((s) => s + 1)
  }

  const handleSkip = () => {
    if (isLastStep) {
      onDismiss()
    } else {
      setCurrentStep((s) => s + 1)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-sm">
        {/* Progress dots */}
        <div className="mb-8 flex items-center justify-center gap-2">
          {STEPS.map((s, i) => (
            <div
              key={s.id}
              className={`h-2 w-2 rounded-full transition-colors ${
                i === currentStep
                  ? "bg-primary"
                  : i < currentStep
                    ? "bg-primary/50"
                    : "bg-muted"
              }`}
            />
          ))}
        </div>

        {/* Step content */}
        <div className="flex flex-col items-center text-center">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
            <Icon className="h-10 w-10 text-primary" />
          </div>

          <h1 className="mb-3 text-2xl font-bold text-foreground">{step.title}</h1>
          <p className="mb-8 text-muted-foreground leading-relaxed">{step.description}</p>

          {/* Strava step - show connected state */}
          {isStravaStep && stravaConnected && (
            <div className="mb-6 flex items-center gap-2 rounded-full bg-green-500/10 px-4 py-2 text-sm text-green-600">
              <Check className="h-4 w-4" />
              <span>Strava connected</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex w-full flex-col gap-3">
            <button
              onClick={handleNext}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {isStravaStep && !stravaConnected ? (
                "Connect Strava"
              ) : isGoalStep ? (
                "Create Your First Goal"
              ) : (
                <>
                  Continue
                  <ChevronRight className="h-4 w-4" />
                </>
              )}
            </button>

            {!isLastStep && (
              <button
                onClick={handleSkip}
                className="min-h-[44px] text-sm text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
              >
                {isStravaStep ? "Skip for now" : "Skip"}
              </button>
            )}

            {isGoalStep && (
              <button
                onClick={onDismiss}
                className="min-h-[44px] text-sm text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
              >
                I'll do this later
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
