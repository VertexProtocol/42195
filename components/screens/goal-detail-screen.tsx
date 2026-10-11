"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import {
  ArrowLeft,
  Sparkles,
  RefreshCw,
  ChevronDown,
  MapPin,
  CalendarCheck,
  CalendarDays,
  Trophy,
  StarOff,
  AlertCircle,
  AlertTriangle,
  Info,
  Lightbulb,
  Pencil,
  Flag,
  Archive,
  CheckCircle2,
  Check,
  X,
  ChevronRight,
} from "lucide-react"
import {
  formatDistance,
  formatDate,
  formatDateShort,
  formatTargetTime,
  daysUntil,
  isDatePast,
  timeElapsedPercentage,
  computeDistanceInRange,
  evaluatePerformanceGoal,
  goalOutcome,
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
  PlanSessionStatus,
} from "@/lib/types"
import { useI18n, type TranslationKey } from "@/lib/i18n"
import { computeTrainingTimeline, type TrainingPhaseType, type TrainingTimeline as TTimeline } from "@/lib/training-timeline"
import { checkSkipLoadSpike, classifyAthleteLevel, type SkipLoadWarning } from "@/lib/training-safety-client"
import { mondayOf } from "@/lib/week"
import { RUN_TYPES, INJURY_NOTE_STALE_WEEKS } from "@/lib/training-constants"
// Which run finished which session. Shared with the server so the count on
// Today and the ticks on this screen can never disagree — and it reads session
// distances with the same parser the server allocates them with, so a session
// is never one length here and another there.
import { matchSessionsToActivities } from "@/lib/plan-session-match"
import { startOfWeek as toMonday, sessionKey, isManualAnswer } from "@/lib/plan-today"
import { AppCard, CardRow } from '@/components/ui/app-card'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { AppBar } from '@/components/app-bar'
import { SharedGoalEntry } from '@/components/shared-goal-entry'
import type { SharedGoalSummary } from '@/app/api/shared-goals/route'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { PromptDialog } from '@/components/ui/prompt-dialog'
import { Pill } from '@/components/ui/pill'
import { Meter } from '@/components/ui/meter'
import { TrackLoader } from '@/components/ui/track-mark'

/**
 * How a goal that has run its course actually went.
 *
 * The verdict comes from the engine, not the calendar: a target whose day has
 * passed is finished, but only a target with a mark can be said to have been
 * reached. An event goal has no mark — a marathon is not passed or failed by
 * the app — so it reports what was logged toward it and leaves the judging
 * alone.
 */
function GoalResultCard({
  goal,
  activities,
  onUnpin,
  t,
}: {
  goal: Goal
  activities: Activity[]
  onUnpin?: (goalId: string) => void
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
}) {
  const isPerformance = goal.goal_category === "performance"
  const status = isPerformance
    ? evaluatePerformanceGoal(activities, goal.target_distance_km, goal.target_time_seconds)
    : null
  // Through the shared rule, so the group's closing row cannot come to a
  // different conclusion about the same race.
  const reached =
    goalOutcome(
      goal.goal_category,
      activities,
      goal.target_distance_km,
      goal.target_time_seconds,
    ) === "reached"

  const logged = computeDistanceInRange(
    activities,
    goal.start_date,
    goal.target_date,
    goal.created_at,
  )

  // What the runner actually managed, in the unit the goal was set in.
  const best = status?.bestActivity
    ? goal.target_time_seconds && status.bestTimeSeconds
      ? formatTargetTime(status.bestTimeSeconds)
      : formatDistance(status.bestActivity.distance_km)
    : null

  return (
    <AppCard variant="rows">
      <div className="flex items-center gap-3 px-5 py-4">
        <div
          className={`pop-in flex size-14 shrink-0 items-center justify-center rounded-full border ${
            reached
              ? "border-[var(--success-edge)] bg-success text-success-foreground"
              : "border-[var(--chunk-edge)] bg-surface-sunken"
          }`}
        >
          {reached ? (
            <Trophy size={26} aria-hidden />
          ) : (
            <Flag size={24} className="text-muted-foreground" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={`text-title font-extrabold ${
              reached ? "text-success" : "text-card-foreground"
            }`}
          >
            {reached ? t("plan.achieved") : t("plan.ended")}
          </p>
          <p className="mt-0.5 text-micro text-muted-foreground">
            {t("plan.resultOn", { date: formatDate(goal.target_date) })}
          </p>
        </div>
      </div>

      {isPerformance && (
        <div className="flex items-center justify-between gap-3 px-5 py-3.5">
          <span className="text-label text-muted-foreground">
            {goal.target_time_seconds ? t("plan.bestTime") : t("plan.longestRun")}
          </span>
          <span className="measure text-label font-semibold text-card-foreground">
            {best ?? "—"}
            <span className="font-normal text-muted-foreground">
              {" / "}
              {goal.target_time_seconds
                ? formatTargetTime(goal.target_time_seconds)
                : formatDistance(goal.target_distance_km)}
            </span>
          </span>
        </div>
      )}

      {status?.bestActivity && (
        <div className="flex items-center justify-between gap-3 px-5 py-3.5">
          <span className="text-label text-muted-foreground">{t("plan.bestEffortOn")}</span>
          <span className="text-label text-card-foreground">
            {formatDateShort(status.bestActivity.date)}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 px-5 py-3.5">
        <span className="text-label text-muted-foreground">{t("plan.loggedTowards")}</span>
        <span className="measure text-label font-semibold text-card-foreground">
          {formatDistance(logged)}
        </span>
      </div>

      {/* Offered, not done for them. Unpinning is the runner's call — this is
          the moment it stops being useful on Today, so it is the moment to
          mention it. */}
      {goal.is_starred && onUnpin && (
        <div className="px-5 py-3.5">
          <p className="text-micro leading-relaxed text-muted-foreground">
            {t("plan.stillPinnedBody")}
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-2.5"
            onClick={() => onUnpin(goal.id)}
          >
            <StarOff size={14} />
            {t("plan.unpinFromToday")}
          </Button>
        </div>
      )}
    </AppCard>
  )
}

interface GoalDetailScreenProps {
  goal: Goal
  activities: Activity[]
  onBack: () => void
  onEditGoal: (goal: Goal) => void
  /** Opens the shared-goal screen for the group this goal belongs to. */
  onOpenGroup?: (groupId: string) => void
  /** The group this goal belongs to, seeded by the page render. */
  sharedGoal?: SharedGoalSummary | null
  /** Re-reads the groups after one is created here. */
  onSharedGoalChange?: () => void
  /**
   * A plan was generated, regenerated, or had a checkpoint applied. Today's
   * goal badges are derived from plans, and it no longer re-queries them on
   * every visit, so it needs telling.
   */
  onPlanChange?: () => void
  /** Unpins the goal from Today. Offered once its date has gone. */
  onToggleStar?: (goalId: string) => void
  /**
   * The runner's own session statuses, seeded by the page render. Without them
   * the ticks arrive a round trip after the plan does, so a week the runner
   * has been through renders empty and then fills in under them.
   */
  initialSessionStatuses?: Record<string, PlanSessionStatus>
  /**
   * A session was ticked off, skipped or put back. Today shows the same week's
   * count, and this screen unmounts on every tab change — so the answer has to
   * go somewhere that outlives it.
   */
  onSessionStatusChange?: (goalId: string, key: string, status: PlanSessionStatus) => void
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
  return (
    <details
      open={defaultOpen}
      className={`group ${variant === "warning" ? "rounded-md border-2 border-warning/45 bg-warning/10" : "surface"}`}
    >
      <summary className="press flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
        {variant === "warning" && <AlertCircle size={18} className="shrink-0 text-warning" aria-hidden />}
        <span className="flex-1 text-label font-extrabold text-foreground">{title}</span>
        <ChevronDown
          size={18}
          className={`shrink-0 transition-transform group-open:rotate-180 ${
            variant === "warning" ? "text-warning" : "text-muted-foreground"
          }`}
          aria-hidden
        />
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  )
}

/** A state on the plan, said in one title and one line. */
function PlanNotice({
  tone,
  icon: Icon,
  title,
  children,
}: {
  tone: "danger" | "caution" | "done" | "action" | "quiet"
  icon: typeof AlertCircle
  title: string
  children?: React.ReactNode
}) {
  const styles = {
    danger: ["border-destructive/45 bg-destructive/10", "text-destructive"],
    caution: ["border-warning/45 bg-warning/10", "text-warning"],
    done: ["border-success/45 bg-success/10", "text-success"],
    action: ["border-primary/45 bg-primary/10", "text-primary"],
    quiet: ["border-transparent bg-surface-sunken", "text-muted-foreground"],
  }[tone]
  return (
    <div className={`flex gap-3 rounded-md border px-4 py-3.5 ${styles[0]}`}>
      <Icon size={20} className={`mt-0.5 shrink-0 ${styles[1]}`} aria-hidden />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-label font-extrabold text-foreground">{title}</p>
        {children && <div className="text-label leading-snug text-muted-foreground">{children}</div>}
      </div>
    </div>
  )
}

// ---- Preferences form ----
function PreferencesForm({
  goalId,
  initial,
  onSaved,
  mode = "list",
  onFinish,
}: {
  goalId: string
  initial: GoalPreferences
  /** "wizard" walks a first-time setup one question at a time; "list" edits. */
  mode?: "wizard" | "list"
  /** Called after the last wizard step has saved. */
  onFinish?: () => void
  onSaved: (
    prefs: GoalPreferences,
    meta?: { shouldRegenerate: boolean; regenerateReason: string | null },
  ) => void
}) {
  const { t, locale } = useI18n()
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
  const [editing, setEditing] = useState<PrefKey | null>(null)

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

  async function handleSave(): Promise<boolean> {
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
        setSaveError(body.error ?? t("gp.saveFailed"))
        return false
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
      return true
    } catch {
      setSaveError(t("gp.network"))
      return false
    } finally {
      setSaving(false)
    }
  }

  const sessionsField = (
    <div className="flex flex-col gap-2">
    <ChoiceRow
      options={Array.from({ length: 14 }, (_, i) => i + 1).map((n) => [n, String(n)] as const)}
      value={sessions}
      onChange={setSessions}
    />
    <p className="text-micro text-muted-foreground">{locale === "no" ? "Antall økter, ikke treningsdager. Over 7 betyr doble økter enkelte dager. Historikken kan begrense antallet." : "Sessions, not training days. More than 7 means doubles on some days. Your history may limit the count."}</p>
    </div>
  )

  const focusOptions: [TrainingFocus, string, string][] = [
    ["volume", t("gp.focusVolume"), t("gp.focusVolumeDesc")],
    ["workouts", t("gp.focusWorkouts"), t("gp.focusWorkoutsDesc")],
    ["balanced", t("gp.focusBalanced"), t("gp.focusBalancedDesc")],
  ]
  const focusField = (
    <div className="flex flex-col gap-2">
      {focusOptions.map(([value, label, desc]) => (
        <button
          key={value}
          type="button"
          aria-pressed={focus === value}
          onClick={() => setFocus(value)}
          className={`press flex flex-col items-start gap-0.5 rounded-md border px-4 py-3 text-left ${
            focus === value ? "border-primary/60 bg-primary/10" : "border-[var(--chunk-edge)] bg-card"
          }`}
        >
          <span className={`text-label font-extrabold ${focus === value ? "text-primary" : "text-foreground"}`}>
            {label}
          </span>
          <span className="text-micro text-muted-foreground">{desc}</span>
        </button>
      ))}
    </div>
  )

  const increaseField = (
    <ChoiceRow
      options={[5, 8, 10].map((n) => [n, `${n}%`] as const)}
      value={increasePct}
      onChange={setIncreasePct}
    />
  )

  const blockField = (
    <ChoiceRow
      options={([2, 3, 4, 6] as const).map((n) => [n, t("gp.weeksShort", { n })] as const)}
      value={blockWeeks}
      onChange={setBlockWeeks}
    />
  )

  const regenField = (
    <>
      <ChoiceRow
        options={([2, 4, 6, 8] as const).map((n) => [n, t("gp.weeksShort", { n })] as const)}
        value={regenEvery}
        onChange={setRegenEvery}
      />
      {regenEvery < blockWeeks && (
        <p className="mt-2 text-micro font-semibold text-warning">{t("gp.regenWarn")}</p>
      )}
    </>
  )

  const notesField = (
    <textarea
      value={notes}
      onChange={(e) => setNotes(e.target.value)}
      placeholder={t("gp.prefNotesPlaceholder")}
      aria-label={t("gp.prefNotes")}
      className="w-full resize-none rounded-md bg-surface-sunken px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
      rows={3}
    />
  )

  const injuryField = (
    <>
      <textarea
        value={injuryNotes}
        onChange={(e) => setInjuryNotes(e.target.value)}
        placeholder={t("gp.prefInjuryPlaceholder")}
        aria-label={t("gp.prefInjury")}
        className="w-full resize-none rounded-md bg-surface-sunken px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        rows={2}
      />
      {injuryHistory.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5">
          {injuryHistory.map((entry) => {
            const addedDate = formatDate(entry.added_at)
            const resolvedDate = entry.resolved_at ? formatDate(entry.resolved_at) : null
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
                className={`flex items-start justify-between gap-2 rounded-md px-3 py-2.5 text-micro ${
                  entry.resolved_at
                    ? "bg-surface-sunken text-muted-foreground"
                    : "border-2 border-warning/45 bg-warning/10 text-foreground"
                }`}
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className={entry.resolved_at ? "line-through opacity-60" : "font-bold"}>
                    {entry.content}
                  </span>
                  <span className="text-micro text-muted-foreground">
                    {resolvedDate
                      ? t("gp.injuryResolvedOn", { added: addedDate, resolved: resolvedDate })
                      : t("gp.injuryAdded", { date: addedDate })}
                    {entry.training_phase && !entry.resolved_at && ` · ${entry.training_phase}`}
                  </span>
                  {isStale && (
                    <span className="text-micro font-semibold text-warning">
                      {t("gp.injuryStale", { weeks: Math.floor(weeksOld) })}
                    </span>
                  )}
                </div>
                {!entry.resolved_at && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="shrink-0"
                    onClick={() => handleResolve(entry.added_at)}
                    loading={isResolving}
                  >
                    <Check size={14} />
                    {t("gp.resolved")}
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </>
  )

  const focusLabel = focusOptions.find(([v]) => v === focus)?.[1] ?? ""
  const openInjuries = injuryHistory.filter((e) => !e.resolved_at).length

  /** Every setting, as a question, the line that answers it, and its control. */
  const fields: Record<PrefKey, { question: string; label: string; value: string; hint?: string; control: React.ReactNode }> = {
    sessions: { question: t("gp.qSessions"), label: t("gp.prefSessions"), value: String(sessions), control: sessionsField },
    focus: { question: t("gp.prefFocus"), label: t("gp.prefFocusShort"), value: focusLabel, control: focusField },
    block: {
      question: t("gp.qBlock"),
      label: t("gp.prefBlock"),
      value: t("gp.weeksShort", { n: blockWeeks }),
      hint: t("gp.prefBlockHint"),
      control: blockField,
    },
    increase: {
      question: t("gp.qIncrease"),
      label: t("gp.prefIncrease"),
      value: `${increasePct}%`,
      hint: t("gp.prefIncreaseHint"),
      control: increaseField,
    },
    regen: { question: t("gp.prefRegen"), label: t("gp.prefRegen"), value: t("gp.weeksShort", { n: regenEvery }), control: regenField },
    notes: {
      question: t("gp.qNotes"),
      label: t("gp.prefNotes"),
      value: notes.trim() ? notes.trim() : "—",
      control: (
        <div className="flex flex-col gap-4">
          <PrefField label={t("gp.prefNotes")}>{notesField}</PrefField>
          <PrefField label={t("gp.prefInjury")}>{injuryField}</PrefField>
        </div>
      ),
    },
    injury: {
      question: t("gp.prefInjury"),
      label: t("gp.prefInjury"),
      value: injuryNotes.trim() ? injuryNotes.trim() : openInjuries > 0 ? String(openInjuries) : "—",
      control: injuryField,
    },
  }

  // ── Setup: one question per page, then the plan ─────────────────────────
  const [step, setStep] = useState(0)
  if (mode === "wizard") {
    const steps: PrefKey[] = ["sessions", "focus", "block", "increase", "notes"]
    const field = fields[steps[step]]
    const last = step === steps.length - 1
    return (
      <div className="surface flex flex-col gap-5 p-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            aria-label={t("common.back")}
            className="press -ml-1 flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground disabled:opacity-0"
          >
            <ArrowLeft size={20} />
          </button>
          <div
            className="h-3 flex-1 overflow-hidden rounded-full bg-surface-sunken"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={steps.length}
            aria-valuenow={step + 1}
            aria-label={t("gp.stepOf", { step: step + 1, total: steps.length })}
          >
            <div
              className="h-full rounded-full bg-primary"
              style={{
                width: `${((step + 1) / steps.length) * 100}%`,
                transition: "width var(--dur-view) var(--ease-out)",
              }}
            />
          </div>
        </div>

        {/* Keyed on the step so each question arrives fresh. */}
        <div key={step} className="flex flex-col gap-4 [animation:rise_var(--dur-view)_var(--ease-out)_both]">
          <div>
            <h3 className="text-title font-extrabold text-card-foreground">{field.question}</h3>
            {field.hint && <p className="mt-1 text-label text-muted-foreground">{field.hint}</p>}
          </div>
          {field.control}
        </div>

        {saveError && <p role="alert" className="text-label font-semibold text-destructive">{saveError}</p>}
        <Button
          block
          size="lg"
          loading={saving}
          onClick={async () => {
            if (!last) {
              setStep((s) => s + 1)
              return
            }
            if (await handleSave()) onFinish?.()
          }}
        >
          {last ? (
            <>
              <Sparkles size={18} />
              {t("gp.makePlan")}
            </>
          ) : (
            t("gp.next")
          )}
        </Button>
      </div>
    )
  }

  // ── Afterwards: a short list, each line opens its own question ───────────
  const listOrder: PrefKey[] = ["sessions", "focus", "block", "increase", "regen", "notes"]
  const editingField = editing ? fields[editing] : null
  return (
    <>
      <AppCard variant="rows">
        {listOrder.map((key) => (
          <CardRow key={key} className="p-0">
            <button
              type="button"
              onClick={() => setEditing(key)}
              className="press flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left"
            >
              <span className="min-w-0 flex-1 text-label font-extrabold text-card-foreground">
                {fields[key].label}
              </span>
              <span className="max-w-[45%] truncate text-label font-semibold text-muted-foreground">
                {fields[key].value}
              </span>
              <ChevronRight size={18} className="shrink-0 text-muted-foreground" aria-hidden />
            </button>
          </CardRow>
        ))}
      </AppCard>

      <BottomSheet
        open={editingField !== null}
        onClose={() => setEditing(null)}
        title={editingField?.question ?? ""}
        closeLabel={t("gp.cancel")}
      >
        {editingField && (
          <div className="flex flex-col gap-4">
            {editingField.hint && <p className="text-label text-muted-foreground">{editingField.hint}</p>}
            {editingField.control}
            {saveError && <p role="alert" className="text-label font-semibold text-destructive">{saveError}</p>}
            <Button
              block
              size="lg"
              loading={saving}
              onClick={async () => {
                if (await handleSave()) setEditing(null)
              }}
            >
              {saving ? t("gp.saving") : t("gp.save")}
            </Button>
          </div>
        )}
      </BottomSheet>
    </>
  )
}

type PrefKey = "sessions" | "focus" | "block" | "increase" | "regen" | "notes" | "injury"

/** One setting: a bold label, an optional one-line hint, then the control. */
function PrefField({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <p className="text-label font-extrabold text-foreground">{label}</p>
      {hint && <p className="mt-0.5 text-micro text-muted-foreground">{hint}</p>}
      <div className="mt-2">{children}</div>
    </div>
  )
}

/** A row of chunky toggles where exactly one is on. */
function ChoiceRow<T extends number>({
  options,
  value,
  onChange,
}: {
  options: readonly (readonly [T, string])[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`press h-11 min-w-11 flex-1 rounded-md border text-label font-extrabold ${
            value === v
              ? "border-[var(--primary-edge)] bg-primary text-primary-foreground"
              : "border-[var(--chunk-edge)] bg-card text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function WeekCardSkeleton() {
  return (
    <AppCard variant="rows">
      <div className="flex w-full items-center justify-between px-4 py-3.5">
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 shrink-0 rounded-full" />
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
  const { t } = useI18n()
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center justify-center gap-2 text-center text-label font-bold text-primary">
        <TrackLoader size={14} />
        {statusText ?? t("gp.analysing")}
      </p>
      {/* Summary */}
      <div className="surface flex flex-col gap-2 px-4 py-3.5">
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
type SessionStatus = PlanSessionStatus

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
  const { t, locale } = useI18n()
  const [expanded, setExpanded] = useState(isCurrent)

  const deltaPct = actualKm !== null && week.targetKm > 0
    ? Math.round(((actualKm - week.targetKm) / week.targetKm) * 100)
    : null

  const completedCount = sessionStatuses.filter((s) => s === "completed").length
  // Counted and shown the same way as the completed sessions. Skipping was
  // already a state the runner could set, but the only trace of it was inside
  // the expanded week — so a collapsed week that read "2/4 done" looked like
  // two sessions still to come when in fact two had been written off.
  const skippedCount = sessionStatuses.filter((s) => s === "skipped").length
  const totalSessions = week.sessions.length
  const allCompleted = totalSessions > 0 && completedCount === totalSessions

  const fmtDay = (d: Date) =>
    d.toLocaleDateString(locale === "no" ? "nb-NO" : "en-GB", { day: "numeric", month: "short" })
  const lastDay = new Date(weekEnd)
  lastDay.setDate(lastDay.getDate() - 1) // weekEnd is exclusive (Monday next week)
  const dateLabel = `${fmtDay(weekStart)} – ${fmtDay(lastDay)}`

  const matchingHint = locale === "no" ? "Kvalitetsøkter bekreftes manuelt. En rolig tur bekrefter ikke intervaller eller terskel." : "Confirm quality sessions manually. An easy run does not verify intervals or threshold work."

  const nextStatusLabel = (status: SessionStatus) =>
    status === "planned"
      ? t("gp.markCompleted")
      : status === "completed"
        ? t("gp.markSkipped")
        : t("gp.markPlanned")

  return (
    <div className={`surface overflow-hidden ${isCurrent ? "border-primary/45" : ""}`}>
      <button
        onClick={() => setExpanded((v) => !v)}
        title={matchingHint}
        aria-expanded={expanded}
        className="press flex w-full items-center gap-3 px-4 py-3.5 text-left"
      >
        {/* The week number in a medal: lit for this week, green once every
            session in it is answered for, plain otherwise. */}
        <span
          className={`flex size-11 shrink-0 items-center justify-center rounded-full border text-lead font-extrabold ${
            allCompleted && (isPast || isCurrent)
              ? "border-[var(--success-edge)] bg-success text-success-foreground"
              : isCurrent
                ? "border-[var(--primary-edge)] bg-primary text-primary-foreground"
                : "border-[var(--chunk-edge)] bg-surface-sunken text-foreground"
          }`}
          aria-hidden
        >
          {allCompleted && (isPast || isCurrent) ? <Check size={20} strokeWidth={3} /> : week.weekNumber}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold text-card-foreground">{t("gp.weekNumber", { count: week.weekNumber })}</p>
          <p className="mt-0.5 text-label text-muted-foreground">{week.theme}</p>
          <p className="truncate text-micro font-semibold text-muted-foreground">
            {dateLabel} · <span className="measure">~{week.targetKm} km</span>
          </p>
        </div>
        {(isPast || isCurrent) && (completedCount > 0 || skippedCount > 0) && (
          <div className="flex shrink-0 flex-col items-end gap-0.5">
            {completedCount > 0 && (
              <span className="text-micro font-bold text-success">
                {t("gp.sessionsDone", { done: completedCount, total: totalSessions })}
              </span>
            )}
            {skippedCount > 0 && (
              <span className="text-micro font-bold text-muted-foreground">
                {t("gp.sessionsSkipped", { skipped: skippedCount, total: totalSessions })}
              </span>
            )}
          </div>
        )}
        <ChevronDown
          size={18}
          className={`shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {expanded && (
        <div className="flex flex-col gap-3 border-t border-border px-4 pb-4 pt-3.5">
          <p className="text-micro text-muted-foreground">{matchingHint}</p>
          {/* Planned vs actual, as the same meter the rest of the app uses. */}
          {(isPast || isCurrent) && actualKm !== null && week.targetKm > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between text-micro font-semibold text-muted-foreground">
                <span>{t("gp.planned", { km: week.targetKm })}</span>
                <span className={deltaPct !== null && deltaPct >= 0 ? "text-primary" : "text-warning"}>
                  {t("gp.actual", { km: actualKm.toFixed(1) })}
                  {deltaPct !== null && ` (${deltaPct >= 0 ? "+" : ""}${deltaPct}%)`}
                </span>
              </div>
              <Meter
                value={Math.min(100, (actualKm / week.targetKm) * 100)}
                tone={(deltaPct ?? 0) >= 0 ? "action" : "caution"}
                label={t("gp.actual", { km: actualKm.toFixed(1) })}
              />
            </div>
          )}

          <ul className="flex flex-col gap-2">
            {week.sessions.map((session, i) => {
              const status = sessionStatuses[i] ?? "planned"
              const canToggle = isPast || isCurrent
              return (
                <li
                  key={i}
                  className={`flex items-center gap-3 border-b border-border py-3 last:border-b-0 ${
                    status === "skipped" ? "opacity-55" : ""
                  }`}
                >
                  {canToggle && (
                    <button
                      onClick={() => onToggleSession(week.weekNumber, i)}
                      className={`press flex size-11 shrink-0 items-center justify-center rounded-full border ${
                        status === "completed"
                          ? "pop-in border-[var(--success-edge)] bg-success text-success-foreground"
                          : status === "skipped"
                            ? "border-[var(--chunk-edge)] bg-muted text-muted-foreground"
                            : "border-[var(--chunk-edge)] bg-card"
                      }`}
                      aria-label={`${session.type}: ${nextStatusLabel(status)}`}
                    >
                      {status === "completed" && <Check size={18} strokeWidth={3} />}
                      {status === "skipped" && <X size={16} strokeWidth={3} />}
                    </button>
                  )}
                  <div className="min-w-0 flex-1">
                    <p
                      className={`truncate text-label font-extrabold ${
                        status === "completed" ? "text-success" : "text-card-foreground"
                      }`}
                    >
                      {session.type}
                    </p>
                    {session.suggestedPace && (
                      <p className="measure text-micro text-muted-foreground">{session.suggestedPace}</p>
                    )}
                  </div>
                  <span className="measure shrink-0 text-body font-semibold text-foreground">{session.distance}</span>
                </li>
              )
            })}
          </ul>

          {week.coachNote && (
            <details className="group border-t border-border">
              <summary className="press flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                <Lightbulb size={16} className="shrink-0 text-warning" aria-hidden />
                <span className="flex-1 text-label font-bold text-foreground">{t("gp.coachNote")}</span>
                <ChevronDown
                  size={16}
                  className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <p className="px-3 pb-3 text-label leading-snug text-muted-foreground">{week.coachNote}</p>
            </details>
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
        className="press flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <h3 className="text-label font-extrabold text-foreground">
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
            <div className="size-3.5 shrink-0 rounded-full border-2 border-[var(--primary-edge)] bg-primary" />
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
          <div className="flex items-center gap-2.5 rounded-md border-2 border-destructive/40 bg-destructive/10 px-3.5 py-3">
            <Flag size={14} className="text-destructive shrink-0" />
            <div className="flex-1">
              <span className="text-label font-semibold text-destructive">{t("timeline.raceDay")}</span>
              <span className="ml-2 text-micro text-muted-foreground">
                {formatDate(timeline.raceDate.toISOString())}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  )

  if (embedded) {
    return <div className="overflow-hidden border-t border-border">{timelineContent}</div>
  }

  return (
    <AppCard variant="rows">
      {timelineContent}
    </AppCard>
  )
}

// ---- Main screen ----
export function GoalDetailScreen({
  goal,
  activities,
  onBack,
  onEditGoal,
  onPlanChange,
  onToggleStar,
  onOpenGroup,
  sharedGoal,
  onSharedGoalChange,
  initialSessionStatuses,
  onSessionStatusChange,
}: GoalDetailScreenProps) {
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
  // Set when generating would put away a block that is still running on another
  // race. Holds the note alongside it so confirming resumes the same request
  // rather than dropping what the runner typed.
  const [supersedeConflict, setSupersedeConflict] = useState<{
    blocks: Array<{ goalId: string; name: string; weeksLeft: number }>
    note: string
  } | null>(null)
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
            archived_at: data.archived_at ?? null,
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

  // Manual overrides persisted to database (with localStorage fallback).
  // Seeded from the page render so the ticks are there with the plan rather
  // than a round trip behind it; the fetch below still runs and wins, because
  // the seed is as old as the page load.
  const [manualStatuses, setManualStatuses] = useState<Record<string, SessionStatus>>(
    initialSessionStatuses ?? {},
  )

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
    const blockMonday = mondayOf(new Date(aiPlan.block_start_date))
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
      const matched = matchSessionsToActivities(week.sessions, weekActs)
      matched.forEach((m, si) => {
        if (m) result[sessionKey(week.weekNumber, si)] = "completed"
      })
    }
    return result
  }, [aiPlan, activities])

  // Merge: the runner's own answers win over what the activities imply. A
  // stored "planned" is not one of those answers — see isManualAnswer — and
  // must not overwrite an auto-match, or the session stays open forever with
  // no way to reopen it from here.
  const sessionStatuses = useMemo(() => {
    const answers = Object.fromEntries(
      Object.entries(manualStatuses).filter(([, status]) => isManualAnswer(status)),
    )
    return { ...autoStatuses, ...answers }
  }, [autoStatuses, manualStatuses])

  const handleToggleSession = useCallback((weekNumber: number, sessionIndex: number) => {
    const key = sessionKey(weekNumber, sessionIndex)
    const effective = sessionStatuses[key] ?? "planned"
    const next: SessionStatus =
      effective === "planned" ? "completed"
      : effective === "completed" ? "skipped"
      : "planned"

    // Cycling back to "planned" hands the session back to the matcher rather
    // than storing "planned" as an answer, so a run that matches it can tick
    // it off again. The server deletes the row on the same signal.
    setManualStatuses((prev) => {
      if (next !== "planned") return { ...prev, [key]: next }
      const rest = { ...prev }
      delete rest[key]
      return rest
    })
    onSessionStatusChange?.(goal.id, key, next)

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
  }, [goal.id, sessionStatuses, onSessionStatusChange])

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
    async (note?: string, supersede = false) => {
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
      setGenerateStatus(t("gp.analysing"))
      setError(null)
      setShowAdjustForm(false)
      setCheckpoint(null) // new block — reset checkpoint display
      setPendingCheckpoint(null)
      setShowCheckpointReview(false)

      try {
        const res = await fetch("/api/ai/training-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goalId: goal.id, adjustNote: note || null, supersede }),
        })

        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          // Another race still has a live block. Not an error — a question, and
          // one the runner has to answer before anything is put away.
          if (res.status === 409 && data.conflict?.blocks?.length) {
            setSupersedeConflict({ blocks: data.conflict.blocks, note: note ?? "" })
            return
          }
          setError(data.code === "missing_history" ? t("gp.missingHistory") : data.code === "race_budget_conflict" ? t("gp.raceBudgetConflict") : data.error ?? t("gp.generateFailed"))
          return
        }

        const reader = res.body?.getReader()
        if (!reader) {
          setError(t("gp.streaming"))
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
              setGenerateStatus(t("gp.thinking"))
            } else if (event.status === "generating") {
              setGenerateStatus(t("gp.writing"))
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
              setError(event.error ?? t("gp.generateFailed"))
            }
          }
        }
      } catch {
        setError(t("gp.network"))
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
        (Date.now() - mondayOf(new Date(aiPlan.block_start_date)).getTime()) / (7 * 24 * 60 * 60 * 1000)
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
    const blockMonday = mondayOf(new Date(aiPlan.block_start_date))
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

      <div className="stagger flex flex-col gap-5 px-4 pb-8 screen-body">
        {!past && days > 0 && (
          <p className="flex items-baseline gap-2">
            <span className="measure text-display font-bold leading-none text-foreground">{days}</span>
            <span className="text-lead font-bold text-muted-foreground">{t("common.daysLeft")}</span>
          </p>
        )}
        <div className="-mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {goal.is_active && !past && <Pill tone="action">{t("plan.activePlan")}</Pill>}
          <span className="flex items-center gap-1.5 text-micro text-muted-foreground">
            <MapPin size={13} aria-hidden />
            {formatDistance(goal.target_distance_km)}
          </span>
          <span className="flex items-center gap-1.5 text-micro text-muted-foreground">
            <CalendarCheck size={13} aria-hidden />
            {formatDate(goal.target_date)}
          </span>
        </div>

      {/* Once the date has gone, the question is no longer "how far into the
          training am I" — that bar reads 100% for every past goal and says
          nothing. What is left to know is how it went, so the result leads and
          the plan section falls in behind it. */}
      {past ? (
        <GoalResultCard
          goal={goal}
          activities={activities}
          onUnpin={onToggleStar}
          t={t}
        />
      ) : (
        <AppCard variant="rows">
          <div className="px-5 py-4">
            <div className="flex items-center justify-between text-micro mb-2">
              <span className="text-muted-foreground">
                {goal.start_date
                  ? `${t("plan.trainingFrom")} ${formatDate(goal.start_date)}`
                  : t("plan.trainingProgress")}
              </span>
              <span className="font-medium text-foreground">{timeProgress}%</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-surface-sunken">
              <div
                className="grow-x h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${timeProgress}%` }}
              />
            </div>
          </div>
          {timeline && (
            <TrainingTimelineView
              timeline={timeline}
              blockPosition={blockPosition}
              embedded
            />
          )}
        </AppCard>
      )}

      {/* ---- AI Training Plan section ---- */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lead font-extrabold text-foreground">{t("plan.sectionTitle")}</h2>
          {aiPlan && activeTab === "plan" && (
            <div className="flex items-center gap-1.5">
              {isDueForRefresh && !past && !aiPlan.archived_at && !isBlockExpired && (
                <span className="rounded-full bg-warning/20 px-2 py-0.5 text-micro font-semibold text-warning">
                  {t("plan.dueForRefresh")}
                </span>
              )}

            </div>
          )}
        </div>

        {/* Plan and Preferences only split once there is a plan. Before that
            the preferences are the way in: set them, then the plan is made. */}
        {aiPlan && (
        <Segmented
          className="mb-3"
          label={t("plan.sectionTitle")}
          options={[
            ["plan", t("plan.tabPlan")],
            ["preferences", t("plan.tabPreferences")],
          ] as const}
          value={activeTab}
          onChange={setActiveTab}
        />
        )}

        {/* Preferences tab */}
        {activeTab === "preferences" && aiPlan && (
          <div>
            <PreferencesForm
              goalId={goal.id}
              initial={prefs}
              onSaved={(saved, meta) => {
                setPrefs(saved)
                if (meta?.shouldRegenerate && meta.regenerateReason === "new_active_injury") {
                  setActiveTab("plan")
                  // A brand-new active injury was logged — auto-regenerate the
                  // plan so the comeback + injury caps apply immediately.
                  handleGenerate("Auto-regenerated after a new active injury was logged.")
                }
              }}
            />
          </div>
        )}

        {/* Training Plan tab */}
        {(activeTab === "plan" || !aiPlan) && (
        <>

        {/* Error */}
        {error && (
          <div className="mb-3" role="alert">
            <PlanNotice tone="danger" icon={AlertCircle} title={error} />
          </div>
        )}

        {/* No plan yet */}
        {!planResolved && !isGenerating && (
          <PlanSkeleton blockWeeks={prefs.block_weeks ?? 4} statusText={t("gp.loading")} />
        )}

        {/* A block is built forward from today toward a race date, so a race
            that has already happened has nothing to build. handleGenerate
            refuses it, but the invitation was offered anyway: a full pitch and
            an enabled button whose only outcome was an error. Say why up
            front instead. */}
        {planResolved && !aiPlan && !isGenerating && past && (
          <div className="surface flex flex-col items-center gap-3 px-6 py-8 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-surface-sunken">
              <CalendarCheck size={30} className="text-muted-foreground" />
            </div>
            <div>
              <p className="text-lead font-extrabold text-card-foreground">{t("plan.raceIsPast")}</p>
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
          <PreferencesForm
            mode="wizard"
            goalId={goal.id}
            initial={prefs}
            onSaved={(saved) => setPrefs(saved)}
            onFinish={() => handleGenerate()}
          />
        )}

        {/* Generating skeleton */}
        {isGenerating && <PlanSkeleton blockWeeks={prefs.block_weeks ?? 4} statusText={generateStatus} />}

        {/* Plan exists */}
        {aiPlan && !isGenerating && (
          <div className="flex flex-col gap-3">
            {/*
              Put away when the runner generated a block for another race. The
              plan stays on screen — it is what they did — but it is stated up
              front, because a block that silently stopped counting is worse
              than one that says it has.
            */}
            {aiPlan.archived_at && (
              <PlanNotice tone="quiet" icon={Archive} title={t("plan.archivedTitle")}>
                {t("plan.archivedBody", { date: formatDate(aiPlan.archived_at) })}
              </PlanNotice>
            )}

            {/* Block completion summary */}
            {isBlockExpired && blockCompletionStats && (
              <PlanNotice tone={blockCompletionStats.completedSessions === blockCompletionStats.totalSessions && blockCompletionStats.totalSessions > 0 ? "done" : "quiet"} icon={CalendarDays} title={t("gp.blockComplete")}>
                {t("gp.blockCompleteBody", {
                  weeks: blockCompletionStats.weeks,
                  km: blockCompletionStats.totalKm,
                  done: blockCompletionStats.completedSessions,
                  total: blockCompletionStats.totalSessions,
                })}
              </PlanNotice>
            )}

            {/* Skip-load spike warning */}
            {skipWarning && !isBlockExpired && (
              <PlanNotice
                tone={skipWarning.severity === "danger" ? "danger" : "caution"}
                icon={AlertCircle}
                title={skipWarning.severity === "danger" ? t("gp.spikeDanger") : t("gp.spikeWarn")}
              >
                {skipWarning.actualKm === 0
                  ? t("gp.spikeRest", { next: skipWarning.nextPlannedKm })
                  : t("gp.spikeBody", {
                      actual: skipWarning.actualKm,
                      next: skipWarning.nextPlannedKm,
                      safe: skipWarning.safeMaxKm,
                    })}
              </PlanNotice>
            )}

            {/* Mid-block checkpoint banner */}
            {checkpoint?.adjustmentApplied && !isBlockExpired && (
              <PlanNotice tone="action" icon={Lightbulb} title={t("gp.checkpointApplied")}>
                {checkpoint.adjustmentNote}
              </PlanNotice>
            )}

            {/* Weekly blocks */}
            {aiPlan.plan.weeks.map((week, i) => {
              const weekStart = mondayOf(new Date(aiPlan.block_start_date))
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
              <CollapsibleSection title={t("gp.watchOut")} defaultOpen={false} variant="warning">
                <p className="text-label text-foreground">{aiPlan.plan.watchOut}</p>
              </CollapsibleSection>
            )}

            {/* Pace source warning — only shown when pace targets are estimates */}
            {(paceSource === "historical" || paceSource === "none") && (
              <p className="flex items-start gap-2 px-1 text-micro font-semibold text-muted-foreground">
                <AlertTriangle size={14} className="mt-px shrink-0 text-warning" aria-hidden />
                {paceSource === "none" ? t("gp.paceNone") : t("gp.paceHistory")}
              </p>
            )}

            {/* Adjust / Regenerate */}
            <div className="flex flex-col gap-3 pt-1">
              {(() => {
                const checkpointPending = !!pendingCheckpoint?.isWayOff && !checkpoint?.adjustmentApplied
                return (
                  <>
                    <Button
                      variant="secondary"
                      block
                      className={checkpointPending ? "border-warning/60 text-warning" : undefined}
                      onClick={() => {
                        if (checkpointPending) {
                          setShowCheckpointReview((v) => !v)
                          setShowAdjustForm(false)
                        } else {
                          setShowAdjustForm((v) => !v)
                          setShowCheckpointReview(false)
                        }
                      }}
                    >
                      {checkpointPending && !(showAdjustForm || showCheckpointReview) && (
                        <span className="relative flex size-2 shrink-0">
                          <span className="absolute inline-flex size-full animate-ping rounded-full bg-warning opacity-75" />
                          <span className="relative inline-flex size-2 rounded-full bg-warning" />
                        </span>
                      )}
                      {showAdjustForm || showCheckpointReview ? (
                        t("gp.cancel")
                      ) : checkpointPending ? (
                        t("gp.reviewCheckpoint")
                      ) : (
                        <>
                          <Pencil size={16} />
                          {t("gp.adjust")}
                        </>
                      )}
                    </Button>

                    {showCheckpointReview && pendingCheckpoint && (
                      <div className="pop-in flex flex-col gap-3">
                        <PlanNotice tone="caution" icon={AlertTriangle} title={t("gp.checkpointTitle")}>
                          {t(
                            pendingCheckpoint.direction === "under"
                              ? "gp.checkpointBodyDown"
                              : "gp.checkpointBodyUp",
                            { pct: Math.round(pendingCheckpoint.overallAdherencePct) },
                          )}
                        </PlanNotice>
                        <Button block onClick={handleApplyCheckpoint} loading={isApplyingCheckpoint}>
                          {isApplyingCheckpoint ? t("gp.applying") : t("gp.apply")}
                        </Button>
                      </div>
                    )}
                  </>
                )
              })()}

              {showAdjustForm && (
                <div className="surface pop-in flex flex-col gap-3 p-4">
                  <p className="text-label text-muted-foreground">{t("gp.adjustHint")}</p>
                  <textarea
                    value={adjustNote}
                    onChange={(e) => setAdjustNote(e.target.value)}
                    placeholder={t("gp.adjustPlaceholder")}
                    className="w-full resize-none rounded-md bg-surface-sunken px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    rows={3}
                  />
                  <Button block onClick={() => handleGenerate(adjustNote)} disabled={!adjustNote.trim()}>
                    <Sparkles size={18} />
                    {t("gp.regenerateWith")}
                  </Button>
                </div>
              )}

              <Button variant="ghost" block onClick={() => handleGenerate("Adjust the remaining active weeks using my current preferences.")} className="text-muted-foreground">
                <RefreshCw size={16} />
                {t("gp.regenerateFresh")}
              </Button>
            </div>

            {/* Previous plans */}
            {aiPlan.previous_plans.length > 0 && (
              <div className="pt-2">
                <button
                  onClick={() => setShowPreviousPlans((v) => !v)}
                  aria-expanded={showPreviousPlans}
                  className="press flex w-full items-center justify-between rounded-md bg-surface-sunken px-4 py-3"
                >
                  <span className="text-label font-extrabold text-foreground">
                    {t("gp.previousPlans", { count: aiPlan.previous_plans.length })}
                  </span>
                  <ChevronDown
                    size={18}
                    className={`text-muted-foreground transition-transform ${showPreviousPlans ? "rotate-180" : ""}`}
                  />
                </button>

                {showPreviousPlans && (
                  <div className="mt-2 flex flex-col gap-2">
                    {aiPlan.previous_plans.map((prev, i) => {
                      const genDate = new Date(prev.generated_at)
                      const label = formatDate(genDate.toISOString())
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
                            <span className="text-label font-bold text-card-foreground">{label}</span>
                            <span className="text-micro text-muted-foreground">
                              {t("gp.weeksKm", { weeks: weeks.length, km: totalKm })}
                              {completedSessions !== null
                                ? ` · ${t("gp.sessionsShort", { done: completedSessions, total: totalSessions })}`
                                : ""}
                              {prev.adjust_note ? ` · ${t("gp.adjusted")}` : ""}
                            </span>
                          </div>
                          {prev.summary && (
                            <p className="line-clamp-2 text-micro text-muted-foreground">{prev.summary}</p>
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

      {onOpenGroup && (
        <SharedGoalEntry
          goalId={goal.id}
          group={sharedGoal ?? null}
          finished={past}
          onOpen={onOpenGroup}
          onCreated={onSharedGoalChange}
        />
      )}
      </div>

      {/*
        One block at a time. The runner is told what generating would put away
        and decides — rather than being refused and asked to go and tidy up a
        state the app let them reach, or finding out afterwards that a block
        they were mid-way through had quietly stopped counting.
      */}
      <PromptDialog
        open={supersedeConflict !== null}
        onClose={() => setSupersedeConflict(null)}
        title={t("plan.supersedeTitle")}
        closeLabel={t("plan.supersedeCancel")}
        footer={
          <div className="flex flex-col gap-2">
            <Button
              onClick={() => {
                const pending = supersedeConflict
                setSupersedeConflict(null)
                if (pending) void handleGenerate(pending.note, true)
              }}
            >
              {t("plan.supersedeConfirm")}
            </Button>
            <Button variant="ghost" onClick={() => setSupersedeConflict(null)}>
              {t("plan.supersedeCancel")}
            </Button>
          </div>
        }
      >
        <p className="text-body text-muted-foreground">
          {supersedeConflict && supersedeConflict.blocks.length === 1
            ? t("plan.supersedeBody", {
                names: supersedeConflict.blocks[0].name,
                weeks: t(
                  supersedeConflict.blocks[0].weeksLeft === 1
                    ? "plan.supersedeWeeks"
                    : "plan.supersedeWeeksPlural",
                  { count: supersedeConflict.blocks[0].weeksLeft },
                ),
              })
            : t("plan.supersedeBodyPlural", {
                names: (supersedeConflict?.blocks ?? []).map((b) => b.name).join(", "),
              })}
        </p>
      </PromptDialog>
    </>
  )
}
