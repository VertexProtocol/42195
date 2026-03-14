"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { ChevronRight, Inbox, RefreshCw, Link, Plus, Search, X, Filter, Check, AlertCircle, FlaskConical } from "lucide-react"
import { formatDistance, formatDuration, formatPace, formatDateShort } from "@/lib/format"
import { ActivityTypeBadge } from "@/components/activity-type-badge"
import type { Activity, SyncStatus } from "@/lib/types"
import { useI18n } from "@/lib/i18n"
import { PoweredByStrava } from "@/components/strava-brand"

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
      // Type filter
      if (selectedType !== "all" && activity.type !== selectedType) {
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
  }, [activities, searchQuery, selectedType])

  const hasActiveFilters = searchQuery.trim() !== "" || selectedType !== "all"

  return (
    <div className="flex flex-col gap-4 px-5 pb-6 pt-4">
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
        <div className="flex flex-col gap-3">
          {filteredActivities.map((activity) => (
            <button
              key={activity.id}
              onClick={() => onSelectActivity(activity)}
              className="flex items-center gap-4 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border text-left active:scale-[0.98] transition-transform"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <ActivityTypeBadge type={activity.type} />
                  <span className="text-xs text-muted-foreground">
                    {formatDateShort(activity.date)}
                  </span>
                  {testRunActivityIds.has(activity.id) && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-600 dark:text-violet-400 ring-1 ring-violet-500/20">
                      <FlaskConical size={9} />
                      {t("testRun.badge")}
                    </span>
                  )}
                </div>
                <h3 className="mt-1.5 truncate text-sm font-semibold text-card-foreground">
                  {activity.name}
                </h3>
                <div className="mt-2 flex items-center gap-4">
                  <span className="text-sm font-medium text-foreground">
                    {formatDistance(activity.distance_km)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDuration(activity.duration_seconds)}
                  </span>
                  {activity.pace_min_per_km !== null && (
                    <span className="text-xs text-muted-foreground">
                      {formatPace(activity.pace_min_per_km)}
                    </span>
                  )}
                </div>
              </div>
              <ChevronRight size={18} className="shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}

      {/* Strava attribution — required by brand guidelines */}
      {stravaConnected && activities.length > 0 && (
        <PoweredByStrava className="mt-4" />
      )}
    </div>
  )
}
