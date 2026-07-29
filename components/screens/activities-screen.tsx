"use client"

import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import {
  ChevronRight,
  Inbox,
  RefreshCw,
  Link,
  Plus,
  Search,
  X,
  SlidersHorizontal,
  Check,
  AlertCircle,
  FlaskConical,
} from "lucide-react"
import { formatDuration, formatPace } from "@/lib/format"
import { relativeDayLabel, monthKey, monthLabel } from "@/lib/date-labels"
import { ActivityTypeBadge } from "@/components/activity-type-badge"
import { AppCard } from "@/components/ui/app-card"
import type { Activity, SyncStatus } from "@/lib/types"
import { useI18n } from "@/lib/i18n"
import { PoweredByStrava } from "@/components/strava-brand"

/**
 * ActivitiesScreen — the training log.
 *
 * Design notes
 * ────────────
 * · Rows are grouped by month inside one bordered surface with hairline
 *   dividers, instead of one floating card per run. A log is a continuous
 *   record; a stack of separate cards reads as unrelated items.
 * · Distance is right-aligned and tabular, so the decimal points form a
 *   column you can scan down. That column is the whole point of a log.
 * · The type badge only appears for activities that are *not* a plain run.
 *   In a running app "Run" is the default, and a badge that never varies
 *   is decoration, not information.
 * · Dates read "Yesterday" and "Tuesday" near the top of the list and fall
 *   back to a date further down, where the weekday has stopped helping.
 */

const PULL_THRESHOLD = 80

interface ActivitiesScreenProps {
  activities: Activity[]
  stravaConnected: boolean
  syncStatus: SyncStatus
  onSelectActivity: (activity: Activity) => void
  onSync: () => void
  onAddActivity: () => void
}

export function ActivitiesScreen({
  activities,
  stravaConnected,
  syncStatus,
  onSelectActivity,
  onSync,
  onAddActivity,
}: ActivitiesScreenProps) {
  const { t, locale } = useI18n()
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedType, setSelectedType] = useState<string>("all")
  const [syncSuccess, setSyncSuccess] = useState(false)
  const [testRunActivityIds, setTestRunActivityIds] = useState<Set<string>>(new Set())
  const [showFilters, setShowFilters] = useState(false)

  // Fetch which activities are tagged as test runs
  useEffect(() => {
    let cancelled = false
    fetch("/api/test-runs")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.test_runs) {
          setTestRunActivityIds(
            new Set(data.test_runs.map((tr: { activity_id: string }) => tr.activity_id)),
          )
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Detect sync completion for brief success feedback
  const prevSyncStateRef = useRef(syncStatus.state)
  useEffect(() => {
    const prev = prevSyncStateRef.current
    prevSyncStateRef.current = syncStatus.state
    if (prev === "syncing" && syncStatus.state === "success") {
      setSyncSuccess(true)
      const timer = setTimeout(() => setSyncSuccess(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [syncStatus.state])

  const isSyncing = syncStatus.state === "syncing"

  // Pull-to-refresh for mobile
  const containerRef = useRef<HTMLDivElement>(null)
  const touchStartY = useRef(0)
  const [pullDistance, setPullDistance] = useState(0)
  const isPulling = useRef(false)

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      // Only enable pull-to-refresh when scrolled to top
      const el = containerRef.current
      if (!el || el.scrollTop > 0 || isSyncing) return
      touchStartY.current = e.touches[0].clientY
      isPulling.current = true
    },
    [isSyncing],
  )

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling.current) return
    const dy = e.touches[0].clientY - touchStartY.current
    if (dy > 0) {
      // Diminishing returns past threshold
      setPullDistance(Math.min(dy * 0.5, PULL_THRESHOLD * 1.5))
    }
  }, [])

  const onTouchEnd = useCallback(() => {
    if (!isPulling.current) return
    isPulling.current = false
    if (pullDistance >= PULL_THRESHOLD && stravaConnected && !isSyncing) {
      setSyncSuccess(false)
      onSync()
    }
    setPullDistance(0)
  }, [pullDistance, stravaConnected, isSyncing, onSync])

  // Derive filter options from the actual activities — only show types that exist
  const activityTypes = useMemo(() => {
    const counts = new Map<string, number>()
    for (const a of activities) {
      counts.set(a.type, (counts.get(a.type) ?? 0) + 1)
    }
    // Sort by frequency (most common first)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([type]) => type)
  }, [activities])

  const filteredActivities = useMemo(() => {
    return activities.filter((activity) => {
      // Test run filter
      if (selectedType === "__test_run__") {
        if (!testRunActivityIds.has(activity.id)) return false
      } else if (selectedType !== "all" && activity.type !== selectedType) {
        return false
      }
      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase()
        return (
          activity.name.toLowerCase().includes(query) ||
          activity.type.toLowerCase().includes(query)
        )
      }
      return true
    })
  }, [activities, searchQuery, selectedType, testRunActivityIds])

  /**
   * Group into calendar months, preserving the incoming newest-first order.
   * A Map keeps insertion order, so no re-sort is needed.
   */
  const monthGroups = useMemo(() => {
    const groups = new Map<string, { label: string; items: Activity[] }>()
    for (const a of filteredActivities) {
      const key = monthKey(a.date)
      let group = groups.get(key)
      if (!group) {
        group = { label: monthLabel(a.date, locale), items: [] }
        groups.set(key, group)
      }
      group.items.push(a)
    }
    return [...groups.entries()]
  }, [filteredActivities, locale])

  const hasActiveFilters = searchQuery.trim() !== "" || selectedType !== "all"
  const pullProgress = Math.min(pullDistance / PULL_THRESHOLD, 1)
  const willRefresh = pullDistance >= PULL_THRESHOLD

  return (
    <div
      ref={containerRef}
      className="flex flex-col gap-5 px-4 pb-8 pt-5"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Pull-to-refresh indicator */}
      {pullDistance > 0 && stravaConnected && (
        <div
          className="flex flex-col items-center justify-end gap-1 overflow-hidden"
          style={{ height: pullDistance, opacity: pullProgress }}
        >
          <RefreshCw
            size={18}
            className={willRefresh ? "text-primary" : "text-subtle-foreground"}
            style={{ transform: `rotate(${pullDistance * 3}deg)` }}
          />
          <span className="text-[10px] font-medium text-subtle-foreground">
            {willRefresh ? t("activities.releaseToSync") : t("activities.pullToSync")}
          </span>
        </div>
      )}

      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-display text-foreground">
            {t("activities.title")}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            <span className="tnum">{activities.length}</span>{" "}
            {activities.length === 1 ? t("activities.activity") : t("activities.activities")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Icon-only: the labelled variant ran ~185px wide, which on a
              375px screen shoved the page title out of the header. The
              spinner and tick carry the state, and the empty state still
              offers a fully labelled sync button. */}
          {stravaConnected && (
            <button
              onClick={() => {
                setSyncSuccess(false)
                onSync()
              }}
              disabled={isSyncing}
              className={`press flex h-10 w-10 items-center justify-center rounded-xl disabled:cursor-not-allowed disabled:opacity-50 ${
                syncSuccess ? "bg-success-subtle text-success" : "bg-secondary text-secondary-foreground"
              }`}
              aria-label={
                isSyncing ? t("profile.syncing") : syncSuccess ? t("profile.synced") : t("activities.syncStrava")
              }
              title={t("activities.syncStrava")}
            >
              {isSyncing ? (
                <RefreshCw size={16} className="animate-spin" />
              ) : syncSuccess ? (
                <Check size={16} />
              ) : (
                <RefreshCw size={16} />
              )}
            </button>
          )}
          <button
            onClick={onAddActivity}
            className="press flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-e1"
            aria-label={t("activities.addActivity")}
          >
            <Plus size={18} />
          </button>
        </div>
      </header>

      {/* Sync error feedback */}
      {syncStatus.state === "error" && syncStatus.error_message && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive-subtle px-3 py-2.5">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-destructive" />
          <p className="text-xs text-destructive">{syncStatus.error_message}</p>
        </div>
      )}

      {/* Search and filter */}
      {activities.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle-foreground"
              />
              <input
                type="search"
                placeholder={t("activities.search")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label={t("activities.search")}
                className="h-10 w-full rounded-xl bg-secondary pl-9 pr-9 text-sm text-foreground placeholder:text-subtle-foreground focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="press absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground"
                  aria-label={t("activities.clearFilters")}
                >
                  <X size={15} />
                </button>
              )}
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              aria-expanded={showFilters}
              aria-label={t("activities.filters")}
              className={`press flex h-10 w-10 items-center justify-center rounded-xl ${
                showFilters || selectedType !== "all"
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground"
              }`}
            >
              <SlidersHorizontal size={16} />
            </button>
          </div>

          {/* Filter chips — a single scrolling row rather than a wrapping
              block, so opening filters never reflows the list below it. */}
          {showFilters && (
            <div className="animate-rise -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <FilterChip
                active={selectedType === "all"}
                onClick={() => setSelectedType("all")}
                label={t("activities.allTypes")}
              />
              {testRunActivityIds.size > 0 && (
                <FilterChip
                  active={selectedType === "__test_run__"}
                  onClick={() => setSelectedType("__test_run__")}
                  label={t("testRun.badge")}
                  icon={<FlaskConical size={10} />}
                />
              )}
              {activityTypes.map((type) => (
                <FilterChip
                  key={type}
                  active={selectedType === type}
                  onClick={() => setSelectedType(type)}
                  label={type}
                />
              ))}
            </div>
          )}

          {hasActiveFilters && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-subtle-foreground">
                {t("activities.showing")} <span className="tnum">{filteredActivities.length}</span>{" "}
                {t("activities.of")} <span className="tnum">{activities.length}</span>
              </p>
              <button
                onClick={() => {
                  setSearchQuery("")
                  setSelectedType("all")
                }}
                className="press rounded-lg text-xs font-semibold text-primary"
              >
                {t("activities.clearFilters")}
              </button>
            </div>
          )}
        </div>
      )}

      {activities.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
            <Inbox size={28} className="text-muted-foreground" />
          </div>
          <p className="text-sm font-semibold text-foreground">{t("activities.noActivities")}</p>
          {stravaConnected ? (
            <>
              <p className="text-xs text-muted-foreground">{t("activities.syncDesc")}</p>
              <button
                onClick={() => {
                  setSyncSuccess(false)
                  onSync()
                }}
                disabled={isSyncing}
                className="press mt-1 flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-e1 disabled:opacity-60"
              >
                <RefreshCw size={15} className={isSyncing ? "animate-spin" : ""} />
                {isSyncing ? t("profile.syncing") : t("activities.syncStrava")}
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">{t("activities.connectDesc")}</p>
              <a
                href="/api/auth/strava"
                className="press mt-1 flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-e1"
              >
                <Link size={15} />
                {t("activities.connectStrava")}
              </a>
            </>
          )}
        </div>
      ) : filteredActivities.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-12">
          <p className="text-sm text-muted-foreground">{t("activities.noResults")}</p>
          <button
            onClick={() => {
              setSearchQuery("")
              setSelectedType("all")
            }}
            className="press rounded-lg text-sm font-semibold text-primary"
          >
            {t("activities.clearFilters")}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {monthGroups.map(([key, group]) => (
            <section key={key}>
              {/* Sticky against the viewport — the page body is the scroll
                  container — so the month you are reading stays named. */}
              <h2 className="sticky top-0 z-10 -mx-4 bg-background/85 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground backdrop-blur-sm">
                {group.label}
              </h2>
              <AppCard variant="flush">
                {group.items.map((activity, i) => (
                  <ActivityRow
                    key={activity.id}
                    activity={activity}
                    locale={locale}
                    isTestRun={testRunActivityIds.has(activity.id)}
                    testRunLabel={t("testRun.badge")}
                    divided={i > 0}
                    onSelect={onSelectActivity}
                  />
                ))}
              </AppCard>
            </section>
          ))}
        </div>
      )}

      {/* Strava attribution — required by brand guidelines */}
      {stravaConnected && activities.length > 0 && <PoweredByStrava className="mt-2" />}
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean
  onClick: () => void
  label: string
  icon?: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`press inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-secondary text-muted-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function ActivityRow({
  activity,
  locale,
  isTestRun,
  testRunLabel,
  divided,
  onSelect,
}: {
  activity: Activity
  locale: "en" | "no"
  isTestRun: boolean
  testRunLabel: string
  divided: boolean
  onSelect: (a: Activity) => void
}) {
  // "Run" is the default in a running app; a badge that never varies is
  // decoration. Everything else earns its badge.
  const showTypeBadge = activity.type !== "Run"

  return (
    <button
      onClick={() => onSelect(activity)}
      className={`press flex w-full items-center gap-3 px-4 py-3.5 text-left ${
        divided ? "border-t border-border" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        {/* Badges sit on the title line, not the metric line. Sharing a line
            with the badges pushed the pace off the end of the row on any
            activity that had one — and the pace is the reason you opened
            the log. A truncated name costs nothing by comparison. */}
        <div className="flex items-center gap-1.5">
          <h3 className="truncate text-sm font-semibold text-card-foreground">{activity.name}</h3>
          {showTypeBadge && <ActivityTypeBadge type={activity.type} />}
          {isTestRun && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-secondary-foreground">
              <FlaskConical size={9} />
              {testRunLabel}
            </span>
          )}
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          <span>{relativeDayLabel(activity.date, locale)}</span>
          <span className="tnum"> · {formatDuration(activity.duration_seconds)}</span>
          {activity.pace_min_per_km !== null && (
            <span className="tnum"> · {formatPace(activity.pace_min_per_km)}</span>
          )}
        </p>
      </div>

      {/* The scanning column: decimals line up down the list. */}
      <div className="flex shrink-0 items-baseline gap-1">
        <span data-metric className="text-lg font-semibold tracking-display text-card-foreground">
          {activity.distance_km.toFixed(1)}
        </span>
        <span className="text-[10px] font-medium text-subtle-foreground">km</span>
      </div>
      <ChevronRight size={16} className="-mr-1 shrink-0 text-subtle-foreground" />
    </button>
  )
}
