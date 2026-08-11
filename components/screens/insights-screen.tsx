"use client"

import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import {
  Trophy,
  Send,
  Loader2,
  Trash2,
  ChevronRight,
  Sparkles,
  FlaskConical,
  ArrowLeft,
  LineChart,
} from "lucide-react"
import {
  formatTargetTime,
  formatPace,
  formatDateShort,
  formatDistance,
  isRunActivity,
} from "@/lib/format"
import { detectPersonalRecords, predictRaceTimes } from "@/lib/training-utils"
import { computePredictionAdjustment } from "@/lib/test-run-benchmark"
import { useI18n } from "@/lib/i18n"
import type { Activity, Goal, TestRun } from "@/lib/types"
import { TEST_RUN_TYPES } from "@/lib/types"
import { InfoTooltip } from "@/components/ui/info-tooltip"
import { AppCard, CardRow } from "@/components/ui/app-card"
import { Section, SectionHeader } from "@/components/ui/section"
import { Stat, StatGroup } from "@/components/ui/stat"
import { Pill } from "@/components/ui/pill"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { PaceCalculatorCard } from "@/components/pace-calculator-card"
import { TrainingCalendarCard } from "@/components/training-calendar-card"

/**
 * Insights — what the log adds up to.
 *
 * Records and predictions are the answer to "am I getting faster"; the coach
 * is the answer to "what should I do about it". The coach is a full-height
 * conversation rather than a card, because a chat inside a scrolling report is
 * two scroll contexts fighting each other.
 */

interface Message {
  role: "user" | "assistant"
  content: string
}

interface InsightsScreenProps {
  activities: Activity[]
  goals: Goal[]
  onViewGoal?: (goal: Goal) => void
}

type InsightsTab = "overview" | "coach"
type StatsPeriod = "30d" | "year" | "last_year" | "all"

export function InsightsScreen({ activities, goals, onViewGoal }: InsightsScreenProps) {
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState<InsightsTab>("overview")

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [thinkingDetail, setThinkingDetail] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    try {
      const stored = localStorage.getItem("coach-messages")
      if (stored) setMessages(JSON.parse(stored) as Message[])
    } catch {}
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem("coach-messages", JSON.stringify(messages))
    } catch {}
  }, [messages])

  const [testRuns, setTestRuns] = useState<TestRun[]>([])
  const [testRunsLoading, setTestRunsLoading] = useState(true)

  // Rides, swims and walks are tracked but say nothing about running form, so
  // every figure on this screen is scoped to runs.
  const runActivities = useMemo(
    () => activities.filter((a) => isRunActivity(a.type)),
    [activities],
  )

  const personalRecords = useMemo(() => detectPersonalRecords(runActivities), [runActivities])
  const predictionAdjustment = useMemo(() => {
    if (testRuns.length === 0) return 0
    return computePredictionAdjustment(testRuns).exponentAdjustment
  }, [testRuns])
  const racePredictions = useMemo(
    () => predictRaceTimes(runActivities, predictionAdjustment),
    [runActivities, predictionAdjustment],
  )

  const [statsPeriod, setStatsPeriod] = useState<StatsPeriod>("30d")

  const filteredActivities = useMemo(() => {
    const now = new Date()
    if (statsPeriod === "30d") {
      const cutoff = new Date()
      cutoff.setDate(now.getDate() - 30)
      return runActivities.filter((a) => new Date(a.date) >= cutoff)
    }
    if (statsPeriod === "year") {
      return runActivities.filter((a) => new Date(a.date).getFullYear() === now.getFullYear())
    }
    if (statsPeriod === "last_year") {
      return runActivities.filter((a) => new Date(a.date).getFullYear() === now.getFullYear() - 1)
    }
    return runActivities
  }, [runActivities, statsPeriod])

  const totalKm = useMemo(
    () => filteredActivities.reduce((sum, a) => sum + Number(a.distance_km), 0),
    [filteredActivities],
  )
  const longestRunKm = useMemo(
    () => filteredActivities.reduce((max, a) => Math.max(max, Number(a.distance_km)), 0),
    [filteredActivities],
  )
  const recentRunCount = filteredActivities.length

  const STATS_PERIODS: { key: StatsPeriod; labelKey: Parameters<typeof t>[0] }[] = [
    { key: "30d", labelKey: "stats.period30d" },
    { key: "year", labelKey: "stats.periodYear" },
    { key: "last_year", labelKey: "stats.periodLastYear" },
    { key: "all", labelKey: "stats.periodAll" },
  ]

  useEffect(() => {
    let cancelled = false
    async function fetchTestRuns() {
      try {
        const res = await fetch("/api/test-runs")
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setTestRuns(data.test_runs ?? [])
      } catch {
        // Benchmarks are supplementary — a failure here leaves the section empty.
      } finally {
        if (!cancelled) setTestRunsLoading(false)
      }
    }
    fetchTestRuns()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (scrollRef.current && activeTab === "coach") {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, thinkingDetail, activeTab])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || isLoading) return

    const userMessage: Message = { role: "user", content: text }
    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    setInput("")
    setIsLoading(true)
    setThinkingDetail(null)

    try {
      const apiMessages = newMessages.map((m) => ({ role: m.role, content: m.content }))

      const res = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.error ?? t("coach.genericError") },
        ])
        return
      }

      const reader = res.body?.getReader()
      if (!reader) return

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
          try {
            const event = JSON.parse(line.slice(6))
            if (event.status === "thinking") {
              setThinkingDetail(event.detail ?? t("coach.thinking"))
            } else if (event.status === "done") {
              setThinkingDetail(null)
              setMessages((prev) => [...prev, { role: "assistant", content: event.text }])
            } else if (event.status === "error") {
              setThinkingDetail(null)
              setMessages((prev) => [
                ...prev,
                { role: "assistant", content: event.error ?? t("coach.genericError") },
              ])
            }
          } catch {}
        }
      }
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: t("coach.networkError") }])
    } finally {
      setIsLoading(false)
      setThinkingDetail(null)
    }
  }, [input, messages, isLoading, t])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleClear = () => {
    setMessages([])
    setInput("")
    try {
      localStorage.removeItem("coach-messages")
    } catch {}
  }

  const suggestions = [
    t("coach.suggestion1"),
    t("coach.suggestion2"),
    t("coach.suggestion3"),
    t("coach.suggestion4"),
  ]

  // ── Coach ────────────────────────────────────────────────────────────────
  if (activeTab === "coach") {
    return (
      <div className="flex flex-col" style={{ height: "calc(100dvh - 5.5rem)" }}>
        <header className="flex items-center gap-2 px-4 pb-2 pt-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setActiveTab("overview")}
            aria-label={t("common.back")}
          >
            <ArrowLeft size={18} />
          </Button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lead font-semibold text-foreground">{t("coach.title")}</h2>
            <p className="truncate text-micro text-muted-foreground">{t("coach.subtitle")}</p>
          </div>
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleClear}
              aria-label={t("coach.clear")}
            >
              <Trash2 size={17} />
            </Button>
          )}
        </header>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {messages.length === 0 && (
            <div className="flex flex-col gap-4 py-6">
              <div>
                <p className="text-body font-semibold text-foreground">{t("coach.empty")}</p>
                <p className="mt-1 max-w-[46ch] text-label leading-relaxed text-muted-foreground">
                  {t("coach.emptyDesc")}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => {
                      setInput(suggestion)
                      inputRef.current?.focus()
                    }}
                    className="press w-full rounded-md bg-surface-sunken px-3.5 py-3 text-left text-label text-secondary-foreground hover:bg-accent"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[86%] whitespace-pre-wrap px-3.5 py-2.5 text-label leading-relaxed ${
                  msg.role === "user"
                    ? "rounded-[0.875rem] rounded-br-sm bg-primary text-primary-foreground"
                    : "surface rounded-bl-sm"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start" role="status" aria-live="polite">
              <div className="surface flex items-center gap-2 rounded-bl-sm px-3.5 py-2.5 text-label text-muted-foreground">
                <Loader2 size={14} className="animate-spin" aria-hidden />
                {thinkingDetail ?? t("coach.thinking")}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-border px-4 py-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("coach.placeholder")}
              aria-label={t("coach.placeholder")}
              rows={1}
              disabled={isLoading}
              className="max-h-28 flex-1 resize-none rounded-md bg-surface-sunken px-3.5 py-2.5 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
            />
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              aria-label={t("coach.send")}
            >
              <Send size={17} />
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // ── Overview ─────────────────────────────────────────────────────────────
  const hasAnyInsight = personalRecords.length > 0 || racePredictions.predictions.length > 0

  return (
    <div className="flex flex-col gap-7 px-4 pb-8 pt-1">
      {/* The coach is the primary action on this screen, so it leads. */}
      <button
        onClick={() => setActiveTab("coach")}
        className="press surface flex w-full items-center gap-3 p-4 text-left"
      >
        <Sparkles size={20} className="shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold text-card-foreground">{t("insights.askCoach")}</p>
          <p className="mt-0.5 text-micro text-muted-foreground">{t("insights.coachDesc")}</p>
        </div>
        <ChevronRight size={17} className="shrink-0 text-muted-foreground" aria-hidden />
      </button>

      {activities.length > 0 && (
        <Section>
          <SectionHeader
            title={t("stats.section")}
            action={
              <div className="flex gap-0.5" role="group" aria-label={t("stats.section")}>
                {STATS_PERIODS.map(({ key, labelKey }) => (
                  <button
                    key={key}
                    onClick={() => setStatsPeriod(key)}
                    aria-pressed={statsPeriod === key}
                    className={`press rounded-full px-2 py-1 text-micro font-semibold ${
                      statsPeriod === key
                        ? "bg-primary/12 text-primary"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t(labelKey)}
                  </button>
                ))}
              </div>
            }
          />
          <AppCard>
            <StatGroup>
              <Stat label={t("stats.distance")} value={totalKm.toFixed(0)} unit="km" />
              <Stat label={t("stats.longestLabel")} value={longestRunKm.toFixed(1)} unit="km" />
              <Stat label={t("stats.runsLabel")} value={recentRunCount} />
            </StatGroup>
          </AppCard>
        </Section>
      )}

      {personalRecords.length > 0 && (
        <Section>
          <SectionHeader title={t("insights.personalRecords")} />
          <AppCard variant="rows">
            {personalRecords.map((pr) => (
              <CardRow key={pr.distance_label} className="flex items-center gap-3">
                <Trophy size={16} className="shrink-0 text-success" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-label font-semibold text-card-foreground">
                    {pr.distance_label}
                  </p>
                  <p className="mt-0.5 text-micro text-muted-foreground">
                    {formatDateShort(pr.date)} ·{" "}
                    <span className="measure">{formatPace(pr.pace_min_per_km)}</span>{" "}
                    {t("insights.pace")}
                  </p>
                </div>
                <span className="measure shrink-0 text-lead font-semibold text-foreground">
                  {formatTargetTime(pr.time_seconds)}
                </span>
              </CardRow>
            ))}
          </AppCard>
        </Section>
      )}

      {racePredictions.predictions.length > 0 && (
        <Section>
          <SectionHeader
            title={t("insights.racePredictions")}
            action={<InfoTooltip content={t("insights.predictionsHelp")} />}
          />
          <AppCard variant="rows">
            {racePredictions.predictions.map((pred) => (
              <CardRow key={pred.distance_label} className="flex items-baseline gap-3">
                <span className="min-w-0 flex-1 truncate text-label font-medium text-card-foreground">
                  {pred.distance_label}
                </span>
                <span className="measure text-micro text-muted-foreground">
                  {formatPace(pred.predicted_seconds / 60 / pred.distance_km)}
                </span>
                <span className="measure shrink-0 text-lead font-semibold text-foreground">
                  {formatTargetTime(pred.predicted_seconds)}
                </span>
              </CardRow>
            ))}
          </AppCard>
          {racePredictions.referenceActivity && (
            <p className="text-micro text-muted-foreground">
              {t("insights.basedOn")}{" "}
              {formatDistance(racePredictions.referenceActivity.distance_km)}{" "}
              {t("insights.on")} {formatDateShort(racePredictions.referenceActivity.date)}
            </p>
          )}
        </Section>
      )}

      <Section>
        <SectionHeader title={t("paceCalc.section")} />
        <PaceCalculatorCard goals={goals} />
      </Section>

      <Section>
        <SectionHeader title={t("testRun.benchmarks")} />
        {testRunsLoading ? (
          <div className="h-24 animate-pulse rounded-lg bg-surface-sunken" aria-hidden />
        ) : testRuns.length === 0 ? (
          <EmptyState
            icon={<FlaskConical size={18} />}
            title={t("testRun.noBenchmarksTitle")}
            body={t("testRun.noBenchmarks")}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {(() => {
              const latest = testRuns[0]
              const dm = latest.derived_metrics
              const prev = testRuns.length >= 2 ? testRuns[1] : null
              const vo2delta =
                dm.estimated_vo2max != null && prev?.derived_metrics.estimated_vo2max != null
                  ? dm.estimated_vo2max - prev.derived_metrics.estimated_vo2max
                  : null
              const trend =
                vo2delta != null
                  ? vo2delta > 0.5
                    ? "improving"
                    : vo2delta < -0.5
                      ? "declining"
                      : "stable"
                  : "stable"
              return (
                <AppCard>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-micro text-muted-foreground">
                      {TEST_RUN_TYPES.find((tt) => tt.value === latest.test_type)?.label ??
                        latest.test_type}
                      {" · "}
                      {formatDateShort(latest.created_at)}
                    </span>
                    {testRuns.length >= 2 && (
                      <Pill
                        tone={
                          trend === "improving"
                            ? "positive"
                            : trend === "declining"
                              ? "negative"
                              : "neutral"
                        }
                      >
                        {t(
                          trend === "improving"
                            ? "testRun.improving"
                            : trend === "declining"
                              ? "testRun.declining"
                              : "testRun.stable",
                        )}
                      </Pill>
                    )}
                  </div>
                  <div className="mt-3.5">
                    <StatGroup>
                      {dm.estimated_vo2max != null ? (
                        <Stat
                          label={t("testRun.vo2max")}
                          value={dm.estimated_vo2max.toFixed(1)}
                          unit={
                            vo2delta != null
                              ? `${vo2delta > 0 ? "+" : ""}${vo2delta.toFixed(1)}`
                              : undefined
                          }
                          tone={
                            vo2delta == null
                              ? "default"
                              : vo2delta > 0
                                ? "positive"
                                : vo2delta < 0
                                  ? "negative"
                                  : "default"
                          }
                        />
                      ) : null}
                      {dm.threshold_pace != null ? (
                        <Stat
                          label={t("testRun.thresholdPace")}
                          value={formatPace(dm.threshold_pace)}
                        />
                      ) : null}
                      {dm.threshold_hr != null ? (
                        <Stat label={t("testRun.thresholdHr")} value={dm.threshold_hr} unit="bpm" />
                      ) : null}
                    </StatGroup>
                  </div>
                </AppCard>
              )
            })()}

            {testRuns.length > 1 && (
              <AppCard variant="rows">
                {testRuns.slice(1, 6).map((tr) => (
                  <CardRow key={tr.id} className="flex items-center gap-3 py-2.5">
                    <FlaskConical size={14} className="shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-label text-card-foreground">
                      {TEST_RUN_TYPES.find((tt) => tt.value === tr.test_type)?.label ??
                        tr.test_type}
                    </span>
                    <span className="shrink-0 text-micro text-muted-foreground">
                      {formatDateShort(tr.created_at)}
                    </span>
                    {tr.derived_metrics.estimated_vo2max != null && (
                      <span className="measure shrink-0 text-label font-semibold text-foreground">
                        {tr.derived_metrics.estimated_vo2max.toFixed(1)}
                      </span>
                    )}
                  </CardRow>
                ))}
              </AppCard>
            )}
          </div>
        )}
      </Section>

      <Section>
        <SectionHeader title={t("calendar.section")} />
        <TrainingCalendarCard
          activities={runActivities}
          goals={goals}
          testRuns={testRuns}
          onViewGoal={onViewGoal}
        />
      </Section>

      {!hasAnyInsight && (
        <EmptyState
          icon={<LineChart size={18} />}
          title={t("insights.emptyTitle")}
          body={t("insights.emptyState")}
        />
      )}
    </div>
  )
}
