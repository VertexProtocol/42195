"use client"

import { RefreshCw, LogOut, CheckCircle2, AlertCircle, Clock, User } from "lucide-react"
import { formatTimeAgo } from "@/lib/format"
import type { SyncStatus, UserProfile } from "@/lib/types"

interface ProfileScreenProps {
  user: UserProfile
  syncStatus: SyncStatus
  onSync: () => void
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

export function ProfileScreen({ user, syncStatus, onSync, onSignOut }: ProfileScreenProps) {
  return (
    <div className="flex flex-col gap-6 px-5 pb-28 pt-4">
      <header>
        <h1 className="text-2xl font-bold text-foreground">Profile</h1>
      </header>

      {/* User Info */}
      <section className="flex items-center gap-4 rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          {user.avatar_url ? (
            <img
              src={user.avatar_url}
              alt={user.display_name}
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

      {/* Sync Status */}
      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Strava Sync
        </h3>
        <div className="rounded-2xl bg-card shadow-sm ring-1 ring-border">
          <div className="p-4">
            <SyncStatusIndicator status={syncStatus} />
            {syncStatus.error_message && (
              <p className="mt-2 rounded-lg bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {syncStatus.error_message}
              </p>
            )}
          </div>
          <div className="border-t border-border px-4 py-3">
            <button
              onClick={onSync}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-secondary px-4 py-3 text-sm font-semibold text-secondary-foreground active:bg-accent transition-colors"
            >
              <RefreshCw size={16} />
              Sync with Strava
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
