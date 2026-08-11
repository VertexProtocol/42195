"use client"

import { useState, useEffect, useRef, useCallback, useTransition } from "react"
import { useTheme } from "next-themes"
import {
  RefreshCw,
  LogOut,
  TriangleAlert,
  Moon,
  Sun,
  Monitor,
  Link2,
  Link2Off,
  Check,
  RotateCcw,
  Shield,
  Trash2,
  Heart,
  ChevronDown,
  Pencil,
  KeyRound,
  Eye,
  EyeOff,
  User,
  ListChecks,
} from "lucide-react"
import { ConnectWithStravaButton } from "@/components/strava-brand"
import { TrackLoader } from "@/components/ui/track-mark"
import { createClient } from "@/lib/supabase/client"
import { formatTimeAgo } from "@/lib/format"
import { useI18n, type Locale } from "@/lib/i18n"
import type { SyncStatus, UserProfile } from "@/lib/types"
import type { HrAnalysisResult } from "@/lib/hr-analysis-engine"
import { AppCard, CardRow } from "@/components/ui/app-card"
import { Section, SectionHeader } from "@/components/ui/section"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Pill } from "@/components/ui/pill"

/**
 * Profile — account, connections, calibration, appearance, and the two
 * irreversible actions, in that order of frequency.
 *
 * Destructive and irreversible steps confirm inline, on the row they belong
 * to, rather than in a modal: a settings page is exactly the surface where a
 * modal is the lazy answer.
 */

/**
 * Caches written by the previous engine hold English sentences in
 * `explanations` and no `maxHrSource`. Rendering one would print raw
 * translation keys, so a stale-shaped cache is treated as no cache at all and
 * the analysis is simply re-run. This keeps a code deploy safe regardless of
 * whether the 025 migration (which clears the caches) has run yet.
 */
function usableCache(cached: HrAnalysisResult | null | undefined): HrAnalysisResult | null {
  if (!cached) return null
  if (typeof cached.maxHrSource !== "string") return null
  if (typeof cached.analysisBasis !== "string") return null
  if (!Array.isArray(cached.explanations)) return null
  if (cached.explanations.some((e) => typeof e?.code !== "string")) return null
  return cached
}

interface ProfileScreenProps {
  user: UserProfile
  syncStatus: SyncStatus
  stravaConnected: boolean
  onSync: () => void
  onFullSync: () => void
  onConnectStrava: () => Promise<{ ok: boolean; error?: string }>
  onSignOut: () => void
  /** Reopen the "Get started" checklist and go to the screen it lives on. */
  onOpenGetStarted: () => void
}

export function ProfileScreen({
  user,
  syncStatus,
  stravaConnected,
  onSync,
  onFullSync,
  onSignOut,
  onOpenGetStarted,
}: ProfileScreenProps) {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const { locale, setLocale, t } = useI18n()

  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const [connecting, setConnecting] = useState(false)
  const [showResyncConfirm, setShowResyncConfirm] = useState(false)
  const [syncSuccess, setSyncSuccess] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [hrAnalysis, setHrAnalysis] = useState<HrAnalysisResult | null>(
    usableCache(user.hr_analysis_cache),
  )
  const [hrLoading, setHrLoading] = useState(false)
  const [hrExpanded, setHrExpanded] = useState(false)
  const [hrError, setHrError] = useState<string | null>(null)

  // The athlete's own max/resting HR. Null means "not set" — the card then
  // reports its estimate rather than claiming the setup is wrong.
  const [maxHr, setMaxHr] = useState<number | null>(user.max_hr ?? null)
  const [restingHr, setRestingHr] = useState<number | null>(user.resting_hr ?? null)
  const [editingHr, setEditingHr] = useState(false)
  const [maxHrDraft, setMaxHrDraft] = useState(user.max_hr != null ? String(user.max_hr) : "")
  const [restingHrDraft, setRestingHrDraft] = useState(
    user.resting_hr != null ? String(user.resting_hr) : "",
  )
  const [hrSettingsError, setHrSettingsError] = useState<string | null>(null)
  const [hrSettingsPending, startHrSettingsTransition] = useTransition()

  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(user.display_name)
  const [nameError, setNameError] = useState<string | null>(null)
  const [namePending, startNameTransition] = useTransition()

  const [showChangePassword, setShowChangePassword] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwSuccess, setPwSuccess] = useState(false)
  const [pwPending, startPwTransition] = useTransition()
  const [showPw, setShowPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)

  const [displayedName, setDisplayedName] = useState(user.display_name)

  const fetchHrAnalysis = useCallback(async () => {
    setHrLoading(true)
    setHrError(null)
    try {
      const res = await fetch("/api/hr-analysis")
      if (res.ok) {
        const data = await res.json()
        setHrAnalysis(data.analysis)
      } else {
        setHrError(t("profile.hrError"))
      }
    } catch {
      setHrError(t("profile.hrError"))
    }
    setHrLoading(false)
  }, [t])

  useEffect(() => {
    if (!hrAnalysis) fetchHrAnalysis()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function openHrEditor() {
    setMaxHrDraft(maxHr != null ? String(maxHr) : "")
    setRestingHrDraft(restingHr != null ? String(restingHr) : "")
    setHrSettingsError(null)
    setEditingHr(true)
  }

  /**
   * Saves the athlete's HR values and re-runs the analysis against them.
   * Empty input clears the value back to "not set" rather than being rejected,
   * so a wrong figure can always be taken back out.
   */
  function handleSaveHrSettings(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const parse = (raw: string): number | null => {
      const trimmed = raw.trim()
      return trimmed === "" ? null : Number(trimmed)
    }
    const nextMax = parse(maxHrDraft)
    const nextResting = parse(restingHrDraft)

    // Mirrors the DB check constraints, so a bad value is caught here rather
    // than coming back as a Postgres error string.
    if (nextMax != null && (!Number.isFinite(nextMax) || nextMax < 120 || nextMax > 230)) {
      setHrSettingsError(t("profile.hrMaxHrRange"))
      return
    }
    if (
      nextResting != null &&
      (!Number.isFinite(nextResting) || nextResting < 25 || nextResting > 110)
    ) {
      setHrSettingsError(t("profile.hrRestingHrRange"))
      return
    }

    setHrSettingsError(null)
    startHrSettingsTransition(async () => {
      const supabase = createClient()
      const { error } = await supabase
        .from("profiles")
        .update({
          max_hr: nextMax != null ? Math.round(nextMax) : null,
          resting_hr: nextResting != null ? Math.round(nextResting) : null,
        })
        .eq("id", user.id)
      if (error) {
        setHrSettingsError(t("profile.hrSaveFailed"))
        return
      }
      setMaxHr(nextMax != null ? Math.round(nextMax) : null)
      setRestingHr(nextResting != null ? Math.round(nextResting) : null)
      setEditingHr(false)
      // The verdict is a function of these values, so it is stale the moment
      // they change.
      fetchHrAnalysis()
    })
  }

  function handleSaveName(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmed = nameValue.trim()
    if (trimmed.length < 2) {
      setNameError(t("profile.nameTooShort"))
      return
    }
    setNameError(null)
    startNameTransition(async () => {
      const supabase = createClient()
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: trimmed })
        .eq("id", user.id)
      if (error) {
        setNameError(error.message)
        return
      }
      setDisplayedName(trimmed)
      setEditingName(false)
    })
  }

  function handleChangePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const pw = fd.get("new_password") as string
    const confirm = fd.get("confirm_password") as string
    setPwError(null)
    setPwSuccess(false)
    if (pw !== confirm) {
      setPwError(t("profile.passwordMismatch"))
      return
    }
    if (pw.length < 8) {
      setPwError(t("profile.passwordTooShort"))
      return
    }
    startPwTransition(async () => {
      const supabase = createClient()
      const { error } = await supabase.auth.updateUser({ password: pw })
      if (error) {
        setPwError(error.message)
        return
      }
      setPwSuccess(true)
      setTimeout(() => {
        setShowChangePassword(false)
        setPwSuccess(false)
      }, 2000)
    })
  }

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

  // A partial sync is still in flight from the runner's point of view — the
  // client is fetching the next chunk of history.
  const isSyncing = syncStatus.state === "syncing" || syncStatus.state === "partial"

  function handleConnect() {
    setConnecting(true)
    // Every user authorises their own Strava account, so this is always the
    // full OAuth redirect.
    window.location.href = "/api/auth/strava"
  }

  async function handleDeleteAccount() {
    setIsDeleting(true)
    setDeleteError(null)
    try {
      const res = await fetch("/api/account/delete", { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setDeleteError(data.error ?? t("profile.deleteFailed"))
        setIsDeleting(false)
        return
      }
      window.location.href = "/auth/login"
    } catch {
      setDeleteError(t("profile.networkError"))
      setIsDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-7 px-4 pb-8 screen-body">
      {/* ── Identity ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3.5">
        {user.avatar_url ? (
          // See the note in app-bar.tsx: the avatar host is provider-supplied,
          // so this deliberately bypasses next/image.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatar_url}
            alt=""
            width={56}
            height={56}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="size-14 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-muted-foreground">
            <User size={24} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          {editingName ? (
            <form onSubmit={handleSaveName} className="flex items-center gap-2">
              <Input
                autoFocus
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                aria-label={t("profile.editName")}
                aria-invalid={nameError ? true : undefined}
                className="h-10"
              />
              <Button type="submit" size="sm" loading={namePending}>
                {t("profile.saveName")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditingName(false)
                  setNameValue(displayedName)
                  setNameError(null)
                }}
              >
                {t("common.cancel")}
              </Button>
            </form>
          ) : (
            <div className="flex items-center gap-1.5">
              <p className="truncate text-title font-semibold text-foreground">{displayedName}</p>
              <button
                onClick={() => {
                  setEditingName(true)
                  setNameValue(displayedName)
                }}
                className="press flex size-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                aria-label={t("profile.editName")}
              >
                <Pencil size={14} />
              </button>
            </div>
          )}
          {nameError && (
            <p role="alert" className="mt-1 text-micro text-destructive">
              {nameError}
            </p>
          )}
          <p className="truncate text-label text-muted-foreground">{user.email}</p>
        </div>
      </div>

      {/* ── Strava ────────────────────────────────────────────────────── */}
      <Section>
        <SectionHeader title={t("profile.connectedServices")} />
        <AppCard variant="rows">
          <CardRow className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              {stravaConnected ? (
                <Link2 size={16} className="shrink-0 text-success" aria-hidden />
              ) : (
                <Link2Off size={16} className="shrink-0 text-muted-foreground" aria-hidden />
              )}
              <span className="truncate text-label font-medium text-card-foreground">
                {stravaConnected ? t("profile.stravaConnected") : t("profile.stravaNotConnected")}
              </span>
            </div>
            {stravaConnected && (
              <Button variant="ghost" size="sm" onClick={handleConnect}>
                <RotateCcw size={13} />
                {t("profile.reconnect")}
              </Button>
            )}
          </CardRow>

          {stravaConnected ? (
            <>
              <CardRow className="flex items-center justify-between gap-3">
                <span className="text-label text-card-foreground">{t("profile.lastSynced")}</span>
                <span className="text-label text-muted-foreground">
                  {syncStatus.last_sync_at
                    ? formatTimeAgo(syncStatus.last_sync_at)
                    : t("profile.neverSynced")}
                </span>
              </CardRow>

              <CardRow>
                <Button
                  variant={syncSuccess ? "outline" : "secondary"}
                  block
                  onClick={() => {
                    setSyncSuccess(false)
                    onSync()
                  }}
                  loading={isSyncing}
                >
                  {!isSyncing && (syncSuccess ? <Check size={16} /> : <RefreshCw size={16} />)}
                  {isSyncing
                    ? t("profile.syncing")
                    : syncSuccess
                      ? t("profile.synced")
                      : t("profile.syncWithStrava")}
                </Button>

                {syncStatus.state === "error" && syncStatus.error_message && (
                  <p role="alert" className="mt-2 text-micro text-destructive">
                    {syncStatus.error_message}
                  </p>
                )}

                {syncStatus.state === "rate_limited" && syncStatus.error_message && (
                  <p role="status" className="mt-2 text-micro text-muted-foreground">
                    {syncStatus.error_message}
                  </p>
                )}
              </CardRow>

              <CardRow>
                {!showResyncConfirm ? (
                  <Button
                    variant="ghost"
                    block
                    className="justify-start px-0 text-muted-foreground"
                    disabled={isSyncing}
                    onClick={() => setShowResyncConfirm(true)}
                  >
                    <TriangleAlert size={16} className="text-warning" />
                    {t("profile.fullResync")}
                  </Button>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    <p className="text-label leading-relaxed text-muted-foreground">
                      {t("profile.fullResyncWarning")}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        loading={isSyncing}
                        onClick={() => {
                          setShowResyncConfirm(false)
                          setSyncSuccess(false)
                          onFullSync()
                        }}
                      >
                        {t("profile.fullResyncConfirm")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isSyncing}
                        onClick={() => setShowResyncConfirm(false)}
                      >
                        {t("common.cancel")}
                      </Button>
                    </div>
                  </div>
                )}
              </CardRow>
            </>
          ) : (
            <CardRow className="flex flex-col gap-2.5">
              <p className="text-label leading-relaxed text-muted-foreground">
                {t("profile.stravaConnectBlurb")}
              </p>
              <ConnectWithStravaButton
                onClick={handleConnect}
                disabled={connecting}
                connecting={connecting}
              />
            </CardRow>
          )}
        </AppCard>
      </Section>

      {/* ── Heart-rate calibration ────────────────────────────────────── */}
      <Section>
        <SectionHeader title={t("profile.trainingSettings")} />
        <AppCard>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-label font-semibold text-card-foreground">
                <Heart size={15} className="text-muted-foreground" aria-hidden />
                {t("profile.hrZones")}
              </p>
              <p className="mt-1 max-w-[46ch] text-micro leading-relaxed text-muted-foreground">
                {t("profile.hrZonesDesc")}
              </p>
            </div>
            {hrLoading ? (
              <TrackLoader size={14} className="mt-1 text-muted-foreground" />
            ) : (
              <Button variant="ghost" size="sm" onClick={fetchHrAnalysis}>
                {hrAnalysis ? t("profile.hrReanalyze") : t("profile.hrAnalyze")}
              </Button>
            )}
          </div>

          {hrError && (
            <p role="alert" className="mt-3 text-micro text-destructive">
              {hrError}
            </p>
          )}

          {/* Your values — what the whole card is judged against. */}
          <div className="mt-4 rounded-md bg-surface-sunken p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-micro font-semibold text-card-foreground">
                  {t("profile.hrSettings")}
                </p>
                <p className="mt-0.5 max-w-[46ch] text-micro leading-relaxed text-muted-foreground">
                  {t("profile.hrSettingsDesc")}
                </p>
              </div>
              {!editingHr && (
                <Button variant="ghost" size="sm" onClick={openHrEditor}>
                  {t("profile.hrEdit")}
                </Button>
              )}
            </div>

            {editingHr ? (
              <form onSubmit={handleSaveHrSettings} className="mt-3 flex flex-col gap-2.5">
                <div className="grid grid-cols-2 gap-2.5">
                  <label className="flex flex-col gap-1 text-micro text-muted-foreground">
                    {t("profile.hrMaxHrLabel")}
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={120}
                      max={230}
                      value={maxHrDraft}
                      onChange={(e) => setMaxHrDraft(e.target.value)}
                      placeholder={t("profile.hrNotSet")}
                      disabled={hrSettingsPending}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-micro text-muted-foreground">
                    {t("profile.hrRestingHrLabel")}
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={25}
                      max={110}
                      value={restingHrDraft}
                      onChange={(e) => setRestingHrDraft(e.target.value)}
                      placeholder={t("profile.hrNotSet")}
                      disabled={hrSettingsPending}
                    />
                  </label>
                </div>

                {/* One tap to adopt the figure the analysis already derived. */}
                {hrAnalysis && hrAnalysis.calibrationStatus !== "insufficient_data" && (
                  <button
                    type="button"
                    onClick={() => setMaxHrDraft(String(hrAnalysis.estimatedMaxHr))}
                    className="press self-start text-micro text-muted-foreground underline underline-offset-2"
                  >
                    {t("profile.hrUseEstimate", { value: hrAnalysis.estimatedMaxHr })}
                  </button>
                )}

                {hrSettingsError && (
                  <p role="alert" className="text-micro text-destructive">
                    {hrSettingsError}
                  </p>
                )}

                <div className="flex items-center gap-2">
                  <Button type="submit" size="sm" disabled={hrSettingsPending}>
                    {t("profile.hrSave")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingHr(false)
                      setHrSettingsError(null)
                    }}
                    disabled={hrSettingsPending}
                  >
                    {t("profile.hrCancel")}
                  </Button>
                </div>
              </form>
            ) : (
              <dl className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1 text-micro">
                <div className="flex items-baseline gap-1.5">
                  <dt className="text-muted-foreground">{t("profile.hrMaxHrLabel")}</dt>
                  <dd className="measure font-semibold text-card-foreground">
                    {maxHr ?? t("profile.hrNotSet")}
                  </dd>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <dt className="text-muted-foreground">{t("profile.hrRestingHrLabel")}</dt>
                  <dd className="measure font-semibold text-card-foreground">
                    {restingHr ?? t("profile.hrNotSet")}
                  </dd>
                </div>
              </dl>
            )}
          </div>

          {hrAnalysis && (
            <div className="mt-4 flex flex-col gap-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <Pill
                  tone={
                    hrAnalysis.calibrationStatus === "well_calibrated"
                      ? "positive"
                      : hrAnalysis.calibrationStatus === "slightly_misaligned"
                        ? "caution"
                        : hrAnalysis.calibrationStatus === "likely_misconfigured"
                          ? "negative"
                          : "neutral"
                  }
                >
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {t(`profile.hrStatus_${hrAnalysis.calibrationStatus}` as any)}
                </Pill>
                {/* Only meaningful when there are two zone sets to agree. */}
                {hrAnalysis.zonesMatch &&
                  hrAnalysis.configuredMaxHr != null &&
                  hrAnalysis.calibrationStatus !== "insufficient_data" && (
                    <span className="inline-flex items-center gap-1 text-micro text-success">
                      <Check size={12} aria-hidden /> {t("profile.hrZonesMatch")}
                    </span>
                  )}
                <span className="text-micro text-muted-foreground">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {t(`profile.hrModel_${hrAnalysis.zoneModel}` as any)}
                </span>
              </div>

              <dl className="grid grid-cols-3 gap-x-4">
                <div>
                  <dd className="measure text-title font-semibold leading-none text-card-foreground">
                    {hrAnalysis.estimatedMaxHr}
                  </dd>
                  <dt className="mt-1.5 text-micro text-muted-foreground">
                    {/* A recorded peak is a measurement; an inferred one is not,
                        and the label says which. */}
                    {hrAnalysis.maxHrSource === "recorded_peaks"
                      ? t("profile.hrMaxHr")
                      : t("profile.hrEstMaxHr")}
                  </dt>
                </div>
                {hrAnalysis.estimatedThresholdHr != null && (
                  <div className="border-l border-border pl-4">
                    <dd className="measure text-title font-semibold leading-none text-card-foreground">
                      {hrAnalysis.estimatedThresholdHr}
                    </dd>
                    <dt className="mt-1.5 text-micro text-muted-foreground">
                      {t("profile.hrThreshold")}
                    </dt>
                  </div>
                )}
                <div className="border-l border-border pl-4">
                  <dd className="measure text-title font-semibold leading-none text-card-foreground">
                    {hrAnalysis.dataQuality.activitiesWithHr}
                  </dd>
                  <dt className="mt-1.5 text-micro text-muted-foreground">
                    {/* Name what was counted: with a run-only basis this is a
                        run count, not the whole history. */}
                    {hrAnalysis.analysisBasis === "runs"
                      ? t("profile.hrRuns")
                      : t("profile.hrActivities")}
                  </dt>
                </div>
              </dl>

              {hrAnalysis.calibrationStatus !== "insufficient_data" && (
                <div>
                  <button
                    onClick={() => setHrExpanded(!hrExpanded)}
                    aria-expanded={hrExpanded}
                    className="press flex w-full items-center justify-between rounded-sm py-1 text-label font-medium text-card-foreground"
                  >
                    <span>
                      {hrAnalysis.configuredMaxHr != null
                        ? t("profile.hrRecommendedZones")
                        : t("profile.hrYourZones")}
                    </span>
                    <ChevronDown
                      size={15}
                      aria-hidden
                      className="text-muted-foreground"
                      style={{
                        transform: hrExpanded ? "rotate(180deg)" : "none",
                        transition: "transform var(--dur-state) var(--ease-out)",
                      }}
                    />
                  </button>

                  {hrExpanded && (
                    <div className="mt-2.5 flex flex-col gap-3">
                      {/* With no configured max HR there is only one zone set,
                          so a Current/Rec/Diff layout would compare a column
                          against a copy of itself. */}
                      <table className="w-full text-micro">
                        <caption className="sr-only">
                          {hrAnalysis.configuredMaxHr != null
                            ? t("profile.hrRecommendedZones")
                            : t("profile.hrYourZones")}
                        </caption>
                        <thead>
                          <tr className="text-muted-foreground">
                            <th scope="col" className="pb-1.5 text-left font-medium">
                              {t("profile.hrZone")}
                            </th>
                            {hrAnalysis.configuredMaxHr != null ? (
                              <>
                                <th scope="col" className="pb-1.5 text-right font-medium">
                                  {t("profile.hrCurrent")}
                                </th>
                                <th scope="col" className="pb-1.5 text-right font-medium">
                                  {t("profile.hrRecommended")}
                                </th>
                                <th scope="col" className="pb-1.5 text-right font-medium">
                                  {t("profile.hrDiff")}
                                </th>
                              </>
                            ) : (
                              <th scope="col" className="pb-1.5 text-right font-medium">
                                {t("profile.hrRange")}
                              </th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {hrAnalysis.recommendedZones.map((rec, i) => {
                            const cur = hrAnalysis.currentZones[i]
                            const diff = rec.min - cur.min
                            const hasDiff = Math.abs(diff) > 2
                            return (
                              <tr key={rec.zone} className="border-t border-border">
                                <th
                                  scope="row"
                                  className="py-2 text-left font-medium text-card-foreground"
                                >
                                  Z{rec.zone} {rec.label}
                                </th>
                                {hrAnalysis.configuredMaxHr != null ? (
                                  <>
                                    <td className="measure py-2 text-right text-muted-foreground">
                                      {cur.min}–{cur.max}
                                    </td>
                                    <td className="measure py-2 text-right text-card-foreground">
                                      {rec.min}–{rec.max}
                                    </td>
                                    <td
                                      className={`measure py-2 text-right ${
                                        hasDiff
                                          ? diff > 0
                                            ? "text-destructive"
                                            : "text-success"
                                          : "text-muted-foreground"
                                      }`}
                                    >
                                      {hasDiff ? (diff > 0 ? `+${diff}` : `${diff}`) : "—"}
                                    </td>
                                  </>
                                ) : (
                                  <td className="measure py-2 text-right text-card-foreground">
                                    {rec.min}–{rec.max}
                                  </td>
                                )}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>

                      {hrAnalysis.explanations.length > 0 && (
                        <ul className="flex flex-col gap-1.5">
                          {hrAnalysis.explanations.map((exp, i) => (
                            <li
                              key={`${exp.code}-${i}`}
                              className="text-micro leading-relaxed text-muted-foreground"
                            >
                              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                              {t(`profile.hrExp_${exp.code}` as any, exp.params)}
                            </li>
                          ))}
                        </ul>
                      )}

                      {/* Only worth showing when there is a real disagreement
                          with a value the athlete actually set. */}
                      {hrAnalysis.configuredMaxHr != null &&
                        hrAnalysis.calibrationStatus !== "well_calibrated" &&
                        !hrAnalysis.zonesMatch && (
                          <div className="rounded-md bg-surface-sunken p-3">
                            <p className="text-micro font-semibold text-card-foreground">
                              {t("profile.hrStravaGuide")}
                            </p>
                            <p className="mt-1 text-micro leading-relaxed text-muted-foreground">
                              {t("profile.hrStravaGuideDesc")}
                            </p>
                          </div>
                        )}

                      <p className="text-micro text-muted-foreground">
                        {t("profile.hrAnalyzedAt", {
                          when: formatTimeAgo(hrAnalysis.analyzedAt),
                        })}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </AppCard>
      </Section>

      {/* ── Appearance and language ───────────────────────────────────── */}
      <Section>
        <SectionHeader title={t("profile.appearance")} />
        <AppCard variant="rows">
          <CardRow className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2.5 text-label font-medium text-card-foreground">
              {mounted && resolvedTheme === "dark" ? (
                <Moon size={16} className="text-muted-foreground" aria-hidden />
              ) : (
                <Sun size={16} className="text-muted-foreground" aria-hidden />
              )}
              {t("profile.theme")}
            </span>
            {/* Three states, not a two-state switch: "follow the system" is a
                real preference and the old toggle could not express it. */}
            <div
              className="flex items-center gap-0.5 rounded-full bg-surface-sunken p-0.5"
              role="group"
              aria-label={t("profile.theme")}
            >
              {(
                [
                  ["light", Sun, t("profile.themeLight")],
                  ["dark", Moon, t("profile.themeDark")],
                  ["system", Monitor, t("profile.themeSystem")],
                ] as const
              ).map(([value, Icon, label]) => {
                const active = mounted && theme === value
                return (
                  <button
                    key={value}
                    onClick={() => setTheme(value)}
                    aria-pressed={active}
                    aria-label={label}
                    title={label}
                    className={`press flex size-8 items-center justify-center rounded-full ${
                      active
                        ? "bg-card text-foreground shadow-e1"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon size={15} />
                  </button>
                )
              })}
            </div>
          </CardRow>

          <CardRow className="flex items-center justify-between gap-3">
            <span className="text-label font-medium text-card-foreground">
              {t("profile.language")}
            </span>
            <div
              className="flex items-center gap-0.5 rounded-full bg-surface-sunken p-0.5"
              role="group"
              aria-label={t("profile.language")}
            >
              {(["en", "no"] as Locale[]).map((l) => (
                <button
                  key={l}
                  onClick={() => {
                    setLocale(l)
                    createClient().from("profiles").update({ locale: l }).eq("id", user.id)
                  }}
                  aria-pressed={locale === l}
                  className={`press rounded-full px-3 py-1.5 text-micro font-semibold ${
                    locale === l
                      ? "bg-card text-foreground shadow-e1"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {l === "en" ? "English" : "Norsk"}
                </button>
              ))}
            </div>
          </CardRow>
        </AppCard>
      </Section>

      {/* ── Security ──────────────────────────────────────────────────── */}
      <Section>
        <SectionHeader title={t("profile.account")} />
        <AppCard variant="rows">
          {/* The checklist can be closed at any point, so it needs a way back
              that does not depend on the account still being unfinished. */}
          <CardRow className="p-0">
            <button
              onClick={onOpenGetStarted}
              className="press flex w-full items-center gap-2.5 px-4 py-3.5 text-left text-label font-medium text-card-foreground"
            >
              <ListChecks size={16} className="text-muted-foreground" aria-hidden />
              {t("getStarted.title")}
            </button>
          </CardRow>

          {!showChangePassword ? (
            <CardRow className="p-0">
              <button
                onClick={() => {
                  setShowChangePassword(true)
                  setPwError(null)
                  setPwSuccess(false)
                }}
                className="press flex w-full items-center gap-2.5 px-4 py-3.5 text-left text-label font-medium text-card-foreground"
              >
                <KeyRound size={16} className="text-muted-foreground" aria-hidden />
                {t("profile.changePassword")}
              </button>
            </CardRow>
          ) : (
            <CardRow>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-label font-semibold text-card-foreground">
                  {t("profile.changePassword")}
                </span>
                <Button variant="ghost" size="sm" onClick={() => setShowChangePassword(false)}>
                  {t("common.cancel")}
                </Button>
              </div>
              {pwSuccess ? (
                <p className="flex items-center gap-1.5 text-label text-success" role="status">
                  <Check size={15} aria-hidden /> {t("profile.passwordUpdated")}
                </p>
              ) : (
                <form onSubmit={handleChangePassword} className="flex flex-col gap-3">
                  {pwError && (
                    <p role="alert" className="text-micro text-destructive">
                      {pwError}
                    </p>
                  )}
                  <PasswordField
                    id="new_password"
                    label={t("auth.newPasswordLabel")}
                    visible={showPw}
                    onToggle={() => setShowPw(!showPw)}
                    showLabel={t("auth.showPassword")}
                    hideLabel={t("auth.hidePassword")}
                  />
                  <PasswordField
                    id="confirm_password"
                    label={t("auth.confirmPasswordLabel")}
                    visible={showConfirmPw}
                    onToggle={() => setShowConfirmPw(!showConfirmPw)}
                    showLabel={t("auth.showPassword")}
                    hideLabel={t("auth.hidePassword")}
                  />
                  <Button type="submit" block loading={pwPending}>
                    {t("auth.updatePassword")}
                  </Button>
                </form>
              )}
            </CardRow>
          )}

          <CardRow className="p-0">
            <a
              href="/privacy"
              className="press flex w-full items-center gap-2.5 px-4 py-3.5 text-label font-medium text-card-foreground"
            >
              <Shield size={16} className="text-muted-foreground" aria-hidden />
              {t("profile.privacyPolicy")}
            </a>
          </CardRow>

          <CardRow className="p-0">
            <button
              onClick={onSignOut}
              className="press flex w-full items-center gap-2.5 px-4 py-3.5 text-left text-label font-medium text-card-foreground"
            >
              <LogOut size={16} className="text-muted-foreground" aria-hidden />
              {t("profile.signOut")}
            </button>
          </CardRow>
        </AppCard>
      </Section>

      {/* ── Irreversible ──────────────────────────────────────────────── */}
      <Section>
        <SectionHeader title={t("profile.legalData")} />
        <AppCard>
          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="press flex w-full items-center gap-2.5 text-left text-label font-medium text-destructive"
            >
              <Trash2 size={16} aria-hidden />
              {t("profile.deleteAccount")}
            </button>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-label leading-relaxed text-foreground">
                {t("profile.deleteAccountWarning")}
              </p>
              {deleteError && (
                <p role="alert" className="text-micro text-destructive">
                  {deleteError}
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  className="flex-1"
                  loading={isDeleting}
                  onClick={handleDeleteAccount}
                >
                  {t("profile.deleteAccountConfirm")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isDeleting}
                  onClick={() => {
                    setShowDeleteConfirm(false)
                    setDeleteError(null)
                  }}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            </div>
          )}
        </AppCard>
      </Section>
    </div>
  )
}

function PasswordField({
  id,
  label,
  visible,
  onToggle,
  showLabel,
  hideLabel,
}: {
  id: string
  label: string
  visible: boolean
  onToggle: () => void
  showLabel: string
  hideLabel: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-micro font-medium text-card-foreground">
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          required
          minLength={8}
          className="pr-11"
        />
        <button
          type="button"
          onClick={onToggle}
          className="press absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
          aria-label={visible ? hideLabel : showLabel}
        >
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    </div>
  )
}
