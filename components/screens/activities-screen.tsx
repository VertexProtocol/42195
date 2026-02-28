"use client"

import { ChevronRight, Inbox, RefreshCw, Link } from "lucide-react"
import { formatDistance, formatDuration, formatPace, formatDateShort } from "@/lib/format"
import { ActivityTypeBadge } from "@/components/activity-type-badge"
import type { Activity } from "@/lib/types"

interface ActivitiesScreenProps {
  activities: Activity[]
  stravaConnected: boolean
  onSelectActivity: (activity: Activity) => void
  onSync: () => void
}

export function ActivitiesScreen({ activities, stravaConnected, onSelectActivity, onSync }: ActivitiesScreenProps) {
  return (
    <div className="flex flex-col gap-4 px-5 pb-6 pt-4">
      <header>
        <h1 className="text-2xl font-bold text-foreground">Activities</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {activities.length} {activities.length === 1 ? "activity" : "activities"} synced
        </p>
      </header>

      {activities.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
            <Inbox size={28} className="text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-muted-foreground">No activities yet</p>
          {stravaConnected ? (
            <>
              <p className="text-xs text-muted-foreground">Sync your Strava runs to get started</p>
              <button
                onClick={onSync}
                className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground active:opacity-80 transition-opacity"
              >
                <RefreshCw size={15} />
                Sync from Strava
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">Connect Strava to import your runs</p>
              <a
                href="/api/auth/strava"
                className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground active:opacity-80 transition-opacity"
              >
                <Link size={15} />
                Connect Strava
              </a>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {activities.map((activity) => (
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
