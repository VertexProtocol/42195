"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { ChevronRight, Inbox, RefreshCw, Link, Plus, Search, X, Filter, Check, AlertCircle, ArrowUpDown } from "lucide-react"
import { formatDistance, formatDuration, formatPace, formatDateShort } from "@/lib/format"
import { ActivityTypeBadge } from "@/components/activity-type-badge"
import type { Activity, SyncStatus } from "@/lib/types"
import { useI18n } from "@/lib/i18n"

interface ActivitiesScreenProps {
  activities: Activity[]
  stravaConnected: boolean
  syncStatus: SyncStatus
  onSelectActivity: (activity: Activity) => void
  onSync: () => void
  onAddActivity: () => void
}

type SortOption = "date-desc" | "date-asc" | "distance-desc" | "distance-asc" | "pace-asc" | "pace-desc"

export function ActivitiesScreen({ activities, stravaConnected, syncStatus, onSelectActivity, onSync, onAddActivity }: ActivitiesScreenProps) {
  const { t } = useI18n()
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedType, setSelectedType] = useState<string>("all")
  const [syncSuccess, setSyncSuccess] = useState(false)
  const [sortBy, setSortBy] = useState<SortOption>("date-desc")
  const [showSortMenu, setShowSortMenu] = useState(false)

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

  const filteredAndSortedActivities = useMemo(() => {
    let filtered = activities.filter((activity) => {
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

    // Sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case "date-desc":
          return new Date(b.date).getTime() - new Date(a.date).getTime()
        case "date-asc":
          return new Date(a.date).getTime() - new Date(b.date).getTime()
        case "distance-desc":
          return b.distance_km - a.distance_km
        case "distance-asc":
          return a.distance_km - b.distance_km
        case "pace-asc":
          return (a.pace_min_per_km ?? Infinity) - (b.pace_min_per_km ?? Infinity)
        case "pace-desc":
          return (b.pace_min_per_km ?? Infinity) - (a.pace_min_per_km ?? Infinity)
        default:
          return 0
      }
    })

    return filtered
  }, [activities, searchQuery, selectedType, sortBy])

  const hasActiveFilters = searchQuery.trim() !== "" || selectedType !== "all"

  const getSortLabel = (sort: SortOption) => {
    switch (sort) {
      case "date-desc": return t("activities.newestFirst")
      case "date-asc": return t("activities.oldestFirst")
      case "distance-desc": return t("activities.longestFirst")
      case "distance-asc": return t("activities.shortestFirst")
      case "pace-asc": return t("activities.fastestPace")
      case "pace-desc": return t("activities.slowestPace")
    }
  }

  return (
    <div className="flex flex-col gap-4 px-5 pb-6 pt-4 md:px-8 md:max-w-2xl md:mx-auto">
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
          {/* Search bar with sort */}
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
            <button
              onClick={() => setShowSortMenu(!showSortMenu)}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-muted-foreground active:text-foreground transition-colors"
              aria-label="Sort activities"
            >
              <ArrowUpDown size={16} />
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

          {/* Sort menu */}
          {showSortMenu && (
            <div className="flex flex-wrap gap-2 rounded-xl bg-secondary p-3">
              {(["date-desc", "date-asc", "distance-desc", "distance-asc", "pace-asc", "pace-desc"] as SortOption[]).map((option) => (
                <button
                  key={option}
                  onClick={() => { setSortBy(option); setShowSortMenu(false) }}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    sortBy === option
                      ? "bg-primary text-primary-foreground"
                      : "bg-card text-muted-foreground"
                  }`}
                >
                  {getSortLabel(option)}
                </button>
              ))}
            </div>
          )}

          {/* Results count when filtering */}
          {(hasActiveFilters || sortBy !== "date-desc") && (
            <p className="text-xs text-muted-foreground">
              {t("activities.showing")} {filteredAndSortedActivities.length} {t("activities.of")} {activities.length}
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
      ) : filteredAndSortedActivities.length === 0 && hasActiveFilters ? (
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredAndSortedActivities.map((activity) => (
            <button
              key={activity.id}
              onClick={() => onSelectActivity(activity)}
              className="flex flex-col gap-3 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border text-left active:scale-[0.98] transition-transform"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <ActivityTypeBadge type={activity.type} />
                  <span className="text-xs text-muted-foreground">
                    {formatDateShort(activity.date)}
                  </span>
                </div>
                <ChevronRight size={18} className="text-muted-foreground" />
              </div>
              <div>
                <h3 className="truncate text-sm font-semibold text-card-foreground">
                  {activity.name}
                </h3>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">{t("activities.distance")}</span>
                  <span className="text-sm font-semibold text-foreground">
                    {formatDistance(activity.distance_km)}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">{t("activities.duration")}</span>
                  <span className="text-sm font-semibold text-foreground">
                    {formatDuration(activity.duration_seconds)}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">{t("activities.pace")}</span>
                  <span className="text-sm font-semibold text-foreground">
                    {activity.pace_min_per_km !== null
                      ? formatPace(activity.pace_min_per_km)
                      : "—"}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
