"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, Copy, LogOut, UserPlus } from "lucide-react"
import { AppBar } from "@/components/app-bar"
import { AppCard } from "@/components/ui/app-card"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Meter } from "@/components/ui/meter"
import { Pill } from "@/components/ui/pill"
import { ProgressLap, type LaneMarker } from "@/components/progress-lap"
import { Skeleton } from "@/components/ui/skeleton"
import { useI18n } from "@/lib/i18n"
import { daysUntil, formatDateShort } from "@/lib/format"
import type { SharedGoalView, SharedGoalMemberView } from "@/app/api/shared-goals/[id]/route"

/**
 * A group, on one lane.
 *
 * Everyone here is measured on how much of their own plan they have done, so a
 * beginner on 30 km a week and a veteran on 90 stand level. The rows are
 * sorted but never numbered: "you have done 93 % of your plan" is a training
 * log, and "you are third" is something else.
 *
 * The accent still means only one thing. The reader's own lap is the filled
 * arc and their marker is the solid one; everyone else is an outline in their
 * own colour.
 */

/** Per-runner colours, from the chart token set the rest of the app uses. */
const MEMBER_COLORS = [
  "var(--chart-2)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-3)",
  "var(--chart-1)",
]

/** Days since a member's last sync after which the row says so. */
const QUIET_DAYS = 7

function colorFor(member: SharedGoalMemberView, index: number): string {
  return member.isSelf ? "var(--primary)" : MEMBER_COLORS[index % MEMBER_COLORS.length]
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  return Math.floor(ms / 86_400_000)
}

interface SharedGoalScreenProps {
  groupId: string
  onBack: () => void
}

export function SharedGoalScreen({ groupId, onBack }: SharedGoalScreenProps) {
  const { t } = useI18n()
  const [view, setView] = useState<SharedGoalView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/shared-goals/${groupId}`)
      if (!res.ok) throw new Error(String(res.status))
      setView((await res.json()) as SharedGoalView)
    } catch {
      setError(t("shared.loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [groupId, t])

  useEffect(() => {
    void load()
  }, [load])

  const createInvite = useCallback(async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/shared-goals/${groupId}/invite`, { method: "POST" })
      if (!res.ok) return
      const { token } = (await res.json()) as { token: string }
      await copyInviteLink(token)
      setCopiedToken(token)
      void load()
    } finally {
      setBusy(false)
    }
  }, [groupId, load])

  const copyInviteLink = useCallback(async (token: string) => {
    const url = `${window.location.origin}/?invite=${token}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedToken(token)
    } catch {
      // Clipboard refused — usually an insecure origin. The link is still on
      // screen for the owner to copy by hand, so this is not worth an alert.
    }
  }, [])

  const leave = useCallback(async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/shared-goals/${groupId}`, { method: "DELETE" })
      if (res.ok) onBack()
    } finally {
      setBusy(false)
    }
  }, [groupId, onBack])

  if (loading) {
    return (
      <div className="pb-24">
        <AppBar title={t("shared.title")} onBack={onBack} backLabel={t("common.back")} />
        <div className="space-y-3 px-4">
          <Skeleton className="h-64 w-full rounded-card" />
        </div>
      </div>
    )
  }

  if (error || !view) {
    return (
      <div className="pb-24">
        <AppBar title={t("shared.title")} onBack={onBack} backLabel={t("common.back")} />
        <div className="px-4">
          <EmptyState title={t("shared.loadFailed")} body={t("shared.loadFailedBody")} />
        </div>
      </div>
    )
  }

  const self = view.members.find((m) => m.isSelf) ?? null
  const days = daysUntil(view.raceDate)

  const markers: LaneMarker[] = view.members
    .filter((m) => m.positionPct != null)
    .map((m, i) => ({
      id: m.userId,
      initial: m.initial,
      name: m.isSelf ? t("shared.you") : m.name,
      // The honest figure. Clamping belongs to where the marker is drawn —
      // a lap is a lap — not to what a screen reader is told it says.
      percentage: m.positionPct as number,
      color: colorFor(m, i),
      isSelf: m.isSelf,
    }))

  return (
    <div className="pb-24">
      <AppBar title={view.name} onBack={onBack} backLabel={t("common.back")} />

      <div className="space-y-3 px-4">
        <AppCard padding="lg">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lead font-semibold tracking-tight">
              {t("shared.inGroup").replace("{count}", String(view.members.length))}
            </h2>
            <span className="measure text-micro text-muted-foreground">
              {days > 0
                ? t("shared.daysToGo").replace("{days}", String(days))
                : formatDateShort(view.raceDate)}
            </span>
          </div>

          <div className="flex justify-center py-3">
            <ProgressLap
              percentage={self?.positionPct ?? 0}
              size={180}
              strokeWidth={7}
              label={t("shared.laneLabel")}
              markers={markers}
            >
              {self?.positionPct != null ? (
                <>
                  <span className="measure text-[2rem] leading-none text-primary">
                    {Math.round(self.positionPct)}
                    <span className="ml-0.5 align-super text-label">%</span>
                  </span>
                  <span className="text-micro text-muted-foreground">{t("shared.ofYourPlan")}</span>
                </>
              ) : (
                <span className="text-micro text-muted-foreground">{t("shared.notMeasuredYet")}</span>
              )}
            </ProgressLap>
          </div>

          <p className="border-b border-border/50 pb-2.5 text-center text-micro text-muted-foreground">
            {t("shared.laneCaption")}
          </p>

          <div className="flex flex-col">
            {view.members.map((m, i) => (
              <MemberRow key={m.userId} member={m} color={colorFor(m, i)} />
            ))}
          </div>
        </AppCard>

        {view.isOwner && (
          <AppCard>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-body font-semibold">{t("shared.inviteTitle")}</p>
                <p className="text-micro text-muted-foreground">{t("shared.inviteBody")}</p>
              </div>
              <Button size="sm" onClick={createInvite} disabled={busy}>
                <UserPlus className="size-4" />
                {t("shared.inviteAction")}
              </Button>
            </div>

            {view.pendingInvites.length > 0 && (
              <ul className="mt-3 flex flex-col gap-2 border-t border-border/50 pt-3">
                {view.pendingInvites.map((invite) => (
                  <li key={invite.id} className="flex items-center justify-between gap-2">
                    <span className="measure truncate text-micro text-muted-foreground">
                      {invite.label ?? t("shared.inviteLink")}
                    </span>
                    <button
                      type="button"
                      onClick={() => copyInviteLink(invite.token)}
                      className="press inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-micro font-semibold"
                    >
                      {copiedToken === invite.token ? (
                        <>
                          <Check className="size-3" />
                          {t("shared.copied")}
                        </>
                      ) : (
                        <>
                          <Copy className="size-3" />
                          {t("shared.copyLink")}
                        </>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </AppCard>
        )}

        <button
          type="button"
          onClick={leave}
          disabled={busy}
          className="press flex w-full items-center justify-center gap-2 rounded-control py-3 text-label font-semibold text-muted-foreground"
        >
          <LogOut className="size-4" />
          {view.isOwner ? t("shared.disband") : t("shared.leave")}
        </button>
      </div>
    </div>
  )
}

/**
 * One runner.
 *
 * The percentage is the measure; the ratio under it is the same measure before
 * it became a fraction, so there is nothing to weigh against anything. A row
 * with no number shows a dash and says why — a zero would be a claim about the
 * runner that the data does not support.
 */
function MemberRow({ member, color }: { member: SharedGoalMemberView; color: string }) {
  const { t } = useI18n()
  const quiet = daysSince(member.updatedAt)
  const hasRatio = member.adherenceDone != null && member.adherenceTarget != null

  const tone = member.positionPct == null
    ? "quiet"
    : member.positionPct >= 100
      ? "done"
      : member.positionPct < 60
        ? "caution"
        : "action"

  return (
    <div className="grid grid-cols-[1.55rem_minmax(0,1fr)] gap-2.5 border-b border-border/40 py-2.5 last:border-b-0 last:pb-0">
      <span
        className="measure mt-0.5 grid size-[1.55rem] place-items-center rounded-full text-micro"
        style={
          member.positionPct == null
            ? { boxShadow: "inset 0 0 0 1.5px var(--border)", color: "var(--muted-foreground)" }
            : { background: color, color: "var(--card)" }
        }
      >
        {member.initial}
      </span>

      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={`truncate text-label font-semibold ${member.isSelf ? "text-primary" : ""}`}
          >
            {member.isSelf ? t("shared.you") : member.name}
          </span>
          <span
            className={`measure shrink-0 text-label ${
              member.positionPct == null ? "text-muted-foreground" : ""
            }`}
          >
            {member.positionPct == null ? "—" : `${Math.round(member.positionPct)} %`}
          </span>
        </div>

        <Meter
          value={member.positionPct ?? 0}
          tone={tone}
          size="sm"
          className="mt-1.5"
          label={member.isSelf ? t("shared.you") : member.name}
          valueText={
            hasRatio
              ? `${member.adherenceDone} / ${member.adherenceTarget} km`
              : t("shared.notMeasuredYet")
          }
        />

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="measure text-micro text-muted-foreground">
            {hasRatio
              ? `${member.adherenceDone} / ${member.adherenceTarget} km`
              : t("shared.noPlanYet")}
          </span>
          {quiet != null && quiet >= QUIET_DAYS && (
            <Pill tone="caution">
              {t("shared.quietDays").replace("{days}", String(quiet))}
            </Pill>
          )}
        </div>
      </div>
    </div>
  )
}
