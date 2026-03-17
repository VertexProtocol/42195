"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import Image from "next/image"
import { useTheme } from "next-themes"
import {
  RefreshCw, LogOut, CheckCircle2, AlertCircle, Clock, User, Moon, Sun,
  Link2, Link2Off, Globe, AlertTriangle, Check, RotateCcw, Settings2,
  Shield, Trash2, Heart, Loader2, ChevronDown, ChevronUp, Info, ChevronRight,
} from "lucide-react"
import { ConnectWithStravaButton } from "@/components/strava-brand"
import { formatTimeAgo } from "@/lib/format"
import { useI18n, type Locale } from "@/lib/i18n"
import type { SyncStatus, UserProfile } from "@/lib/types"
import type { HrAnalysisResult } from "@/lib/hr-analysis-engine"

interface ProfileScreenProps {
  user: UserProfile
  syncStatus: SyncStatus
  stravaConnected: boolean
  onSync: () => void
  onFullSync: () => void
  onConnectStrava: () => Promise<{ ok: boolean; error?: string }>
  onSignOut: () => void
  onNavigateToGoals: () => void
}

// HR zone configuration (5-zone model)
const HR_ZONES = [
  { zone: 1, label: "Recovery", color: "var(--chart-1)", pct: "50–60%" },
  { zone: 2, label: "Aerobic", color: "var(--chart-2)", pct: "60–70%" },
  { zone: 3, label: "Tempo", color: "var(--chart-3)", pct: "70–80%" },
  { zone: 4, label: "Threshold", color: "var(--chart-4)", pct: "80–90%" },
  { zone: 5, label: "Max", color: "var(--chart-5)", pct: "90–100%" },
]

export function ProfileScreen({
  user,
  syncStatus,
  stravaConnected,
  onSync,
  onFullSync,
  onConnectStrava,
  onSignOut,
  onNavigateToGoals,
}: ProfileScreenProps) {
  const { theme, setTheme } = useTheme()
  const isDarkMode = theme === "dark"
  const { locale, setLocale, t } = useI18n()
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [showResyncConfirm, setShowResyncConfirm] = useState(false)
  const [syncSuccess, setSyncSuccess] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // HR analysis state
  const [hrAnalysis, setHrAnalysis] = useState<HrAnalysisResult | null>(null)
  const [hrLoading, setHrLoading] = useState(false)
  const [hrExpanded, setHrExpanded] = useState(false)

  const fetchHrAnalysis = useCallback(async () => {
    setHrLoading(true)
    try {
      const res = await fetch("/api/hr-analysis")
      if (res.ok) {
        const data = await res.json()
        setHrAnalysis(data.analysis)
      }
    } catch {}
    setHrLoading(false)
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

  function handleConnect() {
    setConnecting(true)
    setConnectError(null)
    // Always redirect to full OAuth — each user authorises their own Strava account
    window.location.href = "/api/auth/strava"
  }

  function handleReconnect() {
    window.location.href = "/api/auth/strava"
  }

  function handleSync() {
    setSyncSuccess(false)
    onSync()
  }

  function handleFullSync() {
    setShowResyncConfirm(false)
    setSyncSuccess(false)
    onFullSync()
  }

  async function handleDeleteAccount() {
    setIsDeleting(true)
    setDeleteError(null)
    try {
      const res = await fetch("/api/account/delete", { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json()
        setDeleteError(data.error ?? "Failed to delete account")
        setIsDeleting(false)
        return
      }
      // Redirect to login after successful deletion
      window.location.href = "/auth/login"
    } catch {
      setDeleteError("Network error. Please try again.")
      setIsDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 px-5 pb-6 pt-4">
      <header>
        <h1 className="text-2xl font-bold text-foreground">{t("profile.title")}</h1>
      </header>

      {/* ── ACCOUNT ─────────────────────────────────────────── */}
      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("profile.account")}
        </h3>
        <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border">
          {/* User info */}
          <div className="flex items-center gap-4 px-4 py-4 border-b border-border">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10">
              {user.avatar_url ? (
                <Image
                  src={user.avatar_url}
                  alt={user.display_name}
                  width={48}
                  height={48}
                  className="h-12 w-12 rounded-full object-cover"
                  crossOrigin="anonymous"
                />
              ) : (
                <User size={22} className="text-primary" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-semibold text-card-foreground">
                {user.display_name}
              </p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
          </div>

          {/* Sign out */}
          <button
            onClick={onSignOut}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-sm font-medium text-destructive transition-colors active:bg-destructive/5"
          >
            <LogOut size={16} />
            {t("profile.signOut")}
          </button>
        </div>
      </section>

      {/* ── CONNECTED SERVICES ──────────────────────────────── */}
      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("profile.connectedServices")}
        </h3>
        <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border">
          {/* Strava connection row */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${stravaConnected ? "bg-success/10" : "bg-secondary"}`}>
                {stravaConnected ? (
                  <Link2 size={15} className="text-success" />
                ) : (
                  <Link2Off size={15} className="text-muted-foreground" />
                )}
              </div>
              <span className={`text-sm font-medium ${stravaConnected ? "text-success" : "text-muted-foreground"}`}>
                {stravaConnected ? t("profile.stravaConnected") : t("profile.stravaNotConnected")}
              </span>
            </div>
            {stravaConnected ? (
              <button
                onClick={handleReconnect}
                className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground active:opacity-70"
              >
                <RotateCcw size={11} />
                {t("profile.reconnect")}
              </button>
            ) : (
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
          </div>

          {connectError && (
            <div className="border-b border-border px-4 py-2">
              <p className="text-xs text-destructive">{connectError}</p>
            </div>
          )}

          {/* Sync Now button */}
          {stravaConnected && (
            <div className="px-4 py-3">
              <button
                onClick={handleSync}
                disabled={isSyncing}
                className={`flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  syncSuccess
                    ? "bg-success/10 text-success"
                    : "bg-secondary text-secondary-foreground active:bg-accent"
                }`}
              >
                {isSyncing ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    {t("profile.syncing")}
                  </>
                ) : syncSuccess ? (
                  <>
                    <Check size={16} />
                    {t("profile.synced")}
                  </>
                ) : (
                  <>
                    <RefreshCw size={16} />
                    {t("profile.syncWithStrava")}
                  </>
                )}
              </button>

              {syncStatus.state === "error" && syncStatus.error_message && (
                <div className="mt-2 flex items-start gap-2 rounded-lg bg-destructive/5 px-3 py-2">
                  <AlertCircle size={14} className="mt-0.5 shrink-0 text-destructive" />
                  <p className="text-xs text-destructive">{syncStatus.error_message}</p>
                </div>
              )}
            </div>
          )}

          {/* Not connected: official "Connect with Strava" button */}
          {!stravaConnected && (
            <div className="px-4 py-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                Connect Strava to sync your activities automatically.
              </p>
              <ConnectWithStravaButton
                onClick={handleConnect}
                disabled={connecting}
                connecting={connecting}
              />
            </div>
          )}
        </div>
      </section>

      {/* ── SYNC SETTINGS ───────────────────────────────────── */}
      {stravaConnected && (
        <section>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("profile.syncSettings")}
          </h3>
          <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border">
            {/* Last synced */}
            <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
              <div className="flex items-center gap-3">
                <Clock size={16} className="text-muted-foreground" />
                <span className="text-sm text-card-foreground">{t("profile.lastSynced")}</span>
              </div>
              <span className="text-sm text-muted-foreground">
                {syncStatus.last_sync_at
                  ? formatTimeAgo(syncStatus.last_sync_at)
                  : t("profile.neverSynced")}
              </span>
            </div>

            {/* Full Resync */}
            {!showResyncConfirm ? (
              <button
                onClick={() => setShowResyncConfirm(true)}
                disabled={isSyncing}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-sm font-medium text-muted-foreground transition-colors active:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <AlertTriangle size={16} className="text-amber-500" />
                {t("profile.fullResync")}
              </button>
            ) : (
              <div className="bg-amber-500/5 p-4 ring-1 ring-amber-500/20 rounded-b-2xl">
                <div className="flex items-start gap-2 mb-3">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t("profile.fullResyncWarning")}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={handleFullSync}
                    disabled={isSyncing}
                    className="flex min-h-[40px] w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-50"
                  >
                    {isSyncing ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" />
                        {t("profile.syncing")}
                      </>
                    ) : (
                      t("profile.fullResyncConfirm")
                    )}
                  </button>
                  <button
                    onClick={() => setShowResyncConfirm(false)}
                    disabled={isSyncing}
                    className="w-full rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground transition-opacity active:opacity-70 disabled:opacity-50"
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── TRAINING SETTINGS ───────────────────────────────── */}
      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("profile.trainingSettings")}
        </h3>
        <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border">
          {/* HR Zone Calibration */}
          <div className="border-b border-border px-4 py-4">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <Heart size={15} className="text-muted-foreground" />
                <span className="text-sm font-medium text-card-foreground">{t("profile.hrZones")}</span>
              </div>
              {!hrAnalysis && !hrLoading && (
                <button
                  onClick={fetchHrAnalysis}
                  className="text-xs font-medium text-primary active:opacity-70"
                >
                  {t("profile.hrAnalyze")}
                </button>
              )}
              {hrLoading && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
            </div>
            <p className="text-xs text-muted-foreground mb-3">{t("profile.hrZonesDesc")}</p>

            {/* Default zone reference when no analysis */}
            {!hrAnalysis && !hrLoading && (
              <div className="flex gap-1">
                {HR_ZONES.map((z) => (
                  <div key={z.zone} className="flex flex-1 flex-col items-center gap-1">
                    <div
                      className="h-6 w-full rounded-md"
                      style={{ backgroundColor: z.color, opacity: 0.7 }}
                    />
                    <span className="text-[9px] text-muted-foreground font-medium">Z{z.zone}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Analysis Results */}
            {hrAnalysis && (
              <div className="flex flex-col gap-3">
                {/* Calibration Status Badge */}
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    hrAnalysis.calibrationStatus === "well_calibrated"
                      ? "bg-success/10 text-success"
                      : hrAnalysis.calibrationStatus === "slightly_misaligned"
                        ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                        : hrAnalysis.calibrationStatus === "likely_misconfigured"
                          ? "bg-destructive/10 text-destructive"
                          : "bg-muted text-muted-foreground"
                  }`}>
                    {t(`profile.hrStatus_${hrAnalysis.calibrationStatus}` as any)}
                  </span>
                  {hrAnalysis.zonesMatch && hrAnalysis.calibrationStatus !== "insufficient_data" && (
                    <span className="text-[10px] text-success flex items-center gap-0.5">
                      <Check size={10} /> {t("profile.hrZonesMatch")}
                    </span>
                  )}
                </div>

                {/* Key Metrics */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-secondary/50 p-2 text-center">
                    <p className="text-lg font-bold font-mono text-card-foreground">{hrAnalysis.estimatedMaxHr}</p>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{t("profile.hrEstMaxHr")}</p>
                  </div>
                  {hrAnalysis.estimatedThresholdHr != null && (
                    <div className="rounded-lg bg-secondary/50 p-2 text-center">
                      <p className="text-lg font-bold font-mono text-card-foreground">{hrAnalysis.estimatedThresholdHr}</p>
                      <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{t("profile.hrThreshold")}</p>
                    </div>
                  )}
                  <div className="rounded-lg bg-secondary/50 p-2 text-center">
                    <p className="text-lg font-bold font-mono text-card-foreground">{hrAnalysis.dataQuality.activitiesWithHr}</p>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{t("profile.hrActivities")}</p>
                  </div>
                </div>

                {/* Recommended Zones */}
                {hrAnalysis.calibrationStatus !== "insufficient_data" && (
                  <div>
                    <button
                      onClick={() => setHrExpanded(!hrExpanded)}
                      className="flex w-full items-center justify-between py-1 text-xs font-medium text-card-foreground active:opacity-70"
                    >
                      <span>{t("profile.hrRecommendedZones")}</span>
                      {hrExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>

                    {hrExpanded && (
                      <div className="mt-2 flex flex-col gap-2">
                        {/* Zone comparison table */}
                        <div className="overflow-hidden rounded-xl ring-1 ring-border">
                          <div className="grid grid-cols-4 gap-0 bg-secondary/30 px-3 py-1.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                            <span>{t("profile.hrZone")}</span>
                            <span className="text-center">{t("profile.hrCurrent")}</span>
                            <span className="text-center">{t("profile.hrRecommended")}</span>
                            <span className="text-right">{t("profile.hrDiff")}</span>
                          </div>
                          {hrAnalysis.recommendedZones.map((rec, i) => {
                            const cur = hrAnalysis.currentZones[i]
                            const diff = rec.min - cur.min
                            const hasDiff = Math.abs(diff) > 2
                            return (
                              <div
                                key={rec.zone}
                                className={`grid grid-cols-4 gap-0 px-3 py-2 text-xs ${
                                  i < 4 ? "border-b border-border" : ""
                                }`}
                              >
                                <span className="font-medium text-card-foreground">Z{rec.zone} {rec.label}</span>
                                <span className="text-center text-muted-foreground font-mono">{cur.min}–{cur.max}</span>
                                <span className="text-center font-mono text-card-foreground">{rec.min}–{rec.max}</span>
                                <span className={`text-right font-mono ${
                                  hasDiff
                                    ? diff > 0 ? "text-destructive" : "text-success"
                                    : "text-muted-foreground"
                                }`}>
                                  {hasDiff ? (diff > 0 ? `+${diff}` : `${diff}`) : "—"}
                                </span>
                              </div>
                            )
                          })}
                        </div>

                        {/* Explanations */}
                        {hrAnalysis.explanations.length > 0 && (
                          <div className="flex flex-col gap-2">
                            {hrAnalysis.explanations.map((exp, i) => (
                              <div key={i} className="flex gap-2 rounded-lg bg-secondary/30 p-2.5">
                                <Info size={12} className="shrink-0 mt-0.5 text-muted-foreground" />
                                <p className="text-[11px] text-muted-foreground leading-relaxed">{exp}</p>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Strava manual update guidance */}
                        {hrAnalysis.calibrationStatus !== "well_calibrated" && !hrAnalysis.zonesMatch && (
                          <div className="rounded-lg bg-primary/5 p-3 ring-1 ring-primary/10">
                            <p className="text-[11px] font-medium text-card-foreground mb-1">{t("profile.hrStravaGuide")}</p>
                            <p className="text-[10px] text-muted-foreground leading-relaxed">
                              {t("profile.hrStravaGuideDesc")}
                            </p>
                          </div>
                        )}

                        {/* Re-analyze button */}
                        <button
                          onClick={fetchHrAnalysis}
                          disabled={hrLoading}
                          className="flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-medium text-primary active:opacity-70 disabled:opacity-50"
                        >
                          {hrLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                          {t("profile.hrReanalyze")}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Training Preferences — navigates to Goals tab where AI plan prefs live */}
          <button
            onClick={onNavigateToGoals}
            className="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors active:bg-accent"
          >
            <Settings2 size={15} className="shrink-0 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-card-foreground">{t("profile.trainingPreferences")}</p>
              <p className="text-xs text-muted-foreground">{t("profile.trainingPrefsDesc")}</p>
            </div>
            <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
          </button>
        </div>
      </section>

      {/* ── APPEARANCE ──────────────────────────────────────── */}
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

      {/* ── LANGUAGE ────────────────────────────────────────── */}
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

      {/* ── LEGAL & DATA ───────────────────────────────────── */}
      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("profile.legalData")}
        </h3>
        <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border">
          {/* Privacy Policy */}
          <a
            href="/privacy"
            className="flex w-full items-center gap-3 border-b border-border px-4 py-3.5 text-sm font-medium text-card-foreground transition-colors active:bg-accent"
          >
            <Shield size={16} className="text-muted-foreground" />
            {t("profile.privacyPolicy")}
          </a>

          {/* Delete Account */}
          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-sm font-medium text-destructive transition-colors active:bg-destructive/5"
            >
              <Trash2 size={16} />
              {t("profile.deleteAccount")}
            </button>
          ) : (
            <div className="bg-destructive/5 p-4 ring-1 ring-destructive/20 rounded-b-2xl">
              <div className="flex items-start gap-2 mb-3">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-destructive" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t("profile.deleteAccountWarning")}
                </p>
              </div>
              {deleteError && (
                <div className="mb-3 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2">
                  <AlertCircle size={14} className="mt-0.5 shrink-0 text-destructive" />
                  <p className="text-xs text-destructive">{deleteError}</p>
                </div>
              )}
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleDeleteAccount}
                  disabled={isDeleting}
                  className="flex min-h-[40px] w-full items-center justify-center gap-2 rounded-xl bg-destructive px-4 py-2.5 text-sm font-semibold text-destructive-foreground transition-opacity active:opacity-80 disabled:opacity-50"
                >
                  {isDeleting ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      {t("profile.deleting")}
                    </>
                  ) : (
                    t("profile.deleteAccountConfirm")
                  )}
                </button>
                <button
                  onClick={() => { setShowDeleteConfirm(false); setDeleteError(null) }}
                  disabled={isDeleting}
                  className="w-full rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground transition-opacity active:opacity-70 disabled:opacity-50"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
