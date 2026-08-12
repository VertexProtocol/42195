"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, Copy, LogOut, Share2, UserPlus } from "lucide-react"
import { AppBar } from "@/components/app-bar"
import { AppCard } from "@/components/ui/app-card"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Meter } from "@/components/ui/meter"
import { Pill } from "@/components/ui/pill"
import { ProgressLap, type LaneMarker } from "@/components/progress-lap"
import { Skeleton } from "@/components/ui/skeleton"
import { useI18n, type TranslationKey, type TranslationParams } from "@/lib/i18n"
import { daysUntil, formatDateShort } from "@/lib/format"
import type { SharedGoalView, SharedGoalMemberView } from "@/app/api/shared-goals/[id]/route"
import type { SharedGoalSummary } from "@/app/api/shared-goals/route"

/**
 * How much longer the link works, in words.
 *
 * Read at render, so it is right every time the screen is opened and counts
 * down as the week goes. It does not tick while you watch it, which for a
 * number that changes once a day is the correct amount of machinery.
 *
 * The last day gets its own phrase rather than "1 days" — the count is a
 * ceiling, so one means "less than a day", which is worth saying outright to
 * an owner deciding whether the link they are about to send will still work
 * when it is opened.
 */
function expiryLabel(
  t: (key: TranslationKey, params?: TranslationParams) => string,
  expiresAt: string,
): string {
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000)
  if (days <= 1) return t("shared.inviteExpiresSoon")
  return t("shared.inviteExpires", { days })
}

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

/** The address an invite leads to. One definition, used by both. */
function inviteUrl(token: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin
  return `${origin}/?invite=${token}`
}

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
  /**
   * What the app already knew when the row was tapped: the name, the date and
   * the reader's own position. Enough to paint the screen it is opening rather
   * than a rectangle, while the rest of the group arrives.
   */
  initial?: SharedGoalSummary | null
}

export function SharedGoalScreen({ groupId, onBack, initial }: SharedGoalScreenProps) {
  const { t } = useI18n()
  const [view, setView] = useState<SharedGoalView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)
  const [failedToken, setFailedToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async ({ quiet = false }: { quiet?: boolean } = {}) => {
    if (!quiet) setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/shared-goals/${groupId}`)
      if (!res.ok) throw new Error(String(res.status))
      setView((await res.json()) as SharedGoalView)
    } catch {
      setError(t("shared.loadFailed"))
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [groupId, t])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * Make a link.
   *
   * It is not copied here. Safari only allows a clipboard write inside the
   * gesture that asked for it, and by the time the server has answered that
   * window has closed — the write rejects, and the button that claimed to have
   * copied was telling the truth on no platform where it mattered. The link is
   * shown instead, and copying it is its own press.
   */
  const createInvite = useCallback(async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/shared-goals/${groupId}/invite`, { method: "POST" })
      if (!res.ok) return
      await load({ quiet: true })
    } finally {
      setBusy(false)
    }
  }, [groupId, load])

  /**
   * Hand a link over, from the press that asked for it.
   *
   * The share sheet first, because a link that exists to be sent to somebody
   * should open the thing that sends it, and because on a phone that is one
   * step rather than three. Clipboard where there is no share sheet. The row
   * says what happened either way — the link is on screen regardless, so a
   * refusal is a small disappointment rather than a dead end.
   */
  const shareInvite = useCallback(async (token: string) => {
    const url = inviteUrl(token)
    setFailedToken(null)

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ url })
        return
      } catch (err) {
        // Dismissing the sheet is a decision, not a failure.
        if ((err as { name?: string })?.name === "AbortError") return
      }
    }

    try {
      await navigator.clipboard.writeText(url)
      setCopiedToken(token)
    } catch {
      setFailedToken(token)
    }
  }, [])

  /**
   * Copy, and only copy.
   *
   * Share is the right default on a phone, but it is a sheet: it takes over
   * the screen, and it is the wrong tool when the link is going somewhere the
   * sheet does not know about — a note, a terminal, a message already half
   * written. This is the plain one, beside the link rather than instead of
   * the share button.
   */
  const copyInvite = useCallback(async (token: string) => {
    setFailedToken(null)
    try {
      await navigator.clipboard.writeText(inviteUrl(token))
      setCopiedToken(token)
    } catch {
      setFailedToken(token)
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
    const days = initial ? daysUntil(initial.race_date) : 0
    return (
      <>
        <AppBar
          title={initial?.name ?? t("shared.title")}
          onBack={onBack}
          backLabel={t("common.back")}
        />
        <div className="flex flex-col gap-3 px-4 pb-8 screen-body">
          <AppCard padding="lg">
            {initial && (
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-lead font-semibold tracking-tight">
                  {t("shared.inGroup").replace("{count}", String(initial.memberCount))}
                </h2>
                <span className="measure text-micro text-muted-foreground">
                  {days > 0
                    ? t("shared.daysToGo").replace("{days}", String(days))
                    : formatDateShort(initial.race_date)}
                </span>
              </div>
            )}
            <div className="flex justify-center py-3">
              <ProgressLap
                percentage={initial?.myPositionPct ?? 0}
                size={180}
                strokeWidth={7}
                label={t("shared.laneLabel")}
              >
                {initial?.myPositionPct != null ? (
                  <>
                    <span className="measure text-[2rem] leading-none text-primary">
                      {Math.round(initial.myPositionPct)}
                      <span className="ml-0.5 align-super text-label">%</span>
                    </span>
                    <span className="text-micro text-muted-foreground">
                      {t("shared.ofYourPlan")}
                    </span>
                  </>
                ) : null}
              </ProgressLap>
            </div>
            {/* The rows are the only part still in flight. */}
            <Skeleton className="mt-2 h-16 w-full rounded-md" />
          </AppCard>
        </div>
      </>
    )
  }

  if (error || !view) {
    return (
      <>
        <AppBar title={t("shared.title")} onBack={onBack} backLabel={t("common.back")} />
        <div className="px-4 pb-8 screen-body">
          <EmptyState title={t("shared.loadFailed")} body={t("shared.loadFailedBody")} />
        </div>
      </>
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
    <>
      <AppBar title={view.name} onBack={onBack} backLabel={t("common.back")} />

      <div className="flex flex-col gap-3 px-4 pb-8 screen-body">
        <AppCard padding="lg">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lead font-semibold tracking-tight">
              {t("shared.inGroup").replace("{count}", String(view.members.length))}
            </h2>
            <span className="measure text-micro text-muted-foreground">
              {view.finished
                ? t("shared.finishedOn", { date: formatDateShort(view.raceDate) })
                : days > 0
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

          {/* The lane stops moving once the race has been run — every row is
              settled — so the caption stops describing a race in progress. */}
          <p className="border-b border-border/50 pb-2.5 text-center text-micro text-muted-foreground">
            {view.finished ? t("shared.finishedCaption") : t("shared.laneCaption")}
          </p>

          <div className="flex flex-col">
            {view.members.map((m, i) => (
              <MemberRow
                key={m.userId}
                member={m}
                color={colorFor(m, i)}
                finished={view.finished}
              />
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
              <ul className="mt-3 flex flex-col gap-3 border-t border-border/50 pt-3">
                {view.pendingInvites.map((invite) => (
                  <li key={invite.id} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-micro text-muted-foreground">
                        {expiryLabel(t, invite.expiresAt)}
                      </span>
                      <button
                        type="button"
                        onClick={() => shareInvite(invite.token)}
                        className="press inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-micro font-semibold"
                      >
                        {copiedToken === invite.token ? (
                          <>
                            <Check className="size-3" />
                            {t("shared.copied")}
                          </>
                        ) : (
                          <>
                            <Share2 className="size-3" />
                            {t("shared.sendLink")}
                          </>
                        )}
                      </button>
                    </div>
                    {/* On screen whatever the clipboard does, so the link is
                        always reachable — select it by hand if nothing else.
                        Copy sits against it rather than in the row above: the
                        share sheet is the right default on a phone, and this
                        is for the times the link is going somewhere the sheet
                        does not know about. */}
                    <div className="flex items-stretch gap-1.5">
                      <p className="measure min-w-0 flex-1 break-all rounded-md bg-surface-sunken px-2 py-1.5 text-micro leading-relaxed text-muted-foreground select-all">
                        {inviteUrl(invite.token)}
                      </p>
                      <button
                        type="button"
                        onClick={() => copyInvite(invite.token)}
                        aria-label={t("shared.copyLink")}
                        className="press flex w-9 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-muted-foreground hover:text-foreground"
                      >
                        {copiedToken === invite.token ? (
                          <Check className="size-3.5 text-success" />
                        ) : (
                          <Copy className="size-3.5" />
                        )}
                      </button>
                    </div>
                    {failedToken === invite.token && (
                      <p className="text-micro text-warning">{t("shared.copyFailed")}</p>
                    )}
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
    </>
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
function MemberRow({
  member,
  color,
  finished,
}: {
  member: SharedGoalMemberView
  color: string
  finished: boolean
}) {
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

          {/* Once the race is run, the verdict from this runner's own goal —
              the same two words their own screen gives them. A member whose
              sync has not recorded one yet says so, because "not recorded" and
              "fell short" are different things and only one of them is about
              the running. */}
          {finished ? (
            member.outcome === "reached" ? (
              <Pill tone="positive">{t("plan.achieved")}</Pill>
            ) : member.outcome === "ended" ? (
              <Pill>{t("plan.ended")}</Pill>
            ) : (
              <Pill>{t("shared.outcomeUnknown")}</Pill>
            )
          ) : (
            quiet != null &&
            quiet >= QUIET_DAYS && (
              <Pill tone="caution">
                {t("shared.quietDays").replace("{days}", String(quiet))}
              </Pill>
            )
          )}
        </div>
      </div>
    </div>
  )
}
