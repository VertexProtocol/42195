"use client"

import { useState } from "react"
import Image from "next/image"
import { useTheme } from "next-themes"
import { RefreshCw, LogOut, CheckCircle2, AlertCircle, Clock, User, Moon, Sun, Link2, Link2Off, Globe } from "lucide-react"
import { formatTimeAgo } from "@/lib/format"
import { useI18n, type Locale } from "@/lib/i18n"
import type { SyncStatus, UserProfile } from "@/lib/types"

interface ProfileScreenProps {
  user: UserProfile
  syncStatus: SyncStatus
  stravaConnected: boolean
  onSync: () => void
  onFullSync: () => void
  onConnectStrava: () => Promise<{ ok: boolean; error?: string }>
  onSignOut: () => void
}

function SyncStatusIndicator({ status }: { status: SyncStatus }) {
  const { t } = useI18n()

  const config = {
    success: {
      icon: CheckCircle2,
      label: t("profile.synced"),
      className: "text-success",
      bgClassName: "bg-success/10",
    },
    error: {
      icon: AlertCircle,
      label: t("profile.syncError"),
      className: "text-destructive",
      bgClassName: "bg-destructive/10",
    },
    syncing: {
      icon: RefreshCw,
      label: t("profile.syncing"),
      className: "text-primary",
      bgClassName: "bg-primary/10",
    },
    never: {
      icon: Clock,
      label: t("profile.neverSynced"),
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

export function ProfileScreen({ user, syncStatus, stravaConnected, onSync, onFullSync, onConnectStrava, onSignOut }: ProfileScreenProps) {
  const { theme, setTheme } = useTheme()
  const isDarkMode = theme === "dark"
  const { locale, setLocale, t } = useI18n()
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)

  async function handleConnect() {
    setConnecting(true)
    setConnectError(null)
    const result = await onConnectStrava()
    if (!result.ok) setConnectError(result.error ?? "Connection failed")
    setConnecting(false)
  }

  return (
    <div className="flex flex-col gap-6 px-5 pb-6 pt-4">
      <header>
        <h1 className="text-2xl font-bold text-foreground">{t("profile.title")}</h1>
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

      {/* Appearance */}
      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("profile.appearance")}
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
              <span className="text-sm font-medium text-card-foreground">{t("profile.darkMode")}</span>
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

      {/* Language */}
      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("profile.language")}
        </h3>
        <div className="rounded-2xl bg-card shadow-sm ring-1 ring-border">
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary">
                <Globe size={16} className="text-muted-foreground" />
              </div>
              <span className="text-sm font-medium text-card-foreground">{t("profile.language")}</span>
            </div>
            <div className="flex items-center gap-1 rounded-full bg-secondary p-0.5">
              {(["en", "no"] as Locale[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setLocale(l)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    locale === l
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground"
                  }`}
                >
                  {l === "en" ? "English" : "Norsk"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Sync Status */}
      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("profile.stravaSync")}
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
                {stravaConnected ? t("profile.stravaConnected") : t("profile.stravaNotConnected")}
              </span>
            </div>
            {!stravaConnected && (
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="flex items-center gap-1.5 text-xs font-semibold text-primary active:opacity-70 disabled:opacity-50"
              >
                {connecting ? (
                  <RefreshCw size={12} className="animate-spin" />
                ) : (
                  <Link2 size={12} />
                )}
                {connecting ? "Connecting…" : t("profile.connect")}
              </button>
            )}
            {connectError && (
              <p className="mt-1 w-full text-xs text-destructive">{connectError}</p>
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
              {t("profile.syncWithStrava")}
            </button>
            <button
              onClick={onFullSync}
              disabled={!stravaConnected}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-medium text-muted-foreground active:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t("profile.fullResync")}
            </button>
          </div>
        </div>
      </section>

      {/* Sign Out */}
      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("profile.account")}
        </h3>
        <button
          onClick={onSignOut}
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-card px-4 py-3 text-sm font-semibold text-destructive shadow-sm ring-1 ring-border active:bg-destructive/5 transition-colors"
        >
          <LogOut size={16} />
          {t("profile.signOut")}
        </button>
      </section>
    </div>
  )
}
