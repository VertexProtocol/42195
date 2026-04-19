"use client"

import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import {
  Trophy,
  Timer,
  TrendingUp,
  Footprints,
  Clock,
  Bot,
  Send,
  User,
  Loader2,
  Trash2,
  ChevronRight,
  Sparkles,
  FlaskConical
} from "lucide-react"
import {
  formatTargetTime,
  formatPace,
  formatDateShort,
  formatDistance,
  isRunActivity
} from "@/lib/format"
import { detectPersonalRecords, predictRaceTimes } from "@/lib/training-utils"
import { computePredictionAdjustment } from "@/lib/test-run-benchmark"
import { useI18n } from "@/lib/i18n"
import type { Activity, Goal, TestRun } from "@/lib/types"
import { TEST_RUN_TYPES } from "@/lib/types"
import { InfoTooltip } from "@/components/ui/info-tooltip"
import { AppCard } from '@/components/ui/app-card'
import { PaceCalculatorCard } from "@/components/pace-calculator-card"
import { TrainingCalendarCard } from "@/components/training-calendar-card"

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

export function InsightsScreen({ activities, goals, onViewGoal }: InsightsScreenProps) {
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState<InsightsTab>("overview")

  // AI Coach state — persisted to localStorage so chat survives tab switches
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [thinkingDetail, setThinkingDetail] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Load messages from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("coach-messages")
      if (stored) setMessages(JSON.parse(stored) as Message[])
    } catch {}
  }, [])

  // Persist messages to localStorage on every change
  useEffect(() => {
    try {
      localStorage.setItem("coach-messages", JSON.stringify(messages))
    } catch {}
  }, [messages])

  const [testRuns, setTestRuns] = useState<TestRun[]>([])
  const [testRunsLoading, setTestRunsLoading] = useState(true)

  // Scope insights to running activities only — rides, swims, walks etc.
  // are tracked but not relevant to the running stats / calendar / predictions.
  const runActivities = useMemo(
    () => activities.filter((a) => isRunActivity(a.type)),
    [activities],
  )

  const personalRecords = useMemo(() => detectPersonalRecords(runActivities), [runActivities])
  // Apply prediction adjustment from test run validation feedback
  const predictionAdjustment = useMemo(() => {
    if (testRuns.length === 0) return 0
    return computePredictionAdjustment(testRuns).exponentAdjustment
  }, [testRuns])
  const racePredictions = useMemo(() => predictRaceTimes(runActivities, predictionAdjustment), [runActivities, predictionAdjustment])

  type StatsPeriod = "30d" | "year" | "last_year" | "all"
  const [statsPeriod, setStatsPeriod] = useState<StatsPeriod>("30d")

  const filteredActivities = useMemo(() => {
    const now = new Date()
    if (statsPeriod === "30d") {
      const cutoff = new Date()
      cutoff.setDate(now.getDate() - 30)
      return runActivities.filter(a => new Date(a.date) >= cutoff)
    }
    if (statsPeriod === "year") {
      return runActivities.filter(a => new Date(a.date).getFullYear() === now.getFullYear())
    }
    if (statsPeriod === "last_year") {
      return runActivities.filter(a => new Date(a.date).getFullYear() === now.getFullYear() - 1)
    }
    return runActivities
  }, [runActivities, statsPeriod])

  const totalKm = useMemo(() => filteredActivities.reduce((sum, a) => sum + Number(a.distance_km), 0), [filteredActivities])
  const longestRunKm = useMemo(() => filteredActivities.reduce((max, a) => Math.max(max, Number(a.distance_km)), 0), [filteredActivities])
  const recentRunCount = filteredActivities.length

  const STATS_PERIODS: { key: StatsPeriod; label: string }[] = [
    { key: "30d", label: "30d" },
    { key: "year", label: "This yr" },
    { key: "last_year", label: "Last yr" },
    { key: "all", label: "All" },
  ]

  // Fetch test runs for benchmarks section
  useEffect(() => {
    let cancelled = false
    async function fetchTestRuns() {
      try {
        const res = await fetch("/api/test-runs")
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setTestRuns(data.test_runs ?? [])
      } catch {
        // silently ignore
      } finally {
        if (!cancelled) setTestRunsLoading(false)
      }
    }
    fetchTestRuns()
    return () => { cancelled = true }
  }, [])

  // Auto-scroll to bottom on new messages
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
      const apiMessages = newMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }))

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
              setMessages((prev) => [
                ...prev,
                { role: "assistant", content: event.text },
              ])
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
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: t("coach.networkError") },
      ])
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
    try { localStorage.removeItem("coach-messages") } catch {}
  }

  const suggestions = [
    t("coach.suggestion1"),
    t("coach.suggestion2"),
    t("coach.suggestion3"),
    t("coach.suggestion4"),
  ]

  if (activeTab === "coach") {
    return (
      <div className="flex flex-col" style={{ height: "calc(100dvh - 5rem)" }}>
        {/* Header */}
        <header className="flex items-center justify-between px-5 pt-4 pb-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setActiveTab("overview")}
              className="flex h-8 w-8 items-center justify-center rounded-xl bg-secondary text-muted-foreground active:bg-accent"
            >
              <ChevronRight size={16} className="rotate-180" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-foreground">{t("coach.title")}</h1>
              <p className="text-xs text-muted-foreground">{t("coach.subtitle")}</p>
            </div>
          </div>
          {messages.length > 0 && (
            <button
              onClick={handleClear}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              aria-label="Clear chat"
            >
              <Trash2 size={18} />
            </button>
          )}
        </header>

        {/* Messages area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center space-y-5 py-10">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                <Bot size={28} className="text-primary" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">{t("coach.empty")}</p>
                <p className="text-xs text-muted-foreground max-w-[280px]">
                  {t("coach.emptyDesc")}
                </p>
              </div>
              <div className="flex flex-col gap-2 w-full max-w-[300px]">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => {
                      setInput(suggestion)
                      inputRef.current?.focus()
                    }}
                    className="w-full text-left text-xs px-4 py-2.5 rounded-2xl bg-card shadow-sm ring-1 ring-border hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
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
              className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 mt-0.5">
                  <Bot size={12} className="text-primary" />
                </div>
              )}
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "bg-card shadow-sm ring-1 ring-border text-card-foreground rounded-bl-md"
                }`}
              >
                {msg.content}
              </div>
              {msg.role === "user" && (
                <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-muted mt-0.5">
                  <User size={12} className="text-muted-foreground" />
                </div>
              )}
            </div>
          ))}

          {/* Thinking indicator */}
          {isLoading && (
            <div className="flex gap-2 items-start">
              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Bot size={12} className="text-primary" />
              </div>
              <div className="bg-card shadow-sm ring-1 ring-border rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                {thinkingDetail ?? t("coach.thinking")}
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-border px-5 py-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("coach.placeholder")}
              rows={1}
              className="flex-1 resize-none rounded-2xl border border-border bg-card px-4 py-2.5 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 max-h-24"
              disabled={isLoading}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 active:opacity-80 transition-opacity"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5 px-5 pb-6 pt-4">
      {/* Header */}
      <header>
        <h1 className="text-2xl font-bold text-foreground">{t("insights.title")}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("insights.subtitle")}</p>
      </header>

      {/* Training Stats */}
      {activities.length > 0 && (
        <AppCard>
          {/* Period switcher — compact, right-aligned */}
          <div className="mb-3 flex justify-center gap-0.5">
            {STATS_PERIODS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setStatsPeriod(key)}
                className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                  statsPeriod === key
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Stats — 3 subtle cards with accent icons */}
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col items-center gap-1 rounded-xl bg-secondary/50 px-2 py-3">
              <TrendingUp size={14} className="text-primary" />
              <span className="text-xl font-bold font-mono text-foreground leading-none">
                {totalKm.toFixed(0)}
              </span>
              <span className="text-[10px] text-muted-foreground">km</span>
            </div>
            <div className="flex flex-col items-center gap-1 rounded-xl bg-secondary/50 px-2 py-3">
              <Footprints size={14} className="text-primary" />
              <span className="text-xl font-bold font-mono text-foreground leading-none">
                {longestRunKm.toFixed(1)}
              </span>
              <span className="text-[10px] text-muted-foreground">{t("stats.longest")}</span>
            </div>
            <div className="flex flex-col items-center gap-1 rounded-xl bg-secondary/50 px-2 py-3">
              <Clock size={14} className="text-primary" />
              <span className="text-xl font-bold font-mono text-foreground leading-none">
                {recentRunCount}
              </span>
              <span className="text-[10px] text-muted-foreground">{t("stats.runs")}</span>
            </div>
          </div>
        </AppCard>
      )}

      {/* AI Coach Card */}
      <button
        onClick={() => setActiveTab("coach")}
        className="flex items-center gap-4 rounded-2xl bg-gradient-to-r from-primary/10 to-primary/5 p-5 shadow-sm ring-1 ring-primary/20 text-left active:scale-[0.98] transition-transform"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15">
          <Sparkles size={24} className="text-primary" />
        </div>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-foreground">{t("insights.askCoach")}</h2>
          <p className="text-xs text-muted-foreground">{t("insights.coachDesc")}</p>
        </div>
        <ChevronRight size={18} className="text-muted-foreground" />
      </button>

      {/* Personal Records */}
      {personalRecords.length > 0 && (
        <section>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("insights.personalRecords")}
          </h3>
          <div className="flex flex-col gap-2">
            {personalRecords.map((pr) => (
              <div
                key={pr.distance_label}
                className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3.5 shadow-sm ring-1 ring-border"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-success/10">
                  <Trophy size={16} className="text-success" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-card-foreground">{pr.distance_label}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateShort(pr.date)} · {formatPace(pr.pace_min_per_km)} {t("insights.pace")}
                  </p>
                </div>
                <span className="text-base font-bold font-mono text-foreground">
                  {formatTargetTime(pr.time_seconds)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Race Time Predictions */}
      {racePredictions.predictions.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-1.5">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("insights.racePredictions")}
            </h3>
            <InfoTooltip content="Estimated finish times for common race distances, based on your recent best run." />
          </div>
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              {racePredictions.predictions.map((pred) => (
                <div
                  key={pred.distance_label}
                  className="rounded-2xl bg-card px-4 py-3.5 shadow-sm ring-1 ring-border"
                >
                  <div className="flex items-center gap-1.5 mb-2">
                    <Timer size={13} className="text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">{pred.distance_label}</span>
                  </div>
                  <p className="text-base font-bold font-mono text-foreground leading-none mb-0.5">
                    {formatTargetTime(pred.predicted_seconds)}
                  </p>
                  <p className="text-[11px] text-muted-foreground font-mono">
                    {formatPace(pred.predicted_seconds / 60 / pred.distance_km)}/km
                  </p>
                </div>
              ))}
            </div>
            {racePredictions.referenceActivity && (
              <p className="text-[10px] text-muted-foreground px-1">
                {t("insights.basedOn")} {formatDistance(racePredictions.referenceActivity.distance_km)} {t("insights.on")} {formatDateShort(racePredictions.referenceActivity.date)}
              </p>
            )}
          </div>
        </section>
      )}

      {/* Pace Calculator */}
      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("paceCalc.section")}
        </h3>
        <PaceCalculatorCard goals={goals} />
      </section>

      {/* Test Run Benchmarks */}
      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("testRun.benchmarks")}
        </h3>
        {testRunsLoading ? (
          <AppCard padding="lg" className="flex items-center justify-center">
            <Loader2 size={18} className="animate-spin text-muted-foreground" />
          </AppCard>
        ) : testRuns.length === 0 ? (
          <AppCard padding="lg">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10">
                <FlaskConical size={20} className="text-violet-500" />
              </div>
              <p className="text-xs text-muted-foreground flex-1">{t("testRun.noBenchmarks")}</p>
            </div>
          </AppCard>
        ) : (
          <div className="flex flex-col gap-2">
            {/* Latest metrics summary */}
            {(() => {
              const latest = testRuns[0]
              const dm = latest.derived_metrics
              const prev = testRuns.length >= 2 ? testRuns[1] : null
              const vo2delta = dm.estimated_vo2max != null && prev?.derived_metrics.estimated_vo2max != null
                ? dm.estimated_vo2max - prev.derived_metrics.estimated_vo2max
                : null
              const trend = vo2delta != null
                ? vo2delta > 0.5 ? "improving" : vo2delta < -0.5 ? "declining" : "stable"
                : "stable"
              return (
                <AppCard className="space-y-2">
                  <div className="flex items-center gap-2">
                    <FlaskConical size={14} className="text-violet-500" />
                    <span className="text-xs font-medium text-muted-foreground">
                      {TEST_RUN_TYPES.find(tt => tt.value === latest.test_type)?.label ?? latest.test_type}
                      {" · "}
                      {formatDateShort(latest.created_at)}
                    </span>
                    {testRuns.length >= 2 && (
                      <span className={`ml-auto text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                        trend === "improving" ? "bg-success/10 text-success" :
                        trend === "declining" ? "bg-destructive/10 text-destructive" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        {t(trend === "improving" ? "testRun.improving" : trend === "declining" ? "testRun.declining" : "testRun.stable")}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {dm.estimated_vo2max != null && (
                      <div className="text-center">
                        <p className="text-sm font-bold text-card-foreground tabular-nums">
                          {dm.estimated_vo2max.toFixed(1)}
                          {vo2delta != null && (
                            <span className={`ml-1 text-[10px] font-medium ${vo2delta > 0 ? "text-success" : vo2delta < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                              {vo2delta > 0 ? "+" : ""}{vo2delta.toFixed(1)}
                            </span>
                          )}
                        </p>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{t("testRun.vo2max")}</p>
                      </div>
                    )}
                    {dm.threshold_pace != null && (
                      <div className="text-center">
                        <p className="whitespace-nowrap text-sm font-bold text-card-foreground tabular-nums">{formatPace(dm.threshold_pace)}</p>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{t("testRun.thresholdPace")}</p>
                      </div>
                    )}
                    {dm.threshold_hr != null && (
                      <div className="text-center">
                        <p className="text-sm font-bold text-card-foreground tabular-nums">{dm.threshold_hr}</p>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{t("testRun.thresholdHr")}</p>
                      </div>
                    )}
                  </div>
                </AppCard>
              )
            })()}
            {/* Historical list */}
            {testRuns.length > 1 && (
              <AppCard variant="flush">
                {testRuns.slice(1, 6).map((tr, i) => (
                  <div
                    key={tr.id}
                    className={`flex items-center justify-between px-4 py-2.5 ${
                      i < Math.min(testRuns.length - 2, 4) ? "border-b border-border" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <FlaskConical size={12} className="text-violet-400" />
                      <span className="text-xs text-card-foreground">
                        {TEST_RUN_TYPES.find(tt => tt.value === tr.test_type)?.label ?? tr.test_type}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{formatDateShort(tr.created_at)}</span>
                    </div>
                    {tr.derived_metrics.estimated_vo2max != null && (
                      <span className="text-xs font-semibold font-mono text-foreground">
                        {tr.derived_metrics.estimated_vo2max.toFixed(1)}
                      </span>
                    )}
                  </div>
                ))}
              </AppCard>
            )}
          </div>
        )}
      </section>

      {/* Training Calendar */}
      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("calendar.section")}
        </h3>
        <TrainingCalendarCard
          activities={runActivities}
          goals={goals}
          testRuns={testRuns}
          onViewGoal={onViewGoal}
        />
      </section>

      {/* Empty state if no data */}
      {personalRecords.length === 0 && racePredictions.predictions.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
            <Trophy size={24} className="text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground max-w-[260px]">
            {t("insights.emptyState")}
          </p>
        </div>
      )}
    </div>
  )
}
