"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import {
  ArrowLeft,
  Sparkles,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  MapPin,
  CalendarCheck,
  AlertCircle,
  AlertTriangle,
  Info,
  Lightbulb,
  Pencil,
  Flag,
  CheckCircle2,
} from "lucide-react"
import {
  formatDistance,
  formatDate,
  daysUntil,
  isDatePast,
  timeElapsedPercentage,
} from "@/lib/format"
import { Skeleton } from "@/components/ui/skeleton"
import type {
  Goal,
  Activity,
  GoalPreferences,
  TrainingFocus,
  AiTrainingPlan,
  TrainingWeek,
  PlanSnapshot,
  MidBlockCheckpoint,
} from "@/lib/types"
import { useI18n, type TranslationKey } from "@/lib/i18n"
import { computeTrainingTimeline, type TrainingPhaseType, type TrainingTimeline as TTimeline } from "@/lib/training-timeline"
import { checkSkipLoadSpike, classifyAthleteLevel, type SkipLoadWarning } from "@/lib/training-safety-client"
import { RUN_TYPES, INJURY_NOTE_STALE_WEEKS } from "@/lib/training-constants"
// Shared with the server so a session reads as the same distance on both sides.
// The client used to take the midpoint of a range where the server took the
// high end, so weekly totals in the app never matched the stored targetKm.
import { parseSessionDistanceKm } from "@/lib/training-sessions"
import { AppCard } from '@/components/ui/app-card'
import { AppBar } from '@/components/app-bar'
import { SharedGoalEntry } from '@/components/shared-goal-entry'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/ui/pill'

interface GoalDetailScreenProps {
  goal: Goal
  activities: Activity[]
  onBack: () => void
  onEditGoal: (goal: Goal) => void
  /** Opens the shared-goal screen for the group this goal belongs to. */
  onOpenGroup?: (groupId: string) => void
  /**
   * A plan was generated, regenerated, or had a checkpoint applied. Today's
   * goal badges are derived from plans, and it no longer re-queries them on
   * every visit, so it needs telling.
   */
  onPlanChange?: () => void
}

// ---- Collapsible Section ----
function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
  variant = "default",
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  variant?: "default" | "warning"
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  
  const baseStyles = variant === "warning"
    ? "rounded-lg bg-warning/10 ring-1 ring-warning/30"
    : "surface"
  
  const iconColor = variant === "warning" ? "text-warning" : "text-muted-foreground"
  
  return (
    <div className={baseStyles}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          {variant === "warning" && <AlertCircle size={15} className="text-warning" />}
          <span className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </span>
        </div>
        <ChevronDown 
          size={16} 
          className={`${iconColor} transition-transform ${isOpen ? "rotate-180" : ""}`} 
        />
      </button>
      {isOpen && (
        <div className="px-4 pb-4">
          {children}
        </div>
      )}
    </div>
  )
}

// ---- Preferences form ----
function PreferencesForm({
  goalId,
  initial,
  onSaved,
}: {
  goalId: string
  initial: GoalPreferences
  onSaved: (
    prefs: GoalPreferences,
    meta?: { shouldRegenerate: boolean; regenerateReason: string | null },
  ) => void
}) {
  const [sessions, setSessions] = useState(initial.sessions_per_week)
  const [focus, setFocus] = useState<TrainingFocus>(initial.focus)
  const [notes, setNotes] = useState(initial.notes ?? "")
  const [injuryNotes, setInjuryNotes] = useState(initial.injury_notes ?? "")
  const [increasePct, setIncreasePct] = useState(initial.weekly_increase_pct ?? 10)
  const [blockWeeks, setBlockWeeks] = useState(initial.block_weeks ?? 4)
  const [regenEvery, setRegenEvery] = useState(initial.regenerate_every_weeks ?? 4)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [localHistory, setLocalHistory] = useState(initial.notes_history)
  const [resolvingAt, setResolvingAt] = useState<string | null>(null)

  const injuryHistory = localHistory
    .filter((e) => e.type === "injury")
    .sort((a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime())

  async function handleResolve(addedAt: string) {
    setResolvingAt(addedAt)
    try {
      const res = await fetch(`/api/ai/training-plan/preferences`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalId, entry_added_at: addedAt }),
      })
      if (res.ok) {
        const data = await res.json()
        setLocalHistory(data.notes_history)
      }
    } finally {
      setResolvingAt(null)
    }
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch("/api/ai/training-plan/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goalId,
          sessions_per_week: sessions,
          focus,
          notes,
          injury_notes: injuryNotes || null,
          weekly_increase_pct: increasePct,
          block_weeks: blockWeeks,
          regenerate_every_weeks: regenEvery,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(body.error ?? "Failed to save — please try again.")
        return
      }
      onSaved(
        {
          goal_id: goalId,
          sessions_per_week: sessions,
          focus,
          notes: notes || null,
          injury_notes: injuryNotes || null,
          weekly_increase_pct: increasePct,
          block_weeks: blockWeeks,
          regenerate_every_weeks: regenEvery,
          notes_history: localHistory,
        },
        {
          shouldRegenerate: body.shouldRegenerate === true,
          regenerateReason: body.regenerateReason ?? null,
        },
      )
    } catch {
      setSaveError("Network error — please check your connection and try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Sessions per week */}
      <div>
        <label className="mb-2 block text-micro font-medium text-muted-foreground">
          Sessions per week
        </label>
        <div className="flex gap-2">
          {[2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => setSessions(n)}
              className={`flex h-10 flex-1 items-center justify-center rounded-md text-label font-semibold transition-colors ${
                sessions === n
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground active:bg-accent"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Focus */}
      <div>
        <label className="mb-2 block text-micro font-medium text-muted-foreground">
          What matters most to you?
        </label>
        <div className="flex flex-col gap-2">
          {(
            [
              { value: "volume", label: "Hit the km", desc: "Easy runs and a weekly target. Small weeks get fewer, longer runs rather than more short ones" },
              { value: "workouts", label: "Structured sessions", desc: "Tempo, intervals and hills where the phase calls for them — always your chosen number of sessions" },
              { value: "balanced", label: "Both", desc: "Mostly easy running, with quality sessions where they help" },
            ] as { value: TrainingFocus; label: string; desc: string }[]
          ).map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFocus(opt.value)}
              className={`flex flex-col items-start gap-0.5 rounded-md px-4 py-3 text-left transition-colors ${
                focus === opt.value
                  ? "bg-primary/10 ring-2 ring-primary"
                  : "bg-secondary active:bg-accent"
              }`}
            >
              <span className={`text-label font-semibold ${focus === opt.value ? "text-primary" : "text-foreground"}`}>
                {opt.label}
              </span>
              <span className="text-micro text-muted-foreground">{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Weekly volume increase */}
      <div>
        <label className="mb-1 block text-micro font-medium text-muted-foreground">
          Weekly volume increase
        </label>
        <p className="mb-2 text-micro text-muted-foreground/70">
          How much to increase your weekly km each build week. 10% is the standard guideline for injury prevention — your training history sets the actual ceiling, which is lower for newer runners.
        </p>
        <div className="flex gap-2">
          {[5, 8, 10].map((n) => (
            <button
              key={n}
              onClick={() => setIncreasePct(n)}
              className={`flex h-10 flex-1 items-center justify-center rounded-md text-label font-semibold transition-colors ${
                increasePct === n
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground active:bg-accent"
              }`}
            >
              {n}%
            </button>
          ))}
        </div>
      </div>

      {/* Block length */}
      <div>
        <label className="mb-1 block text-micro font-medium text-muted-foreground">
          Training block length
        </label>
        <p className="mb-2 text-micro text-muted-foreground/70">
          The last week is always a recovery week (~80% volume). Standard is 4 weeks (3 build + 1 recovery), which works well for most runners.
        </p>
        <div className="flex gap-2">
          {([2, 3, 4, 6] as const).map((n) => (
            <button
              key={n}
              onClick={() => setBlockWeeks(n)}
              className={`flex h-10 flex-1 items-center justify-center rounded-md text-label font-semibold transition-colors ${
                blockWeeks === n
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground active:bg-accent"
              }`}
            >
              {n}w
            </button>
          ))}
        </div>
      </div>

      {/* Regenerate frequency */}
      <div>
        <label className="mb-1 block text-micro font-medium text-muted-foreground">
          Regenerate plan every
        </label>
        <p className="mb-2 text-micro text-muted-foreground/70">
          How often you want to generate a new plan. You&apos;ll see a reminder when
          it&apos;s due.
        </p>
        <div className="flex gap-2">
          {([2, 4, 6, 8] as const).map((n) => (
            <button
              key={n}
              onClick={() => setRegenEvery(n)}
              className={`flex h-10 flex-1 items-center justify-center rounded-md text-label font-semibold transition-colors ${
                regenEvery === n
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground active:bg-accent"
              }`}
            >
              {n}w
            </button>
          ))}
        </div>
        {regenEvery < blockWeeks && (
          <p className="mt-2 text-micro text-warning">
            Your plan will regenerate before the mid-block checkpoint can run. Set to at least {blockWeeks}w to benefit from automatic adjustments.
          </p>
        )}
      </div>

      {/* Notes */}
      <div>
        <label className="mb-1 block text-micro font-medium text-muted-foreground">
          Coach notes (optional)
        </label>
        <p className="mb-2 text-micro text-muted-foreground/70">
          Any context for the AI coach — schedule constraints, experience level, etc.
        </p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. only available Wed + weekends, experienced ultra runner..."
          className="w-full resize-none rounded-md bg-secondary px-4 py-3 text-label text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          rows={3}
        />
      </div>

      {/* Injury notes */}
      <div>
        <label className="mb-1 block text-micro font-medium text-muted-foreground">
          Injury history (optional)
        </label>
        <p className="mb-2 text-micro text-muted-foreground/70">
          Recurring issues or injury history the coach should keep in mind for safety.
        </p>
        <textarea
          value={injuryNotes}
          onChange={(e) => setInjuryNotes(e.target.value)}
          placeholder="e.g. recurring left knee pain, previous stress fracture in right foot..."
          className="w-full resize-none rounded-md bg-secondary px-4 py-3 text-label text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          rows={2}
        />
        {injuryHistory.length > 0 && (
          <div className="mt-2 flex flex-col gap-1.5">
            {injuryHistory.map((entry) => {
              const addedDate = new Date(entry.added_at).toLocaleDateString("en-US", {
                month: "short", day: "numeric", year: "numeric",
              })
              const resolvedDate = entry.resolved_at
                ? new Date(entry.resolved_at).toLocaleDateString("en-US", {
                    month: "short", day: "numeric", year: "numeric",
                  })
                : null
              const isResolving = resolvingAt === entry.added_at
              // An unresolved note keeps tightening the comeback cap and keeps
              // reaching the coach as a current restriction. People rarely go
              // back to mark one resolved, so after a while we ask.
              const weeksOld =
                (Date.now() - new Date(entry.added_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
              const isStale = !entry.resolved_at && weeksOld >= INJURY_NOTE_STALE_WEEKS

              return (
                <div
                  key={entry.added_at}
                  className={`flex items-start justify-between gap-2 rounded-lg px-3 py-2 text-micro ${
                    entry.resolved_at
                      ? "bg-secondary/50 text-muted-foreground"
                      : "bg-amber-50 dark:bg-amber-950/30 text-foreground ring-1 ring-warning"
                  }`}
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className={entry.resolved_at ? "line-through opacity-60" : "font-medium"}>
                      {entry.content}
                    </span>
                    <span className="text-micro text-muted-foreground">
                      {resolvedDate ? `Added ${addedDate} · Resolved ${resolvedDate}` : `Added ${addedDate}`}
                      {entry.training_phase && !entry.resolved_at && ` · ${entry.training_phase} phase`}
                    </span>
                    {isStale && (
                      <span className="text-micro text-warning">
                        Added {Math.floor(weeksOld)} weeks ago and still holding your volume
                        down. Still an issue?
                      </span>
                    )}
                  </div>
                  {!entry.resolved_at && (
                    <button
                      onClick={() => handleResolve(entry.added_at)}
                      disabled={isResolving}
                      className="shrink-0 rounded-md bg-success px-2 py-1 text-micro font-medium text-success active:opacity-70 disabled:opacity-50"
                    >
                      {isResolving ? "…" : "Resolved"}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {saveError && (
        <p className="text-micro text-destructive">{saveError}</p>
      )}
      <button
        onClick={handleSave}
        disabled={saving}
        className="flex min-h-[44px] items-center justify-center rounded-md bg-primary px-4 text-label font-semibold text-primary-foreground transition-opacity active:opacity-80 disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save preferences"}
      </button>
    </div>
  )
}

// ---- Loading skeletons ----
function WeekCardSkeleton() {
  return (
    <AppCard variant="rows">
      <div className="flex w-full items-center justify-between px-4 py-3.5">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-14" />
          </div>
        </div>
        <Skeleton className="h-4 w-4 shrink-0 rounded" />
      </div>
    </AppCard>
  )
}

function PlanSkeleton({ blockWeeks, statusText }: { blockWeeks: number; statusText?: string | null }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-center text-label text-muted-foreground animate-pulse">
        {statusText ?? "Analysing your training history…"}
      </p>
      {/* Summary */}
      <div className="rounded-lg bg-primary/5 px-4 py-3.5 ring-1 ring-primary/20 flex flex-col gap-2">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
      {/* Week cards */}
      {Array.from({ length: blockWeeks }).map((_, i) => (
        <WeekCardSkeleton key={i} />
      ))}
    </div>
  )
}

// ---- Session status type ----
type SessionStatus = "planned" | "completed" | "skipped"

/** Snap a date to the Monday of its ISO week (Mon=start of week) */
function toMonday(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay() // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = day === 0 ? -6 : 1 - day // shift Sun→prev Mon, others→current Mon
  d.setDate(d.getDate() + diff)
  return d
}

/**
 * Auto-match activities to planned sessions for a given week.
 * Builds all valid (session, activity) pairs sorted by distance delta,
 * then greedily assigns the closest pair first.
 * Each activity matches at most one session.
 *
 * Matching rule: activity distance must be ≥ 80% of planned distance
 * (i.e. you must run at least 80% of the planned distance to count as
 * completed). Running further than planned always counts.
 */
function autoMatchSessions(
  sessions: { type: string; distance: string }[],
  weekActivities: { distance_km: number }[],
): boolean[] {
  const matched = new Array<boolean>(sessions.length).fill(false)
  if (weekActivities.length === 0) return matched

  // Parse each session's target distance
  const sessionKms = sessions.map((s, i) => ({ i, km: parseSessionDistanceKm(s.distance) }))
    .filter((s) => s.km > 0)

  // Build all valid (session, activity) candidate pairs
  const candidates: { si: number; ai: number; delta: number }[] = []
  for (const session of sessionKms) {
    const minRequired = session.km * 0.80 // must run at least 80% of planned
    for (let ai = 0; ai < weekActivities.length; ai++) {
      const actKm = Number(weekActivities[ai].distance_km)
      if (actKm >= minRequired) {
        // Delta = how far the activity is from planned (for ranking closeness)
        const delta = Math.abs(actKm - session.km)
        candidates.push({ si: session.i, ai, delta })
      }
    }
  }

  // Sort by delta ascending — closest matches first
  candidates.sort((a, b) => a.delta - b.delta)

  // Greedily assign closest pairs, each session and activity used at most once
  const usedActivities = new Set<number>()
  const usedSessions = new Set<number>()

  for (const { si, ai } of candidates) {
    if (usedSessions.has(si) || usedActivities.has(ai)) continue
    matched[si] = true
    usedSessions.add(si)
    usedActivities.add(ai)
  }

  return matched
}

// ---- Training week card ----
function WeekCard({
  week,
  isCurrent,
  actualKm,
  isPast,
  sessionStatuses,
  onToggleSession,
  weekStart,
  weekEnd,
}: {
  week: TrainingWeek
  isCurrent: boolean
  actualKm: number | null
  isPast: boolean
  sessionStatuses: SessionStatus[]
  onToggleSession: (weekNumber: number, sessionIndex: number) => void
  weekStart: Date
  weekEnd: Date
}) {
  const [expanded, setExpanded] = useState(isCurrent)
  const [coachNoteOpen, setCoachNoteOpen] = useState(false)

  const deltaKm = actualKm !== null ? actualKm - week.targetKm : null
  const deltaPct = actualKm !== null && week.targetKm > 0
    ? Math.round(((actualKm - week.targetKm) / week.targetKm) * 100)
    : null

  const completedCount = sessionStatuses.filter((s) => s === "completed").length
  const totalSessions = week.sessions.length

  // Format date range like "3. mar – 9. mar"
  const fmtDay = (d: Date) => {
    const day = d.getDate()
    const month = d.toLocaleDateString("nb-NO", { month: "short" }).replace(".", "")
    return `${day}. ${month}`
  }
  const lastDay = new Date(weekEnd)
  lastDay.setDate(lastDay.getDate() - 1) // weekEnd is exclusive (Monday next week)
  const dateLabel = `${fmtDay(weekStart)} – ${fmtDay(lastDay)}`

  return (
    <div
      className={`overflow-hidden rounded-lg ring-1 transition-all ${
        isCurrent ? "bg-card ring-primary/40 ring-2 shadow-sm" : "bg-card ring-border shadow-sm"
      }`}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3.5"
      >
        <div className="flex items-center gap-3">
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-micro font-bold ${
              isCurrent ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
            }`}
          >
            W{week.weekNumber}
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <p className="text-label font-semibold text-card-foreground">{week.theme}</p>
              <span className="text-micro text-muted-foreground">{dateLabel}</span>
            </div>
            <div className="flex items-center gap-2">
              <p className="text-micro text-muted-foreground">~{week.targetKm} km</p>
              {(isPast || isCurrent) && actualKm !== null && (
                <span
                  className={`text-micro font-semibold ${
                    deltaPct !== null && deltaPct >= 0
                      ? "text-primary"
                      : "text-warning"
                  }`}
                >
                  {actualKm.toFixed(1)} km ({deltaPct !== null && deltaPct >= 0 ? "+" : ""}{deltaPct}%)
                </span>
              )}
              {(isPast || isCurrent) && completedCount > 0 && (
                <span className="text-micro font-medium text-success">
                  {completedCount}/{totalSessions} done
                </span>
              )}
            </div>
          </div>
        </div>
        {expanded ? (
          <ChevronUp size={16} className="shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown size={16} className="shrink-0 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          {/* Planned vs actual bar */}
          {(isPast || isCurrent) && actualKm !== null && week.targetKm > 0 && (
            <div className="mb-3">
              <div className="flex items-center justify-between text-micro text-muted-foreground mb-1">
                <span>Planned {week.targetKm} km</span>
                <span>Actual {actualKm.toFixed(1)} km</span>
              </div>
              <div className="relative h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className={`absolute inset-y-0 left-0 rounded-full transition-all ${
                    (deltaKm ?? 0) >= 0 ? "bg-primary" : "bg-warning"
                  }`}
                  style={{ width: `${Math.min(100, (actualKm / week.targetKm) * 100)}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3">
            {week.sessions.map((session, i) => {
              const status = sessionStatuses[i] ?? "planned"
              return (
                <div key={i} className={`flex gap-3 ${status === "skipped" ? "opacity-50" : ""}`}>
                  {/* Session status toggle */}
                  {(isPast || isCurrent) && (
                    <button
                      onClick={() => onToggleSession(week.weekNumber, i)}
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                        status === "completed"
                          ? "border-success bg-success text-white"
                          : status === "skipped"
                            ? "border-muted-foreground bg-muted-foreground/20"
                            : "border-border active:bg-secondary"
                      }`}
                      aria-label={`Mark session as ${status === "planned" ? "completed" : status === "completed" ? "skipped" : "planned"}`}
                    >
                      {status === "completed" && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path d="M2 5L4 7L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                      {status === "skipped" && (
                        <span className="text-micro font-bold text-muted-foreground">S</span>
                      )}
                    </button>
                  )}
                  <div className="flex-1 flex flex-col gap-0.5">
                    <div className="flex items-baseline justify-between">
                      <span className={`text-label font-semibold ${status === "completed" ? "text-success line-through" : "text-card-foreground"}`}>
                        {session.type}
                      </span>
                      <span className="text-label measure font-bold text-primary">{session.distance}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-micro text-muted-foreground">{session.effort}</p>
                      {session.suggestedPace && (
                        <span className="shrink-0 measure text-micro text-primary/70">{session.suggestedPace}</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {week.coachNote && (
            <div className="mt-3">
              <button
                onClick={() => setCoachNoteOpen(v => !v)}
                className="flex w-full items-center gap-2 rounded-md bg-secondary px-3 py-2.5 transition-colors active:bg-accent"
              >
                <Lightbulb size={14} className="shrink-0 text-warning" />
                <span className="flex-1 text-left text-micro font-medium text-muted-foreground">Coach note</span>
                <ChevronDown size={13} className={`shrink-0 text-muted-foreground transition-transform ${coachNoteOpen ? "rotate-180" : ""}`} />
              </button>
              {coachNoteOpen && (
                <p className="mt-1.5 px-3 text-micro text-muted-foreground leading-relaxed">{week.coachNote}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---- Phase colors & i18n keys ----
const PHASE_COLORS: Record<TrainingPhaseType, { bg: string; text: string; ring: string; bar: string }> = {
  base_building:         { bg: "bg-success/10", text: "text-success", ring: "ring-success/30", bar: "bg-success" },
  endurance_development: { bg: "bg-chart-4/10",    text: "text-chart-4",    ring: "ring-chart-4/30",    bar: "bg-chart-4" },
  peak_training:         { bg: "bg-warning/10",   text: "text-warning",  ring: "ring-warning/30",   bar: "bg-warning" },
  taper:                 { bg: "bg-chart-5/10",  text: "text-chart-5", ring: "ring-chart-5/30",  bar: "bg-chart-5" },
  race_week:             { bg: "bg-destructive/10",     text: "text-destructive",      ring: "ring-destructive/30",     bar: "bg-destructive" },
}

const PHASE_LABEL_KEYS: Record<TrainingPhaseType, TranslationKey> = {
  base_building: "timeline.phase_base_building",
  endurance_development: "timeline.phase_endurance_development",
  peak_training: "timeline.phase_peak_training",
  taper: "timeline.phase_taper",
  race_week: "timeline.phase_race_week",
}

// ---- Training Timeline visual ----
function TrainingTimelineView({
  timeline,
  blockPosition,
  embedded = false,
}: {
  timeline: TTimeline
  blockPosition?: { blockNum: number; totalBlocks: number } | null
  embedded?: boolean
}) {
  const { t } = useI18n()
  const [isExpanded, setIsExpanded] = useState(false)

  const currentPhase = timeline.currentPhase
  const currentWeeksLabel = currentPhase
    ? currentPhase.totalWeeks === 1
      ? `1 ${t("timeline.week")}`
      : `${currentPhase.totalWeeks} ${t("timeline.weeks")}`
    : null
  const weekWithinPhase =
    currentPhase && timeline.currentWeek >= currentPhase.weekStart
      ? timeline.currentWeek - currentPhase.weekStart + 1
      : null

  const timelineContent = (
    <>
      {/* Header - clickable to toggle full phase list */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between px-5 py-4 text-left active:bg-secondary/50 transition-colors"
      >
        <h3 className="text-micro font-medium uppercase tracking-wider text-muted-foreground">
          {t("timeline.title")}
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-micro text-muted-foreground">
            {timeline.weeksRemaining} {t("timeline.weeksRemaining")}
          </span>
          <ChevronDown
            size={16}
            className={`text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`}
          />
        </div>
      </button>

      {/* Collapsed: show current phase + block position + AI summary */}
      {!isExpanded && currentPhase && (
        <div className="px-5 pb-4">
          <div className="flex items-center gap-3">
            <div className="h-2.5 w-2.5 rounded-full bg-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-label font-semibold text-foreground">
                  {t(PHASE_LABEL_KEYS[currentPhase.type])}
                </span>
                {weekWithinPhase !== null && (
                  <span className="text-micro font-medium text-primary">
                    {t("timeline.weekOf")} {weekWithinPhase}
                  </span>
                )}
                {blockPosition && (
                  <span className="text-micro font-medium text-primary/70">
                    · {t("timeline.block")} {blockPosition.blockNum}/{blockPosition.totalBlocks}
                  </span>
                )}
                <span className="text-micro text-muted-foreground">
                  {currentWeeksLabel}
                </span>
              </div>
              <p className="text-micro text-muted-foreground">
                {t("timeline.weekOf")} {currentPhase.weekStart}–{currentPhase.weekEnd}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Expanded: full phase list */}
      {isExpanded && (
        <div className="flex flex-col px-5 pb-4">
          {timeline.phases.map((phase, index) => {
            const isCurrent = timeline.currentPhase?.type === phase.type
            const isPast = phase.endDate < new Date()
            const isLast = index === timeline.phases.length - 1
            const weeksLabel = phase.totalWeeks === 1
              ? `1 ${t("timeline.week")}`
              : `${phase.totalWeeks} ${t("timeline.weeks")}`

            return (
              <div key={phase.type} className="flex gap-3">
                {/* Timeline indicator */}
                <div className="flex flex-col items-center">
                  <div className={`h-3 w-3 rounded-full border-2 ${
                    isCurrent 
                      ? "border-primary bg-primary" 
                      : isPast 
                        ? "border-muted-foreground/40 bg-muted-foreground/40" 
                        : "border-border bg-card"
                  }`} />
                  {!isLast && (
                    <div className={`w-0.5 flex-1 min-h-[2.5rem] ${
                      isPast ? "bg-muted-foreground/20" : "bg-border"
                    }`} />
                  )}
                </div>
                
                {/* Phase content */}
                <div className={`flex-1 pb-3 ${isPast && !isCurrent ? "opacity-50" : ""}`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-label font-semibold ${isCurrent ? "text-primary" : "text-foreground"}`}>
                      {t(PHASE_LABEL_KEYS[phase.type])}
                    </span>
                    {isCurrent && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-micro font-medium text-primary">
                        {t("timeline.currentPhase")}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-micro text-muted-foreground">
                    {isCurrent && weekWithinPhase !== null && (
                      <span className="font-medium text-primary">
                        {t("timeline.weekOf")} {weekWithinPhase} ·{" "}
                      </span>
                    )}
                    {weeksLabel} · {t("timeline.weekOf")} {phase.weekStart}–{phase.weekEnd}
                  </p>
                </div>
              </div>
            )
          })}

          {/* Race day indicator */}
          <div className="flex items-center gap-2.5 rounded-md bg-destructive/10 px-3.5 py-3 ring-1 ring-destructive/30">
            <Flag size={14} className="text-destructive shrink-0" />
            <div className="flex-1">
              <span className="text-label font-semibold text-destructive">{t("timeline.raceDay")}</span>
              <span className="ml-2 text-micro text-muted-foreground">
                {timeline.raceDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  )

  if (embedded) {
    return <div className="border-t border-border overflow-hidden">{timelineContent}</div>
  }

  return (
    <AppCard variant="rows">
      {timelineContent}
    </AppCard>
  )
}

// ---- Main screen ----
export function GoalDetailScreen({ goal, activities, onBack, onEditGoal, onPlanChange, onOpenGroup }: GoalDetailScreenProps) {
  const { t } = useI18n()
  const [prefs, setPrefs] = useState<GoalPreferences>({
    goal_id: goal.id,
    sessions_per_week: 3,
    focus: "balanced",
    notes: null,
    injury_notes: null,
    notes_history: [],
    weekly_increase_pct: 10,
    block_weeks: 4,
    regenerate_every_weeks: 4,
  })
  const [aiPlan, setAiPlan] = useState<AiTrainingPlan | null>(null)
  const [paceSource, setPaceSource] = useState<"test_run" | "prediction" | "historical" | "none" | null>(null)
  const [activeTab, setActiveTab] = useState<"plan" | "preferences">("plan")
  const [showAdjustForm, setShowAdjustForm] = useState(false)
  const [adjustNote, setAdjustNote] = useState("")
  const [showPreviousPlans, setShowPreviousPlans] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generateStatus, setGenerateStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Until the lookup answers, "no plan" is unknown rather than false. The
  // empty state it used to render carries a live Generate button, so a goal
  // that already had a plan briefly offered to build a second one — an
  // expensive, streamed model call.
  const [planResolved, setPlanResolved] = useState(false)
  const [checkpoint, setCheckpoint] = useState<MidBlockCheckpoint | null>(null)
  const [pendingCheckpoint, setPendingCheckpoint] = useState<MidBlockCheckpoint | null>(null)
  const [showCheckpointReview, setShowCheckpointReview] = useState(false)
  const [isApplyingCheckpoint, setIsApplyingCheckpoint] = useState(false)

  // Load existing plan + preferences on mount
  useEffect(() => {
    async function load() {
      const [planRes, prefsRes] = await Promise.all([
        fetch(`/api/ai/training-plan?goalId=${goal.id}`),
        fetch(`/api/ai/training-plan/preferences?goalId=${goal.id}`),
      ])
      // Load plan
      if (planRes.ok) {
        const data = await planRes.json()
        if (data.plan) {
          setAiPlan({
            goal_id: goal.id,
            plan: data.plan,
            block_start_date: data.block_start_date,
            generated_at: data.generated_at,
            previous_plans: data.previous_plans ?? [],
            mid_block_checkpoint: data.mid_block_checkpoint ?? null,
          })
          if (data.pace_source) setPaceSource(data.pace_source)
          // Surface any previously applied checkpoint
          if (data.mid_block_checkpoint?.adjustmentApplied) {
            setCheckpoint(data.mid_block_checkpoint)
          }
          // Dry-run checkpoint in the background to check if adjustment is needed
          if (data.checkpoint_due) {
            fetch("/api/ai/training-plan/checkpoint", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ goalId: goal.id, dryRun: true }),
            })
              .then((r) => (r.ok ? r.json() : null))
              .then((result) => {
                if (result?.checkpoint?.isWayOff) {
                  setPendingCheckpoint(result.checkpoint)
                }
              })
              .catch(() => {})
          }
        }
      }
      // Load preferences
      if (prefsRes.ok) {
        const p = await prefsRes.json()
        if (p.preferences) setPrefs(p.preferences)
      }
    }
    setPlanResolved(false)
    load().finally(() => setPlanResolved(true))
  }, [goal.id])

  // Manual overrides persisted to database (with localStorage fallback)
  const [manualStatuses, setManualStatuses] = useState<Record<string, SessionStatus>>({})

  useEffect(() => {
    // Load from database first, fall back to localStorage
    async function loadStatuses() {
      try {
        const res = await fetch(`/api/ai/training-plan/sessions?goalId=${goal.id}`)
        if (res.ok) {
          const data = await res.json()
          if (data.statuses && Object.keys(data.statuses).length > 0) {
            setManualStatuses(data.statuses)
            return
          }
        }
      } catch {}
      // Fallback: load from localStorage and migrate to DB
      try {
        const stored = localStorage.getItem(`session-statuses-${goal.id}`)
        if (stored) {
          const parsed = JSON.parse(stored)
          setManualStatuses(parsed)
          // Migrate localStorage data to database
          fetch("/api/ai/training-plan/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ goalId: goal.id, statuses: parsed }),
          }).then(() => {
            localStorage.removeItem(`session-statuses-${goal.id}`)
          }).catch(() => {})
        }
      } catch {}
    }
    loadStatuses()
  }, [goal.id])

  // Auto-match activities to planned sessions for each week
  const autoStatuses = useMemo(() => {
    if (!aiPlan) return {} as Record<string, SessionStatus>
    const result: Record<string, SessionStatus> = {}
    // Snap block start to Monday so weeks align with calendar weeks
    const blockMonday = toMonday(new Date(aiPlan.block_start_date))
    for (let i = 0; i < aiPlan.plan.weeks.length; i++) {
      const week = aiPlan.plan.weeks[i]
      const weekStart = new Date(blockMonday)
      weekStart.setDate(weekStart.getDate() + i * 7)
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekEnd.getDate() + 7)
      const now = new Date()
      // Only auto-match past and current weeks
      if (weekStart > now) continue

      const weekActs = activities.filter((a) => {
        const d = new Date(a.date)
        return d >= weekStart && d < weekEnd
      })
      const matched = autoMatchSessions(week.sessions, weekActs)
      matched.forEach((m, si) => {
        if (m) result[`W${week.weekNumber}-${si}`] = "completed"
      })
    }
    return result
  }, [aiPlan, activities])

  // Merge: manual overrides take priority over auto-matched
  const sessionStatuses = useMemo(() => {
    return { ...autoStatuses, ...manualStatuses }
  }, [autoStatuses, manualStatuses])

  const handleToggleSession = useCallback((weekNumber: number, sessionIndex: number) => {
    const key = `W${weekNumber}-${sessionIndex}`
    const effective = sessionStatuses[key] ?? "planned"
    const next: SessionStatus =
      effective === "planned" ? "completed"
      : effective === "completed" ? "skipped"
      : "planned"

    setManualStatuses((prev) => ({ ...prev, [key]: next }))

    // Persist to database; fall back to localStorage on any failure (network error or non-2xx)
    fetch("/api/ai/training-plan/sessions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goalId: goal.id, sessionKey: key, status: next }),
    }).then((res) => {
      if (!res.ok) throw new Error("save failed")
    }).catch(() => {})
    // Always keep localStorage in sync as a backup (Safari may clear it, but
    // it protects against DB failures and stale GET caches on reload)
    try {
      const stored = JSON.parse(localStorage.getItem(`session-statuses-${goal.id}`) ?? "{}")
      localStorage.setItem(`session-statuses-${goal.id}`, JSON.stringify({ ...stored, [key]: next }))
    } catch {}
  }, [goal.id, sessionStatuses])

  const handleApplyCheckpoint = useCallback(async () => {
    setIsApplyingCheckpoint(true)
    try {
      const res = await fetch("/api/ai/training-plan/checkpoint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalId: goal.id }),
      })
      if (!res.ok) return
      const result = await res.json()
      if (result?.checkpoint) setCheckpoint(result.checkpoint)
      if (result?.adjustmentApplied && result.updatedPlan) {
        setAiPlan((prev) =>
          prev ? { ...prev, plan: result.updatedPlan, mid_block_checkpoint: result.checkpoint } : prev,
        )
      }
      setPendingCheckpoint(null)
      setShowCheckpointReview(false)
      if (result?.adjustmentApplied) onPlanChange?.()
    } catch {
      // silently ignore
    } finally {
      setIsApplyingCheckpoint(false)
    }
  }, [goal.id, onPlanChange])

  const handleGenerate = useCallback(
    async (note?: string) => {
      // Guard: target_date in the past would produce a degenerate empty plan
      // and waste a Claude call. The server rejects it too, but we short-circuit
      // here so the UI shows a clear error instead of a spinner that dies.
      const daysUntilRace = Math.ceil(
        (new Date(goal.target_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      )
      if (daysUntilRace <= 0) {
        // Unreachable from the empty state, which no longer offers to generate
        // for a past race. Kept for the adjust-note path, and translated:
        // it used to be the only English sentence a Norwegian runner hit here.
        setError(t("plan.raceIsPast"))
        return
      }

      setIsGenerating(true)
      setGenerateStatus("Analysing your training history…")
      setError(null)
      setShowAdjustForm(false)
      setCheckpoint(null) // new block — reset checkpoint display
      setPendingCheckpoint(null)
      setShowCheckpointReview(false)

      try {
        const res = await fetch("/api/ai/training-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goalId: goal.id, adjustNote: note || null }),
        })

        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          setError(data.error ?? "Failed to generate plan")
          return
        }

        const reader = res.body?.getReader()
        if (!reader) {
          setError("Streaming not supported")
          return
        }

        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          const lines = buffer.split("\n")
          buffer = lines.pop() ?? ""

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue
            const event = JSON.parse(line.slice(6))

            if (event.status === "thinking") {
              setGenerateStatus("Coach is thinking…")
            } else if (event.status === "generating") {
              setGenerateStatus("Writing your plan…")
            } else if (event.status === "done") {
              if (event.pace_source) setPaceSource(event.pace_source)
              setAiPlan((prev) => ({
                goal_id: goal.id,
                plan: event.plan,
                block_start_date: event.block_start_date,
                generated_at: event.generated_at,
                previous_plans: prev?.plan
                  ? [
                      {
                        summary: prev.plan.summary,
                        weeks: prev.plan.weeks.map((w) => ({
                          weekNumber: w.weekNumber,
                          theme: w.theme,
                          targetKm: w.targetKm,
                          sessionCount: w.sessions.length,
                        })),
                        generated_at: prev.generated_at,
                        adjust_note: null,
                        block_start_date: prev.block_start_date,
                      },
                      ...(prev.previous_plans ?? []),
                    ].slice(0, 5)
                  : prev?.previous_plans ?? [],
              }))
              setAdjustNote("")
              onPlanChange?.()
            } else if (event.status === "error") {
              setError(event.error ?? "Failed to generate plan")
            }
          }
        }
      } catch {
        setError("Network error. Please try again.")
      } finally {
        setIsGenerating(false)
        setGenerateStatus(null)
      }
    },
    [goal.id, onPlanChange, t]
  )

  // Derived values
  const days = daysUntil(goal.target_date)
  const past = isDatePast(goal.target_date)
  const effectiveStart = goal.start_date ?? goal.created_at
  const timeProgress = past ? 100 : timeElapsedPercentage(effectiveStart, goal.target_date)
  // Which week of the plan are we currently in? (Monday-aligned)
  const currentWeekIndex = aiPlan
    ? Math.floor(
        (Date.now() - toMonday(new Date(aiPlan.block_start_date)).getTime()) / (7 * 24 * 60 * 60 * 1000)
      )
    : -1

  const generatedAgo = aiPlan
    ? Math.floor((Date.now() - new Date(aiPlan.generated_at).getTime()) / (1000 * 60 * 60 * 24))
    : null

  const isDueForRefresh = aiPlan && prefs.regenerate_every_weeks
    ? generatedAgo !== null && generatedAgo >= prefs.regenerate_every_weeks * 7
    : false

  // Training timeline phases
  const timeline = useMemo(
    () => computeTrainingTimeline(goal, aiPlan),
    [goal, aiPlan]
  )

  // Block position within training phase (for "Block X of Y" label)
  // Uses current week so the label always reflects where the user is now,
  // not when the plan was last generated.
  const blockPosition = useMemo(() => {
    if (!timeline) return null
    const phase = timeline.currentPhase
    if (!phase) return null
    const blockWeeks = prefs.block_weeks ?? 4
    const weekWithinPhase = Math.max(0, timeline.currentWeek - phase.weekStart)
    const currentBlockNum = Math.floor(weekWithinPhase / blockWeeks) + 1
    const totalBlocksInPhase = Math.ceil(phase.totalWeeks / blockWeeks)
    return { blockNum: currentBlockNum, totalBlocks: totalBlocksInPhase, phase }
  }, [timeline, prefs.block_weeks])

  // Check if the training block has ended (all weeks are in the past)
  const isBlockExpired = aiPlan
    ? currentWeekIndex >= (aiPlan.plan.weeks.length)
    : false

  const blockCompletionStats = useMemo(() => {
    if (!aiPlan || !isBlockExpired) return null
    const totalSessions = aiPlan.plan.weeks.reduce((s, w) => s + w.sessions.length, 0)
    const completedSessions = aiPlan.plan.weeks.reduce(
      (wSum, w) => wSum + w.sessions.reduce(
        (sSum, _, si) => sSum + (sessionStatuses[`W${w.weekNumber}-${si}`] === "completed" ? 1 : 0), 0
      ), 0
    )
    const totalKm = aiPlan.plan.weeks.reduce((s, w) => s + w.targetKm, 0)
    return { weeks: aiPlan.plan.weeks.length, totalKm, completedSessions, totalSessions }
  }, [aiPlan, isBlockExpired, sessionStatuses])

  // Running only — the plan prescribes running volume, so a long bike ride must
  // not read as "you already did this week's km". Mirrors the server, which
  // filters the same way for weekly summaries, ACWR and adherence.
  const runActivities = useMemo(
    () => activities.filter((a) => RUN_TYPES.has(a.type)),
    [activities],
  )

  // Pre-compute actual km per plan week for skip-load detection
  const weeklyActualKm = useMemo(() => {
    if (!aiPlan) return []
    const blockMonday = toMonday(new Date(aiPlan.block_start_date))
    return aiPlan.plan.weeks.map((_, i) => {
      const weekStart = new Date(blockMonday)
      weekStart.setDate(weekStart.getDate() + i * 7)
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekEnd.getDate() + 7)
      return runActivities
        .filter((a) => { const d = new Date(a.date); return d >= weekStart && d < weekEnd })
        .reduce((sum, a) => sum + a.distance_km, 0)
    })
  }, [aiPlan, runActivities])

  // Detect unsafe volume spike from skipped sessions
  const skipWarning: SkipLoadWarning | null = useMemo(() => {
    if (!aiPlan || currentWeekIndex < 1 || isBlockExpired) return null
    const prevWeekActual = weeklyActualKm[currentWeekIndex - 1]
    if (prevWeekActual === undefined) return null
    // Next week = the current week (it's upcoming relative to the completed week)
    const nextIdx = currentWeekIndex
    if (nextIdx >= aiPlan.plan.weeks.length) return null
    const nextPlannedKm = aiPlan.plan.weeks[nextIdx].targetKm
    const prevPlannedKm = nextIdx > 0 ? aiPlan.plan.weeks[nextIdx - 1].targetKm : undefined
    const level = classifyAthleteLevel(runActivities as Parameters<typeof classifyAthleteLevel>[0])
    return checkSkipLoadSpike(prevWeekActual, nextPlannedKm, level, prevPlannedKm)
  }, [aiPlan, currentWeekIndex, weeklyActualKm, runActivities, isBlockExpired])

  return (
    <>
      {/* Detail views reuse the app bar rather than growing a back link of
          their own, so leaving a screen is the same gesture everywhere. */}
      <AppBar
        title={goal.name}
        onBack={onBack}
        backLabel={t("tab.goals")}
        action={
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onEditGoal(goal)}
            aria-label={`${t("common.edit")}: ${goal.name}`}
          >
            <Pencil size={16} />
          </Button>
        }
      />

      <div className="flex flex-col gap-5 px-4 pb-8 screen-body">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {goal.is_active && !past && <Pill tone="action">{t("plan.activePlan")}</Pill>}
          <span className="flex items-center gap-1.5 text-micro text-muted-foreground">
            <MapPin size={13} aria-hidden />
            {formatDistance(goal.target_distance_km)}
          </span>
          <span className="flex items-center gap-1.5 text-micro text-muted-foreground">
            <CalendarCheck size={13} aria-hidden />
            {formatDate(goal.target_date)}
          </span>
          {!past && days > 0 && (
            <span className="text-micro font-semibold text-foreground">
              {days} {t("common.daysLeft")}
            </span>
          )}
        </div>

      {onOpenGroup && (
        <SharedGoalEntry goalId={goal.id} hidden={past} onOpen={onOpenGroup} />
      )}

      {/* Progress bar + Training Timeline (merged) */}
      <AppCard variant="rows">
        <div className="px-5 py-4">
          <div className="flex items-center justify-between text-micro mb-2">
            <span className="text-muted-foreground">
              {goal.start_date ? `Training from ${formatDate(goal.start_date)}` : "Training progress"}
            </span>
            <span className="font-medium text-foreground">{timeProgress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${timeProgress}%` }}
            />
          </div>
        </div>
        {timeline && !past && (
          <TrainingTimelineView
            timeline={timeline}
            blockPosition={blockPosition}
            embedded
          />
        )}
      </AppCard>

      {/* ---- AI Training Plan section ---- */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-micro font-medium uppercase tracking-wider text-muted-foreground">
            AI Training Plan
          </h2>
          {aiPlan && activeTab === "plan" && (
            <div className="flex items-center gap-1.5">
              {isDueForRefresh && (
                <span className="rounded-full bg-warning/20 px-2 py-0.5 text-micro font-semibold text-warning">
                  Due for refresh
                </span>
              )}
              <span className="text-micro text-muted-foreground">
                {generatedAgo === 0 ? "Generated today" : `Generated ${generatedAgo}d ago`}
              </span>
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div className="mb-3 flex gap-1 rounded-md bg-secondary p-1">
          <button
            onClick={() => setActiveTab("plan")}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-label font-medium transition-colors ${
              activeTab === "plan"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground"
            }`}
          >
            <Flag size={14} />
            Training Plan
          </button>
          <button
            onClick={() => setActiveTab("preferences")}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-label font-medium transition-colors ${
              activeTab === "preferences"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground"
            }`}
          >
            <Pencil size={14} />
            Preferences
          </button>
        </div>

        {/* Preferences tab */}
        {activeTab === "preferences" && (
          <AppCard>
            <PreferencesForm
              goalId={goal.id}
              initial={prefs}
              onSaved={(saved, meta) => {
                setPrefs(saved)
                setActiveTab("plan")
                if (meta?.shouldRegenerate && meta.regenerateReason === "new_active_injury") {
                  // A brand-new active injury was logged — auto-regenerate the
                  // plan so the comeback + injury caps apply immediately.
                  handleGenerate("Auto-regenerated after a new active injury was logged.")
                }
              }}
            />
          </AppCard>
        )}

        {/* Training Plan tab */}
        {activeTab === "plan" && (
        <>

        {/* Error */}
        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-md bg-destructive/10 px-4 py-3">
            <AlertCircle size={15} className="mt-0.5 shrink-0 text-destructive" />
            <p className="text-label text-destructive">{error}</p>
          </div>
        )}

        {/* No plan yet */}
        {!planResolved && !isGenerating && (
          <PlanSkeleton blockWeeks={prefs.block_weeks ?? 4} statusText="Loading your plan…" />
        )}

        {/* A block is built forward from today toward a race date, so a race
            that has already happened has nothing to build. handleGenerate
            refuses it, but the invitation was offered anyway: a full pitch and
            an enabled button whose only outcome was an error. Say why up
            front instead. */}
        {planResolved && !aiPlan && !isGenerating && past && (
          <div className="flex flex-col items-center gap-3 surface px-6 py-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-muted">
              <CalendarCheck size={24} className="text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold text-card-foreground">{t("plan.raceIsPast")}</p>
              <p className="mt-1 text-label text-muted-foreground">
                {t("plan.raceIsPastBody", {
                  name: goal.name,
                  date: formatDate(goal.target_date),
                })}
              </p>
            </div>
          </div>
        )}

        {planResolved && !aiPlan && !isGenerating && !past && (
          <div className="flex flex-col items-center gap-4 surface px-6 py-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-primary/10">
              <Sparkles size={24} className="text-primary" />
            </div>
            <div>
              <p className="font-semibold text-card-foreground">{t("plan.generate")}</p>
              <p className="mt-1 text-label text-muted-foreground">
                {t("plan.generateBody", {
                  weeks: prefs.block_weeks ?? 4,
                  name: goal.name,
                })}
              </p>
            </div>
            <button
              onClick={() => handleGenerate()}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-label font-semibold text-primary-foreground transition-opacity active:opacity-80"
            >
              <Sparkles size={16} />
              {t("plan.generateCta")}
            </button>
          </div>
        )}

        {/* Generating skeleton */}
        {isGenerating && <PlanSkeleton blockWeeks={prefs.block_weeks ?? 4} statusText={generateStatus} />}

        {/* Plan exists */}
        {aiPlan && !isGenerating && (
          <div className="flex flex-col gap-3">
            {/* Block completion summary */}
            {isBlockExpired && blockCompletionStats && (
              <div className="flex gap-2.5 rounded-lg bg-success/10 px-4 py-3.5 ring-1 ring-success/30">
                <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-success" />
                <div className="flex flex-col gap-1">
                  <p className="text-label font-medium text-foreground">Block complete</p>
                  <p className="text-micro text-muted-foreground">
                    {blockCompletionStats.weeks}w · {blockCompletionStats.totalKm} km · {blockCompletionStats.completedSessions}/{blockCompletionStats.totalSessions} sessions · Regenerate when ready
                  </p>
                </div>
              </div>
            )}

            {/* Skip-load spike warning */}
            {skipWarning && !isBlockExpired && (
              <div className={`flex gap-2.5 rounded-lg px-4 py-3.5 ring-1 ${
                skipWarning.severity === "danger"
                  ? "bg-destructive/10 ring-destructive/30"
                  : "bg-warning/10 ring-warning/30"
              }`}>
                <AlertCircle size={15} className={`mt-0.5 shrink-0 ${
                  skipWarning.severity === "danger" ? "text-destructive" : "text-warning"
                }`} />
                <div className="flex flex-col gap-1">
                  <p className="text-label font-medium text-foreground">
                    {skipWarning.severity === "danger" ? "Unsafe volume jump" : "Volume spike ahead"}
                  </p>
                  <p className="text-micro text-muted-foreground">
                    {skipWarning.actualKm === 0
                      ? `You had a rest week, but next week plans ${skipWarning.nextPlannedKm} km. Consider regenerating your plan to ease back in safely.`
                      : `Last week you ran ${skipWarning.actualKm} km. Next week\u2019s plan calls for ${skipWarning.nextPlannedKm} km (+${skipWarning.spikePct}%). A safe target would be ~${skipWarning.safeMaxKm} km. Consider adjusting your plan.`
                    }
                  </p>
                </div>
              </div>
            )}

            {/* Mid-block checkpoint banner */}
            {checkpoint?.adjustmentApplied && !isBlockExpired && (
              <div className="flex gap-2.5 rounded-lg bg-primary/10 px-4 py-3.5 ring-1 ring-primary/30">
                <Lightbulb size={15} className="mt-0.5 shrink-0 text-primary" />
                <div className="flex flex-col gap-1">
                  <p className="text-label font-medium text-foreground">Mid-block plan adjusted</p>
                  <p className="text-micro text-muted-foreground">{checkpoint.adjustmentNote}</p>
                </div>
              </div>
            )}

            {/* Weekly blocks */}
            {aiPlan.plan.weeks.map((week, i) => {
              const weekStart = toMonday(new Date(aiPlan.block_start_date))
              weekStart.setDate(weekStart.getDate() + i * 7)
              const weekEnd = new Date(weekStart)
              weekEnd.setDate(weekEnd.getDate() + 7)
              const now = new Date()

              const weekActivities = activities.filter((a) => {
                const d = new Date(a.date)
                return d >= weekStart && d < weekEnd
              })
              const actualKm = (i < currentWeekIndex || (i === currentWeekIndex))
                ? weekActivities.reduce((sum, a) => sum + a.distance_km, 0)
                : null

              return (
                <WeekCard
                  key={week.weekNumber}
                  week={week}
                  isCurrent={i === currentWeekIndex}
                  actualKm={actualKm}
                  isPast={weekEnd <= now && i !== currentWeekIndex}
                  sessionStatuses={week.sessions.map((_, si) =>
                    sessionStatuses[`W${week.weekNumber}-${si}`] ?? "planned"
                  )}
                  onToggleSession={handleToggleSession}
                  weekStart={weekStart}
                  weekEnd={weekEnd}
                />
              )
            })}

            {/* Watch out - collapsible */}
            {aiPlan.plan.watchOut && (
              <CollapsibleSection title="Watch out" defaultOpen={false} variant="warning">
                <p className="text-label text-foreground">{aiPlan.plan.watchOut}</p>
              </CollapsibleSection>
            )}

            {/* Pace source warning — only shown when pace targets are estimates */}
            {(paceSource === "historical" || paceSource === "none") && (
              <div className="flex items-start gap-2 rounded-md bg-secondary px-3 py-2.5">
                <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warning" />
                <p className="text-micro text-muted-foreground">
                  {paceSource === "none"
                    ? "Pace suggestions are rough estimates — complete a test run to get accurate, personalised targets."
                    : "Pace suggestions are based on your training history. Complete a test run for more precise targets."}
                </p>
              </div>
            )}

            {/* Adjust / Regenerate */}
            <div className="flex flex-col gap-2 pt-1">
              {(() => {
                const checkpointPending = !!pendingCheckpoint?.isWayOff && !checkpoint?.adjustmentApplied
                return (
                  <>
                    <button
                      onClick={() => {
                        if (checkpointPending) {
                          setShowCheckpointReview((v) => !v)
                          setShowAdjustForm(false)
                        } else {
                          setShowAdjustForm((v) => !v)
                          setShowCheckpointReview(false)
                        }
                      }}
                      className={
                        "flex min-h-[44px] items-center justify-center gap-2 rounded-md px-4 text-label font-medium transition-colors active:bg-accent " +
                        (checkpointPending
                          ? "bg-warning/10 text-warning ring-1 ring-warning/40"
                          : "bg-secondary text-secondary-foreground")
                      }
                    >
                      {checkpointPending && (
                        <span className="relative flex h-2 w-2 shrink-0">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-warning" />
                        </span>
                      )}
                      {showAdjustForm || showCheckpointReview
                        ? "Cancel"
                        : checkpointPending
                          ? "Review mid-block adjustment"
                          : "Adjust plan"}
                    </button>

                    {showCheckpointReview && pendingCheckpoint && (
                      <AppCard className="flex flex-col gap-3">
                        <div className="flex gap-2.5">
                          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" />
                          <div className="flex flex-col gap-1">
                            <p className="text-label font-medium text-foreground">Plan adjustment available</p>
                            <p className="text-micro text-muted-foreground">
                              {`After ${pendingCheckpoint.completedWeeks.length} completed ${pendingCheckpoint.completedWeeks.length === 1 ? "week" : "weeks"} at ${Math.round(pendingCheckpoint.overallAdherencePct)}% of planned volume, the remaining weeks can be scaled ${pendingCheckpoint.direction === "under" ? "down" : "up"} to better match your actual training.`}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={handleApplyCheckpoint}
                          disabled={isApplyingCheckpoint}
                          className="flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-primary px-4 text-label font-semibold text-primary-foreground transition-opacity active:opacity-80 disabled:opacity-40"
                        >
                          {isApplyingCheckpoint ? "Applying…" : "Apply adjustment"}
                        </button>
                      </AppCard>
                    )}
                  </>
                )
              })()}

              {showAdjustForm && (
                <AppCard className="flex flex-col gap-2">
                  <p className="text-micro text-muted-foreground">
                    Tell Claude what to change — e.g. &ldquo;fewer runs but longer&rdquo;,
                    &ldquo;no tempo work yet&rdquo;, &ldquo;I can only run at weekends&rdquo;
                  </p>
                  <textarea
                    value={adjustNote}
                    onChange={(e) => setAdjustNote(e.target.value)}
                    placeholder="What would you like to change?"
                    className="w-full resize-none rounded-md bg-secondary px-4 py-3 text-label text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    rows={3}
                  />
                  <button
                    onClick={() => handleGenerate(adjustNote)}
                    disabled={!adjustNote.trim()}
                    className="flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-primary px-4 text-label font-semibold text-primary-foreground transition-opacity active:opacity-80 disabled:opacity-40"
                  >
                    <Sparkles size={16} />
                    Regenerate with changes
                  </button>
                </AppCard>
              )}

              <button
                onClick={() => handleGenerate()}
                className="flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-secondary px-4 text-label font-medium text-muted-foreground transition-colors active:bg-accent"
              >
                <RefreshCw size={14} />
                Regenerate (fresh start)
              </button>
            </div>

            {/* Previous plans */}
            {aiPlan.previous_plans.length > 0 && (
              <div className="pt-2">
                <button
                  onClick={() => setShowPreviousPlans((v) => !v)}
                  className="flex w-full items-center justify-between rounded-md bg-secondary px-4 py-3 text-label transition-colors active:bg-accent"
                >
                  <span className="font-medium text-foreground">
                    Previous plans ({aiPlan.previous_plans.length})
                  </span>
                  {showPreviousPlans ? (
                    <ChevronUp size={16} className="text-muted-foreground" />
                  ) : (
                    <ChevronDown size={16} className="text-muted-foreground" />
                  )}
                </button>

                {showPreviousPlans && (
                  <div className="mt-2 flex flex-col gap-2">
                    {aiPlan.previous_plans.map((prev, i) => {
                      const genDate = new Date(prev.generated_at)
                      const label = genDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                      // Support both new format (prev.weeks) and legacy format (prev.plan.weeks)
                      const weeks = prev.weeks ?? prev.plan?.weeks ?? []
                      const totalKm = weeks.reduce((s, w) => s + w.targetKm, 0)
                      const totalSessions = weeks.reduce((s, w) => s + ("sessionCount" in w ? w.sessionCount : (w as { sessions: unknown[] }).sessions.length), 0)
                      const completedSessions = prev.sessionCompletions
                        ? Object.values(prev.sessionCompletions).filter((s) => s === "completed").length
                        : null
                      return (
                        <div
                          key={i}
                          className="flex flex-col gap-1.5 rounded-md bg-surface-sunken px-4 py-3"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-label font-medium text-card-foreground">{label}</span>
                            <span className="text-micro text-muted-foreground">
                              {weeks.length}w · {totalKm} km
                              {completedSessions !== null ? ` · ${completedSessions}/${totalSessions} sessions` : ""}
                              {prev.adjust_note ? " · adjusted" : ""}
                            </span>
                          </div>
                          {prev.summary && (
                            <p className="text-micro text-muted-foreground">{prev.summary}</p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        </>
        )}
      </section>
      </div>
    </>
  )
}
