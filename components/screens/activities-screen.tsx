"use client"

import { useState, useMemo } from "react"
import { ChevronRight, Inbox, RefreshCw, Link, Plus, Search, X, Filter } from "lucide-react"
import { formatDistance, formatDuration, formatPace, formatDateShort } from "@/lib/format"
import { ActivityTypeBadge } from "@/components/activity-type-badge"
import type { Activity, ActivityType } from "@/lib/types"
import { useI18n } from "@/lib/i18n"

interface ActivitiesScreenProps {
  activities: Activity[]
  stravaConnected: boolean
  onSelectActivity: (activity: Activity) => void
  onSync: () => void
  onAddActivity: () => void
}

const ACTIVITY_TYPES: ActivityType[] = ["Run", "Trail Run", "Race", "Walk"]

export function ActivitiesScreen({ activities, stravaConnected, onSelectActivity, onSync, onAddActivity }: ActivitiesScreenProps) {
  const { t } = useI18n()
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedType, setSelectedType] = useState<ActivityType | "all">("all")
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
        <button
          onClick={onAddActivity}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground active:opacity-80 transition-opacity"
          aria-label="Add manual activity"
        >
          <Plus size={18} />
        </button>
      </header>

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
              {ACTIVITY_TYPES.map((type) => (
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
                onClick={onSync}
                className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground active:opacity-80 transition-opacity"
              >
                <RefreshCw size={15} />
                {t("activities.syncStrava")}
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
    </div>
  )
}
