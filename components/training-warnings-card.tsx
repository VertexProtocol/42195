"use client"

import { useState } from "react"
import { AlertTriangle, Heart, TrendingDown, X, Zap } from "lucide-react"
import type { Warning, WarningSeverity, WarningType } from "@/lib/training-warnings"
import { AppCard } from "@/components/ui/app-card"

interface TrainingWarningsCardProps {
  warnings: Warning[]
  onDismiss?: (type: WarningType) => void | Promise<void>
}

const ICON_BY_TYPE: Record<WarningType, typeof AlertTriangle> = {
  elevated_acwr: Zap,
  prolonged_fatigue: AlertTriangle,
  hr_drift: Heart,
  pace_drift: TrendingDown,
}

const SEVERITY_CLASSES: Record<
  WarningSeverity,
  { ring: string; iconBg: string; iconText: string; chip: string }
> = {
  info: {
    ring: "ring-primary/20",
    iconBg: "bg-primary/10",
    iconText: "text-primary",
    chip: "bg-primary/10 text-primary",
  },
  warn: {
    ring: "ring-amber-500/30",
    iconBg: "bg-amber-500/10",
    iconText: "text-amber-600 dark:text-amber-400",
    chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  critical: {
    ring: "ring-destructive/30",
    iconBg: "bg-destructive/10",
    iconText: "text-destructive",
    chip: "bg-destructive/10 text-destructive",
  },
}

export function TrainingWarningsCard({ warnings, onDismiss }: TrainingWarningsCardProps) {
  const [dismissing, setDismissing] = useState<Set<WarningType>>(new Set())
  const [hidden, setHidden] = useState<Set<WarningType>>(new Set())

  const visible = warnings.filter((w) => !hidden.has(w.type))
  if (visible.length === 0) return null

  const handleDismiss = async (type: WarningType) => {
    if (dismissing.has(type)) return
    setDismissing((prev) => new Set(prev).add(type))
    try {
      await onDismiss?.(type)
      setHidden((prev) => new Set(prev).add(type))
    } finally {
      setDismissing((prev) => {
        const next = new Set(prev)
        next.delete(type)
        return next
      })
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {visible.map((w) => {
        const Icon = ICON_BY_TYPE[w.type]
        const styles = SEVERITY_CLASSES[w.severity]
        const isDismissing = dismissing.has(w.type)
        return (
          <AppCard
            key={w.type}
            className={`!ring-2 ${styles.ring}`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${styles.iconBg}`}
              >
                <Icon size={16} className={styles.iconText} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold text-card-foreground truncate">
                    {w.title}
                  </h4>
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${styles.chip}`}
                  >
                    {w.severity}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {w.message}
                </p>
              </div>
              {onDismiss && (
                <button
                  onClick={() => handleDismiss(w.type)}
                  disabled={isDismissing}
                  aria-label="Dismiss warning"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:opacity-50 transition-colors"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </AppCard>
        )
      })}
    </div>
  )
}
