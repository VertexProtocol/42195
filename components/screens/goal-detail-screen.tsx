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
  TrendingUp,
  Footprints,
  Clock,
  AlertCircle,
  Lightbulb,
  Pencil,
} from "lucide-react"
import {
  formatDistance,
  formatDate,
  daysUntil,
  isDatePast,
  timeElapsedPercentage,
  computeDistanceInRange,
  formatDuration,
  bestRelevantRun,
  longestRun,
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
} from "@/lib/types"

interface GoalDetailScreenProps {
  goal: Goal
  activities: Activity[]
  onBack: () => void
  onEditGoal: (goal: Goal) => void
}

// ---- Preferences form ----
function PreferencesForm({
  goalId,
  initial,
  onSaved,
}: {
  goalId: string
  initial: GoalPreferences
  onSaved: (prefs: GoalPreferences) => void
}) {
  const [sessions, setSessions] = useState(initial.sessions_per_week)
  const [focus, setFocus] = useState<TrainingFocus>(initial.focus)
  const [notes, setNotes] = useState(initial.notes ?? "")
  const [increasePct, setIncreasePct] = useState(initial.weekly_increase_pct ?? 10)
  const [blockWeeks, setBlockWeeks] = useState(initial.block_weeks ?? 4)
  const [regenEvery, setRegenEvery] = useState(initial.regenerate_every_weeks ?? 4)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch("/api/ai/training-plan", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goalId,
          sessions_per_week: sessions,
          focus,
          notes,
          weekly_increase_pct: increasePct,
          block_weeks: blockWeeks,
          regenerate_every_weeks: regenEvery,
        }),
      })
      if (!res.ok) {
        console.error("Failed to save preferences:", res.status)
        return
      }
      onSaved({
        goal_id: goalId,
        sessions_per_week: sessions,
        focus,
        notes: notes || null,
        weekly_increase_pct: increasePct,
        block_weeks: blockWeeks,
        regenerate_every_weeks: regenEvery,
      })
    } catch (err) {
      console.error("Failed to save preferences:", err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Sessions per week */}
      <div>
        <label className="mb-2 block text-xs font-medium text-muted-foreground">
          Sessions per week
        </label>
        <div className="flex gap-2">
          {[2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => setSessions(n)}
              className={`flex h-10 flex-1 items-center justify-center rounded-xl text-sm font-semibold transition-colors ${
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
        <label className="mb-2 block text-xs font-medium text-muted-foreground">
          What matters most to you?
        </label>
        <div className="flex flex-col gap-2">
          {(
            [
              { value: "volume", label: "Hit the km", desc: "Give me weekly targets, I'll fit in runs when I can" },
              { value: "workouts", label: "Structured sessions", desc: "Long run, tempo, easy — tell me what type of run" },
              { value: "balanced", label: "Both", desc: "Sessions with types and a km target" },
            ] as { value: TrainingFocus; label: string; desc: string }[]
          ).map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFocus(opt.value)}
              className={`flex flex-col items-start gap-0.5 rounded-xl px-4 py-3 text-left transition-colors ${
                focus === opt.value
                  ? "bg-primary/10 ring-2 ring-primary"
                  : "bg-secondary active:bg-accent"
              }`}
            >
              <span className={`text-sm font-semibold ${focus === opt.value ? "text-primary" : "text-foreground"}`}>
                {opt.label}
              </span>
              <span className="text-xs text-muted-foreground">{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Weekly volume increase */}
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Weekly volume increase
        </label>
        <p className="mb-2 text-xs text-muted-foreground/70">
          How much to increase your weekly km each build week. 10% is the standard guideline for injury prevention.
        </p>
        <div className="flex gap-2">
          {[5, 8, 10, 15, 20].map((n) => (
            <button
              key={n}
              onClick={() => setIncreasePct(n)}
              className={`flex h-10 flex-1 items-center justify-center rounded-xl text-sm font-semibold transition-colors ${
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
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Training block length
        </label>
        <p className="mb-2 text-xs text-muted-foreground/70">
          The last week is always a recovery week (~80% volume). Standard is 4 weeks (3 build + 1 recovery), which works well for most runners.
        </p>
        <div className="flex gap-2">
          {([2, 3, 4, 6] as const).map((n) => (
            <button
              key={n}
              onClick={() => setBlockWeeks(n)}
              className={`flex h-10 flex-1 items-center justify-center rounded-xl text-sm font-semibold transition-colors ${
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
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Regenerate plan every
        </label>
        <p className="mb-2 text-xs text-muted-foreground/70">
          How often you want to generate a new plan. You'll see a reminder when it's due.
        </p>
        <div className="flex gap-2">
          {([2, 4, 6, 8] as const).map((n) => (
            <button
              key={n}
              onClick={() => setRegenEvery(n)}
              className={`flex h-10 flex-1 items-center justify-center rounded-xl text-sm font-semibold transition-colors ${
                regenEvery === n
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground active:bg-accent"
              }`}
            >
              {n}w
            </button>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Coach notes (optional)
        </label>
        <p className="mb-2 text-xs text-muted-foreground/70">
          Any context for the AI coach — injuries, schedule constraints, experience level, etc.
        </p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. only available Wed + weekends, recovering from a knee niggle, experienced ultra runner..."
          className="w-full resize-none rounded-xl bg-secondary px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          rows={3}
        />
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="flex min-h-[44px] items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity active:opacity-80 disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save preferences"}
      </button>
    </div>
  )
}

// ---- Loading skeletons ----
function WeekCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-border shadow-sm">
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
    </div>
  )
}

function PlanSkeleton({ blockWeeks, statusText }: { blockWeeks: number; statusText?: string | null }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-center text-sm text-muted-foreground animate-pulse">
        {statusText ?? "Analysing your training history…"}
      </p>
      {/* Summary */}
      <div className="rounded-2xl bg-primary/5 px-4 py-3.5 ring-1 ring-primary/20 flex flex-col gap-2">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
      {/* Week cards */}
      {Array.from({ length: blockWeeks }).map((_, i) => (
        <WeekCardSkeleton key={i} />
      ))}
      {/* Key principles */}
      <div className="rounded-2xl bg-card px-4 py-4 shadow-sm ring-1 ring-border">
        <Skeleton className="mb-2.5 h-3 w-24" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-5/6" />
          <Skeleton className="h-3.5 w-4/5" />
          <Skeleton className="h-3.5 w-full" />
        </div>
      </div>
    </div>
  )
}

// ---- Session status type ----
type SessionStatus = "planned" | "completed" | "skipped"

/** Parse a distance string like "20 km" or "8–10 km" into km (uses midpoint for ranges) */
function parseSessionKm(distance: string): number | null {
  // Handle ranges like "8–10 km" or "8-10km"
  const rangeMatch = distance.match(/([\d.]+)\s*[–\-]\s*([\d.]+)\s*km/i)
  if (rangeMatch) return (parseFloat(rangeMatch[1]) + parseFloat(rangeMatch[2])) / 2
  const singleMatch = distance.match(/([\d.]+)\s*km/i)
  if (singleMatch) return parseFloat(singleMatch[1])
  return null
}

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
 * Matching rule: activity distance must be ≥ 95% of planned distance
 * (i.e. you must run at least the planned distance, with 5% grace for
 * GPS drift). Running further than planned always counts.
 */
function autoMatchSessions(
  sessions: { type: string; distance: string }[],
  weekActivities: { distance_km: number }[],
): boolean[] {
  const matched = new Array<boolean>(sessions.length).fill(false)
  if (weekActivities.length === 0) return matched

  // Parse each session's target distance
  const sessionKms = sessions.map((s, i) => ({ i, km: parseSessionKm(s.distance) }))
    .filter((s) => s.km !== null && s.km > 0) as { i: number; km: number }[]

  // Build all valid (session, activity) candidate pairs
  const candidates: { si: number; ai: number; delta: number }[] = []
  for (const session of sessionKms) {
    const minRequired = session.km * 0.95 // must run at least 95% of planned
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
      className={`overflow-hidden rounded-2xl ring-1 transition-all ${
        isCurrent ? "bg-card ring-primary/40 ring-2 shadow-sm" : "bg-card ring-border shadow-sm"
      }`}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3.5"
      >
        <div className="flex items-center gap-3">
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
              isCurrent ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
            }`}
          >
            W{week.weekNumber}
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-card-foreground">{week.theme}</p>
              <span className="text-[11px] text-muted-foreground">{dateLabel}</span>
            </div>
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground">~{week.targetKm} km</p>
              {(isPast || isCurrent) && actualKm !== null && (
                <span
                  className={`text-xs font-semibold ${
                    deltaPct !== null && deltaPct >= 0
                      ? "text-primary"
                      : "text-warning"
                  }`}
                >
                  {actualKm.toFixed(1)} km ({deltaPct !== null && deltaPct >= 0 ? "+" : ""}{deltaPct}%)
                </span>
              )}
              {(isPast || isCurrent) && completedCount > 0 && (
                <span className="text-[10px] font-medium text-success">
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
              <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
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
                        <span className="text-[8px] font-bold text-muted-foreground">S</span>
                      )}
                    </button>
                  )}
                  <div className="flex-1 flex flex-col gap-0.5">
                    <div className="flex items-baseline justify-between">
                      <span className={`text-sm font-semibold ${status === "completed" ? "text-success line-through" : "text-card-foreground"}`}>
                        {session.type}
                      </span>
                      <span className="text-sm font-mono font-bold text-primary">{session.distance}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{session.effort}</p>
                    <p className="text-xs text-muted-foreground/70 italic">{session.purpose}</p>
                  </div>
                </div>
              )
            })}
          </div>

          {week.coachNote && (
            <div className="mt-3 flex gap-2 rounded-xl bg-secondary px-3 py-2.5">
              <Lightbulb size={14} className="mt-0.5 shrink-0 text-warning" />
              <p className="text-xs text-muted-foreground">{week.coachNote}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---- Main screen ----
export function GoalDetailScreen({ goal, activities, onBack, onEditGoal }: GoalDetailScreenProps) {
  const [prefs, setPrefs] = useState<GoalPreferences>({
    goal_id: goal.id,
    sessions_per_week: 3,
    focus: "balanced",
    notes: null,
    weekly_increase_pct: 10,
    block_weeks: 4,
    regenerate_every_weeks: 4,
  })
  const [aiPlan, setAiPlan] = useState<AiTrainingPlan | null>(null)
  const [showPrefsForm, setShowPrefsForm] = useState(false)
  const [showAdjustForm, setShowAdjustForm] = useState(false)
  const [adjustNote, setAdjustNote] = useState("")
  const [showPreviousPlans, setShowPreviousPlans] = useState(false)
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generateStatus, setGenerateStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
          })
        }
      }
      // Load preferences
      if (prefsRes.ok) {
        const p = await prefsRes.json()
        if (p.preferences) setPrefs(p.preferences)
      }
      setPrefsLoaded(true)
    }
    load()
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
    setManualStatuses((prev) => {
      const key = `W${weekNumber}-${sessionIndex}`
      const effective = sessionStatuses[key] ?? "planned"
      const next: SessionStatus =
        effective === "planned" ? "completed"
        : effective === "completed" ? "skipped"
        : "planned"
      const updated = { ...prev, [key]: next }
      // Persist to database
      fetch("/api/ai/training-plan/sessions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalId: goal.id, sessionKey: key, status: next }),
      }).catch(() => {
        // Fallback to localStorage if DB save fails
        try { localStorage.setItem(`session-statuses-${goal.id}`, JSON.stringify(updated)) } catch {}
      })
      return updated
    })
  }, [goal.id, sessionStatuses])

  const handleGenerate = useCallback(
    async (note?: string) => {
      setIsGenerating(true)
      setGenerateStatus("Analysing your training history…")
      setError(null)
      setShowAdjustForm(false)

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
              setAiPlan((prev) => ({
                goal_id: goal.id,
                plan: event.plan,
                block_start_date: event.block_start_date,
                generated_at: event.generated_at,
                previous_plans: prev?.plan
                  ? [
                      { plan: prev.plan, generated_at: prev.generated_at, adjust_note: null, block_start_date: prev.block_start_date },
                      ...(prev.previous_plans ?? []),
                    ].slice(0, 5)
                  : prev?.previous_plans ?? [],
              }))
              setAdjustNote("")
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
    [goal.id]
  )

  // Derived values
  const days = daysUntil(goal.target_date)
  const past = isDatePast(goal.target_date)
  const effectiveStart = goal.start_date ?? goal.created_at
  const timeProgress = past ? 100 : timeElapsedPercentage(effectiveStart, goal.target_date)
  const logged = computeDistanceInRange(activities, goal.start_date, goal.target_date, goal.created_at)
  const best = bestRelevantRun(activities, goal.target_distance_km)
  const longest = longestRun(activities, goal.start_date, goal.created_at)

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

  // Check if the training block has ended (all weeks are in the past)
  const isBlockExpired = aiPlan
    ? currentWeekIndex >= (aiPlan.plan.weeks.length)
    : false

  return (
    <div className="flex flex-col gap-6 px-5 pb-8 pt-4">
      {/* Back */}
      <button
        onClick={onBack}
        className="flex min-h-[44px] min-w-[44px] items-center gap-1.5 self-start text-sm font-medium text-primary active:opacity-70 transition-opacity"
      >
        <ArrowLeft size={20} />
        <span>Plan</span>
      </button>

      {/* Goal header */}
      <header>
        <div className="flex items-start justify-between">
          <div className="min-w-0 pr-3">
            {goal.is_active && !past && (
              <div className="mb-1 flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-primary" />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-primary">
                  Active plan
                </span>
              </div>
            )}
            <h1 className="text-2xl font-bold text-foreground leading-tight">{goal.name}</h1>
          </div>
          <button
            onClick={() => onEditGoal(goal)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground active:bg-accent transition-colors"
            aria-label={`Edit ${goal.name}`}
          >
            <Pencil size={14} />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin size={13} />
            <span>{formatDistance(goal.target_distance_km)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarCheck size={13} />
            <span>{formatDate(goal.target_date)}</span>
          </div>
          {!past && days > 0 && (
            <div className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-foreground">
              {days} days to go
            </div>
          )}
        </div>
      </header>

      {/* Progress bar */}
      <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border px-5 py-4">
        <div className="flex items-center justify-between text-xs mb-2">
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

        {/* Stats grid */}
        <div className="mt-4 grid grid-cols-3 divide-x divide-border border-t border-border -mx-5 px-0">
          <div className="flex flex-col items-center gap-1 px-3 py-3">
            <TrendingUp size={14} className="text-muted-foreground" />
            <span className="text-base font-bold font-mono text-foreground">{logged.toFixed(0)}</span>
            <span className="text-[10px] text-muted-foreground text-center">km logged</span>
          </div>
          <div className="flex flex-col items-center gap-1 px-3 py-3">
            <Footprints size={14} className="text-muted-foreground" />
            <span className="text-base font-bold font-mono text-foreground">
              {longest ? `${longest.distance_km.toFixed(1)}` : "—"}
            </span>
            <span className="text-[10px] text-muted-foreground text-center">longest run</span>
          </div>
          <div className="flex flex-col items-center gap-1 px-3 py-3">
            <Clock size={14} className="text-muted-foreground" />
            <span className="text-base font-bold font-mono text-foreground">
              {best ? formatDuration(best.duration_seconds) : "—"}
            </span>
            <span className="text-[10px] text-muted-foreground text-center">best sim. run</span>
          </div>
        </div>
      </div>

      {/* ---- AI Training Plan section ---- */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            AI Training Plan
          </h2>
          {aiPlan && (
            <div className="flex items-center gap-1.5">
              {isDueForRefresh && (
                <span className="rounded-full bg-warning/20 px-2 py-0.5 text-[10px] font-semibold text-warning">
                  Due for refresh
                </span>
              )}
              <span className="text-[10px] text-muted-foreground">
                {generatedAgo === 0 ? "Generated today" : `Generated ${generatedAgo}d ago`}
              </span>
            </div>
          )}
        </div>

        {/* Preferences toggle */}
        <button
          onClick={() => setShowPrefsForm((v) => !v)}
          className="mb-3 flex w-full items-center justify-between rounded-xl bg-secondary px-4 py-3 text-sm transition-colors active:bg-accent"
        >
          <span className="font-medium text-foreground">
            {prefsLoaded
              ? `Preferences · ${prefs.sessions_per_week}x/week · ${{ volume: "km focus", workouts: "structured", balanced: "balanced" }[prefs.focus]}`
              : "Preferences"}
          </span>
          {showPrefsForm ? (
            <ChevronUp size={16} className="text-muted-foreground" />
          ) : (
            <ChevronDown size={16} className="text-muted-foreground" />
          )}
        </button>

        {showPrefsForm && (
          <div className="mb-4 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
            <PreferencesForm
              goalId={goal.id}
              initial={prefs}
              onSaved={(saved) => {
                setPrefs(saved)
                setShowPrefsForm(false)
              }}
            />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-xl bg-destructive/10 px-4 py-3">
            <AlertCircle size={15} className="mt-0.5 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* No plan yet */}
        {!aiPlan && !isGenerating && (
          <div className="flex flex-col items-center gap-4 rounded-2xl bg-card px-6 py-8 shadow-sm ring-1 ring-border text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <Sparkles size={24} className="text-primary" />
            </div>
            <div>
              <p className="font-semibold text-card-foreground">Generate your training plan</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Claude will analyse your activity history and build a personalised 4-week training block for {goal.name}.
              </p>
            </div>
            <button
              onClick={() => handleGenerate()}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity active:opacity-80"
            >
              <Sparkles size={16} />
              Generate plan
            </button>
          </div>
        )}

        {/* Generating skeleton */}
        {isGenerating && <PlanSkeleton blockWeeks={prefs.block_weeks ?? 4} statusText={generateStatus} />}

        {/* Plan exists */}
        {aiPlan && !isGenerating && (
          <div className="flex flex-col gap-3">
            {/* Expired block warning */}
            {isBlockExpired && (
              <div className="flex gap-2.5 rounded-2xl bg-warning/10 px-4 py-3.5 ring-1 ring-warning/30">
                <AlertCircle size={15} className="mt-0.5 shrink-0 text-warning" />
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium text-foreground">Training block ended</p>
                  <p className="text-xs text-muted-foreground">
                    This {aiPlan.plan.weeks.length}-week block has finished. Regenerate to get a fresh plan based on your latest training.
                  </p>
                </div>
              </div>
            )}

            {/* Summary */}
            <div className="rounded-2xl bg-primary/5 px-4 py-3.5 ring-1 ring-primary/20">
              <p className="text-sm text-foreground leading-relaxed">{aiPlan.plan.summary}</p>
            </div>

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

            {/* Key principles */}
            {aiPlan.plan.keyPrinciples?.length > 0 && (
              <div className="rounded-2xl bg-card px-4 py-4 shadow-sm ring-1 ring-border">
                <p className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Key principles
                </p>
                <ul className="flex flex-col gap-2">
                  {aiPlan.plan.keyPrinciples.map((p, i) => (
                    <li key={i} className="flex gap-2 text-sm text-card-foreground">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Watch out */}
            {aiPlan.plan.watchOut && (
              <div className="flex gap-2.5 rounded-2xl bg-warning/10 px-4 py-3.5 ring-1 ring-warning/30">
                <AlertCircle size={15} className="mt-0.5 shrink-0 text-warning" />
                <p className="text-sm text-foreground">{aiPlan.plan.watchOut}</p>
              </div>
            )}

            {/* Adjust / Regenerate */}
            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={() => setShowAdjustForm((v) => !v)}
                className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-secondary px-4 text-sm font-medium text-secondary-foreground transition-colors active:bg-accent"
              >
                {showAdjustForm ? "Cancel" : "Adjust plan"}
              </button>

              {showAdjustForm && (
                <div className="flex flex-col gap-2 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
                  <p className="text-xs text-muted-foreground">
                    Tell Claude what to change — e.g. "fewer runs but longer", "no tempo work yet", "I can only run at weekends"
                  </p>
                  <textarea
                    value={adjustNote}
                    onChange={(e) => setAdjustNote(e.target.value)}
                    placeholder="What would you like to change?"
                    className="w-full resize-none rounded-xl bg-secondary px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    rows={3}
                  />
                  <button
                    onClick={() => handleGenerate(adjustNote)}
                    disabled={!adjustNote.trim()}
                    className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity active:opacity-80 disabled:opacity-40"
                  >
                    <Sparkles size={16} />
                    Regenerate with changes
                  </button>
                </div>
              )}

              <button
                onClick={() => handleGenerate()}
                className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-secondary px-4 text-sm font-medium text-muted-foreground transition-colors active:bg-accent"
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
                  className="flex w-full items-center justify-between rounded-xl bg-secondary px-4 py-3 text-sm transition-colors active:bg-accent"
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
                      const totalKm = prev.plan.weeks.reduce((s, w) => s + w.targetKm, 0)
                      return (
                        <div
                          key={i}
                          className="flex items-center justify-between rounded-xl bg-card px-4 py-3 ring-1 ring-border"
                        >
                          <div className="flex flex-col gap-0.5">
                            <span className="text-sm font-medium text-card-foreground">{label}</span>
                            <span className="text-xs text-muted-foreground">
                              {prev.plan.weeks.length}w · {totalKm} km total
                              {prev.adjust_note ? " · adjusted" : ""}
                            </span>
                          </div>
                          <button
                            onClick={() => {
                              setAiPlan((current) => {
                                if (!current) return current
                                // Swap: current → previous, selected previous → current
                                const newPrevious = [
                                  { plan: current.plan, generated_at: current.generated_at, adjust_note: null, block_start_date: current.block_start_date },
                                  ...current.previous_plans.filter((_, j) => j !== i),
                                ].slice(0, 5)
                                return {
                                  ...current,
                                  plan: prev.plan,
                                  generated_at: prev.generated_at,
                                  block_start_date: prev.block_start_date,
                                  previous_plans: newPrevious,
                                }
                              })
                              setShowPreviousPlans(false)
                            }}
                            className="text-xs font-semibold text-primary active:opacity-70"
                          >
                            Restore
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
