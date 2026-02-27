"use client"

import { useEffect, useState, useCallback } from "react"
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
} from "@/lib/format"
import { Skeleton } from "@/components/ui/skeleton"
import type {
  Goal,
  Activity,
  GoalPreferences,
  TrainingFocus,
  AiTrainingPlan,
  TrainingWeek,
} from "@/lib/types"

interface GoalDetailScreenProps {
  goal: Goal
  activities: Activity[]
  onBack: () => void
  onEditGoal: (goal: Goal) => void
}

// ---- Helper: best run at ±20% of target distance ----
function bestRelevantRun(activities: Activity[], targetKm: number): Activity | null {
  const lo = targetKm * 0.8
  const hi = targetKm * 1.2
  const candidates = activities.filter(
    (a) => a.distance_km >= lo && a.distance_km <= hi && a.duration_seconds > 0
  )
  if (candidates.length === 0) return null
  return candidates.reduce((best, a) => (a.duration_seconds < best.duration_seconds ? a : best))
}

function longestRun(activities: Activity[], startDate: string | null, createdAt: string): Activity | null {
  const from = startDate ? new Date(startDate).getTime() : new Date(createdAt).getTime()
  const relevant = activities.filter((a) => new Date(a.date).getTime() >= from)
  if (relevant.length === 0) return null
  return relevant.reduce((best, a) => (a.distance_km > best.distance_km ? a : best))
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
    await fetch("/api/ai/training-plan", {
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
    setSaving(false)
    onSaved({
      goal_id: goalId,
      sessions_per_week: sessions,
      focus,
      notes: notes || null,
      weekly_increase_pct: increasePct,
      block_weeks: blockWeeks,
      regenerate_every_weeks: regenEvery,
    })
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

function PlanSkeleton({ blockWeeks }: { blockWeeks: number }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-center text-sm text-muted-foreground">Analysing your training history…</p>
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

// ---- Training week card ----
function WeekCard({ week, isCurrent }: { week: TrainingWeek; isCurrent: boolean }) {
  const [expanded, setExpanded] = useState(isCurrent)

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
            <p className="text-sm font-semibold text-card-foreground">{week.theme}</p>
            <p className="text-xs text-muted-foreground">~{week.targetKm} km</p>
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
          <div className="flex flex-col gap-3">
            {week.sessions.map((session, i) => (
              <div key={i} className="flex flex-col gap-0.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-semibold text-card-foreground">{session.type}</span>
                  <span className="text-sm font-mono font-bold text-primary">{session.distance}</span>
                </div>
                <p className="text-xs text-muted-foreground">{session.effort}</p>
                <p className="text-xs text-muted-foreground/70 italic">{session.purpose}</p>
              </div>
            ))}
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
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load existing plan + preferences on mount
  useEffect(() => {
    async function load() {
      const [planRes, prefsRes] = await Promise.all([
        fetch(`/api/ai/training-plan?goalId=${goal.id}`),
        fetch(`/api/ai/training-plan?goalId=${goal.id}`), // preferences come via same GET
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
          })
        }
      }
      // Load preferences
      const prefsData = await fetch(`/api/ai/training-plan/preferences?goalId=${goal.id}`)
      if (prefsData.ok) {
        const p = await prefsData.json()
        if (p.preferences) setPrefs(p.preferences)
      }
      setPrefsLoaded(true)
    }
    load()
  }, [goal.id])

  const handleGenerate = useCallback(
    async (note?: string) => {
      setIsGenerating(true)
      setError(null)
      setShowAdjustForm(false)

      try {
        const res = await fetch("/api/ai/training-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goalId: goal.id, adjustNote: note || null }),
        })

        const data = await res.json()

        if (!res.ok) {
          setError(data.error ?? "Failed to generate plan")
          return
        }

        setAiPlan({
          goal_id: goal.id,
          plan: data.plan,
          block_start_date: data.block_start_date,
          generated_at: data.generated_at,
        })
        setAdjustNote("")
      } catch {
        setError("Network error. Please try again.")
      } finally {
        setIsGenerating(false)
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

  // Which week of the plan are we currently in?
  const currentWeekIndex = aiPlan
    ? Math.floor(
        (Date.now() - new Date(aiPlan.block_start_date).getTime()) / (7 * 24 * 60 * 60 * 1000)
      )
    : -1

  const generatedAgo = aiPlan
    ? Math.floor((Date.now() - new Date(aiPlan.generated_at).getTime()) / (1000 * 60 * 60 * 24))
    : null

  const isDueForRefresh = aiPlan && prefs.regenerate_every_weeks
    ? generatedAgo !== null && generatedAgo >= prefs.regenerate_every_weeks * 7
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
        {isGenerating && <PlanSkeleton blockWeeks={prefs.block_weeks ?? 4} />}

        {/* Plan exists */}
        {aiPlan && !isGenerating && (
          <div className="flex flex-col gap-3">
            {/* Summary */}
            <div className="rounded-2xl bg-primary/5 px-4 py-3.5 ring-1 ring-primary/20">
              <p className="text-sm text-foreground leading-relaxed">{aiPlan.plan.summary}</p>
            </div>

            {/* Weekly blocks */}
            {aiPlan.plan.weeks.map((week, i) => (
              <WeekCard
                key={week.weekNumber}
                week={week}
                isCurrent={i === currentWeekIndex}
              />
            ))}

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
          </div>
        )}
      </section>
    </div>
  )
}
