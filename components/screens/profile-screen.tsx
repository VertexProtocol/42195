"use client"

import { useMemo } from "react"
import Image from "next/image"
import { useTheme } from "next-themes"
import { RefreshCw, LogOut, CheckCircle2, AlertCircle, Clock, User, Moon, Sun, Link2, Link2Off, Trophy } from "lucide-react"
import { formatTimeAgo, formatTargetTime, formatPace, formatDateShort } from "@/lib/format"
import { detectPersonalRecords } from "@/lib/training-utils"
import type { Activity, SyncStatus, UserProfile } from "@/lib/types"

interface ProfileScreenProps {
  user: UserProfile
  activities: Activity[]
  syncStatus: SyncStatus
  stravaConnected: boolean
  onSync: () => void
  onFullSync: () => void
  onSignOut: () => void
}

function SyncStatusIndicator({ status }: { status: SyncStatus }) {
  const config = {
    success: {
      icon: CheckCircle2,
      label: "Synced",
      className: "text-success",
      bgClassName: "bg-success/10",
    },
    error: {
      icon: AlertCircle,
      label: "Sync error",
      className: "text-destructive",
      bgClassName: "bg-destructive/10",
    },
    syncing: {
      icon: RefreshCw,
      label: "Syncing...",
      className: "text-primary",
      bgClassName: "bg-primary/10",
    },
    never: {
      icon: Clock,
      label: "Never synced",
      className: "text-muted-foreground",
      bgClassName: "bg-secondary",
    },
  }

  const { icon: Icon, label, className, bgClassName } = config[status.state]

  return (
    <div className="flex items-center gap-2.5">
      <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${bgClassName}`}>
        <Icon
          size={16}
          className={`${className} ${status.state === "syncing" ? "animate-spin" : ""}`}
        />
      </div>
      <div className="flex flex-col">
        <span className={`text-sm font-medium ${className}`}>{label}</span>
        {status.last_sync_at && (
          <span className="text-xs text-muted-foreground">
            {formatTimeAgo(status.last_sync_at)}
          </span>
        )}
      </div>
    </div>
  )
}

export function ProfileScreen({ user, activities, syncStatus, stravaConnected, onSync, onFullSync, onSignOut }: ProfileScreenProps) {
  const { theme, setTheme } = useTheme()
  const isDarkMode = theme === "dark"

  const personalRecords = useMemo(() => detectPersonalRecords(activities), [activities])

  return (
    <div className="flex flex-col gap-6 px-5 pb-6 pt-4">
      <header>
        <h1 className="text-2xl font-bold text-foreground">Profile</h1>
      </header>

      {/* User Info */}
      <section className="flex items-center gap-4 rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          {user.avatar_url ? (
            <Image
              src={user.avatar_url}
              alt={user.display_name}
              width={56}
              height={56}
              className="h-14 w-14 rounded-full object-cover"
              crossOrigin="anonymous"
            />
          ) : (
            <User size={24} className="text-primary" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="truncate text-base font-semibold text-card-foreground">
            {user.display_name}
          </h2>
          <p className="truncate text-sm text-muted-foreground">{user.email}</p>
        </div>
      </section>

      {/* Personal Records */}
      {personalRecords.length > 0 && (
        <section>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Personal Records
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
                    {formatDateShort(pr.date)} · {formatPace(pr.pace_min_per_km)} pace
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

      {/* Appearance */}
      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Appearance
        </h3>
        <div className="rounded-2xl bg-card shadow-sm ring-1 ring-border">
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary">
                {isDarkMode ? (
                  <Moon size={16} className="text-primary" />
                ) : (
                  <Sun size={16} className="text-muted-foreground" />
                )}
              </div>
              <span className="text-sm font-medium text-card-foreground">Dark Mode</span>
            </div>
            <button
              role="switch"
              aria-checked={isDarkMode}
              aria-label="Toggle dark mode"
              onClick={() => setTheme(isDarkMode ? "light" : "dark")}
              className={`relative inline-flex h-[30px] w-[52px] shrink-0 items-center rounded-full transition-colors duration-200 ${
                isDarkMode ? "bg-primary" : "bg-border"
              }`}
            >
              <span
                className={`inline-block h-[26px] w-[26px] rounded-full bg-card shadow-sm transition-transform duration-200 ${
                  isDarkMode ? "translate-x-[24px]" : "translate-x-[2px]"
                }`}
              />
            </button>
          </div>
        </div>
      </section>

      {/* Sync Status */}
      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Strava Sync
        </h3>
        <div className="rounded-2xl bg-card shadow-sm ring-1 ring-border">
          {/* Strava connection indicator */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${stravaConnected ? "bg-success/10" : "bg-secondary"}`}>
                {stravaConnected ? (
                  <Link2 size={16} className="text-success" />
                ) : (
                  <Link2Off size={16} className="text-muted-foreground" />
                )}
              </div>
              <span className={`text-sm font-medium ${stravaConnected ? "text-success" : "text-muted-foreground"}`}>
                {stravaConnected ? "Strava connected" : "Strava not connected"}
              </span>
            </div>
            {!stravaConnected && (
              <a
                href="/api/auth/strava"
                className="text-xs font-semibold text-primary underline underline-offset-2 active:opacity-70"
              >
                Connect
              </a>
            )}
          </div>

          <div className="p-4">
            <SyncStatusIndicator status={syncStatus} />
            {syncStatus.error_message && (
              <div className="mt-2 rounded-lg bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <p>{syncStatus.error_message}</p>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
            <button
              onClick={onSync}
              disabled={!stravaConnected}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-secondary px-4 py-3 text-sm font-semibold text-secondary-foreground active:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RefreshCw size={16} />
              Sync with Strava
            </button>
            <button
              onClick={onFullSync}
              disabled={!stravaConnected}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-medium text-muted-foreground active:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Full re-sync (re-fetch all activities)
            </button>
          </div>
        </div>
      </section>

      {/* Sign Out */}
      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Account
        </h3>
        <button
          onClick={onSignOut}
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-card px-4 py-3 text-sm font-semibold text-destructive shadow-sm ring-1 ring-border active:bg-destructive/5 transition-colors"
        >
          <LogOut size={16} />
          Sign Out
        </button>
      </section>
    </div>
  )
}
