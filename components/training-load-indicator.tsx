"use client"

import { useMemo } from "react"
import { Activity, Shield, AlertTriangle } from "lucide-react"
import { computeTrainingLoadStatus } from "@/lib/safety-engine"
import type { Activity as ActivityType } from "@/lib/types"

interface TrainingLoadIndicatorProps {
  activities: ActivityType[]
}

/**
 * Displays a simple training load indicator:
 * - Optimal (green)
 * - High Load (orange)
 * - Overtraining Risk (red)
 *
 * Combines ACWR ratio and fatigue signals for the assessment.
 */
export function TrainingLoadIndicator({ activities }: TrainingLoadIndicatorProps) {
  const loadStatus = useMemo(() => computeTrainingLoadStatus(activities), [activities])

  if (activities.length < 7) return null

  const Icon =
    loadStatus.status === "optimal"
      ? Shield
      : loadStatus.status === "high_load"
        ? Activity
        : AlertTriangle

  const ringColor =
    loadStatus.status === "optimal"
      ? "ring-emerald-500/20"
      : loadStatus.status === "high_load"
        ? "ring-orange-500/20"
        : "ring-red-500/20"

  const bgColor =
    loadStatus.status === "optimal"
      ? "bg-emerald-500/10"
      : loadStatus.status === "high_load"
        ? "bg-orange-500/10"
        : "bg-red-500/10"

  return (
    <div className={`flex items-start gap-3 rounded-2xl px-4 py-3.5 ring-1 ${ringColor} ${bgColor}`}>
      <Icon size={18} className={`mt-0.5 shrink-0 ${loadStatus.color}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <p className={`text-sm font-semibold ${loadStatus.color}`}>
            {loadStatus.label}
          </p>
          {loadStatus.acwrRatio > 0 && (
            <span className="text-xs text-muted-foreground font-mono">
              ACWR {loadStatus.acwrRatio.toFixed(2)}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {loadStatus.description}
        </p>
        {loadStatus.fatigued && loadStatus.status !== "overtraining_risk" && (
          <p className="mt-1 text-xs text-orange-500/80">
            Fatigue signals detected in recent activities
          </p>
        )}
      </div>
    </div>
  )
}
