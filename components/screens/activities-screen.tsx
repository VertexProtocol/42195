"use client"

import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { Inbox, RefreshCw, Link, Plus, Search, X, Filter, Check, AlertCircle, FlaskConical } from "lucide-react"
import type { Activity, SyncStatus } from "@/lib/types"
import { useI18n } from "@/lib/i18n"
import { PoweredByStrava } from "@/components/strava-brand"
import { ActivitiesDataTable } from "@/components/activities-data-table"

interface ActivitiesScreenProps {
  activities: Activity[]
  stravaConnected: boolean
  syncStatus: SyncStatus
  onSelectActivity: (activity: Activity) => void
  onSync: () => void
  onAddActivity: () => void
}

export function ActivitiesScreen({ activities, stravaConnected, syncStatus, onSelectActivity, onSync, onAddActivity }: ActivitiesScreenProps) {
  const { t } = useI18n()
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedType, setSelectedType] = useState<string>("all")
  const [syncSuccess, setSyncSuccess] = useState(false)
  const [testRunActivityIds, setTestRunActivityIds] = useState<Set<string>>(new Set())

  // Fetch which activities are tagged as test runs
  useEffect(() => {
    let cancelled = false
    fetch("/api/test-runs")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!cancelled && data?.test_runs) {
          setTestRunActivityIds(new Set(data.test_runs.map((tr: { activity_id: string }) => tr.activity_id)))
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
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
  const PULL_THRESHOLD = 80

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    // Only enable pull-to-refresh when scrolled to top
    const el = containerRef.current
    if (!el || el.scrollTop > 0 || isSyncing) return
    touchStartY.current = e.touches[0].clientY
    isPulling.current = true
  }, [isSyncing])

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
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type]) => type)
  }, [activities])
  const [showFilters, setShowFilters] = useState(false)

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

  const hasActiveFilters = searchQuery.trim() !== "" || selectedType !== "all"

  return (
    <div
      ref={containerRef}
      className="flex flex-col gap-4 px-5 pb-6 pt-4"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Pull-to-refresh indicator */}
      {pullDistance > 0 && stravaConnected && (
        <div
          className="flex items-center justify-center overflow-hidden transition-opacity"
          style={{ height: pullDistance, opacity: Math.min(pullDistance / PULL_THRESHOLD, 1) }}
        >
          <RefreshCw
            size={20}
            className={`text-muted-foreground transition-transform ${pullDistance >= PULL_THRESHOLD ? "text-primary" : ""}`}
            style={{ transform: `rotate(${pullDistance * 3}deg)` }}
          />
        </div>
      )}
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("activities.title")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {activities.length} {activities.length === 1 ? t("activities.activity") : t("activities.activities")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {stravaConnected && (
            <button
              onClick={() => { setSyncSuccess(false); onSync() }}
              disabled={isSyncing}
              className={`flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                syncSuccess
                  ? "bg-success/10 text-success"
                  : "bg-secondary text-secondary-foreground active:bg-accent"
              }`}
              aria-label="Sync with Strava"
            >
              {isSyncing ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : syncSuccess ? (
                <Check size={13} />
              ) : (
                <RefreshCw size={13} />
              )}
              <span>
                {isSyncing ? t("profile.syncing") : syncSuccess ? t("profile.synced") : t("activities.syncStrava")}
              </span>
            </button>
          )}
          <button
            onClick={onAddActivity}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground active:opacity-80 transition-opacity"
            aria-label="Add manual activity"
          >
            <Plus size={18} />
          </button>
        </div>
      </header>

      {/* Sync error feedback */}
      {syncStatus.state === "error" && syncStatus.error_message && (
        <div className="flex items-start gap-2 rounded-xl bg-destructive/5 px-3 py-2.5 ring-1 ring-destructive/20">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-destructive" />
          <p className="text-xs text-destructive">{syncStatus.error_message}</p>
        </div>
      )}

      {/* Search and Filter */}
      {activities.length > 0 && (
        <div className="flex flex-col gap-3">
          {/* Search bar */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder={t("activities.search")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl bg-secondary py-2.5 pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground active:text-foreground"
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                showFilters || selectedType !== "all"
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground"
              }`}
              aria-label="Toggle filters"
            >
              <Filter size={16} />
            </button>
          </div>

          {/* Filter chips */}
          {showFilters && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedType("all")}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  selectedType === "all"
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground"
                }`}
              >
                {t("activities.allTypes")}
              </button>
              {testRunActivityIds.size > 0 && (
                <button
                  onClick={() => setSelectedType("__test_run__")}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    selectedType === "__test_run__"
                      ? "bg-violet-500 text-white"
                      : "bg-violet-500/10 text-violet-600 dark:text-violet-400"
                  }`}
                >
                  <FlaskConical size={10} />
                  {t("testRun.badge")}
                </button>
              )}
              {activityTypes.map((type) => (
                <button
                  key={type}
                  onClick={() => setSelectedType(type)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    selectedType === type
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          )}

          {/* Results count when filtering */}
          {hasActiveFilters && (
            <p className="text-xs text-muted-foreground">
              {t("activities.showing")} {filteredActivities.length} {t("activities.of")} {activities.length}
            </p>
          )}
        </div>
      )}

      {activities.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
            <Inbox size={28} className="text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-muted-foreground">{t("activities.noActivities")}</p>
          {stravaConnected ? (
            <>
              <p className="text-xs text-muted-foreground">{t("activities.syncDesc")}</p>
              <button
                onClick={() => { setSyncSuccess(false); onSync() }}
                disabled={isSyncing}
                className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground active:opacity-80 transition-opacity disabled:opacity-60"
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
                className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground active:opacity-80 transition-opacity"
              >
                <Link size={15} />
                {t("activities.connectStrava")}
              </a>
            </>
          )}
        </div>
      ) : filteredActivities.length === 0 && hasActiveFilters ? (
        <div className="flex flex-col items-center justify-center gap-3 py-12">
          <p className="text-sm text-muted-foreground">{t("activities.noResults")}</p>
          <button
            onClick={() => { setSearchQuery(""); setSelectedType("all"); }}
            className="text-sm font-medium text-primary"
          >
            {t("activities.clearFilters")}
          </button>
        </div>
      ) : (
        <div className="rounded-2xl bg-card shadow-sm ring-1 ring-border overflow-hidden">
          <ActivitiesDataTable
            activities={filteredActivities}
            testRunActivityIds={testRunActivityIds}
            onSelectActivity={onSelectActivity}
          />
        </div>
      )}

      {/* Strava attribution — required by brand guidelines */}
      {stravaConnected && activities.length > 0 && (
        <PoweredByStrava className="mt-4" />
      )}
    </div>
  )
}
