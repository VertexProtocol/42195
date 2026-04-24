"use client"

import { useCallback, useEffect, useState } from "react"
import { Users, Plus, Check, X, ChevronRight, Clock, Inbox } from "lucide-react"
import type { Goal } from "@/lib/types"
import { formatDate, daysUntil, isDatePast } from "@/lib/format"
import { AppCard } from "@/components/ui/app-card"
import { useI18n } from "@/lib/i18n"
import { CreateSharedGoalSheet } from "@/components/social/create-shared-goal-sheet"

interface ShareListItem {
  id: string
  name: string
  target_date: string
  target_distance_km: number
  created_by: string
  my_status: "pending" | "accepted" | "declined"
  my_role: "owner" | "member"
  my_goal_id: string | null
  member_count: number
}

// Module-level cache so re-mounting the Goals tab shows previously-fetched
// shares instantly instead of flashing a skeleton every time. Stale-while-revalidate:
// last data is shown immediately, a background fetch keeps it fresh.
let cachedShares: ShareListItem[] | null = null

interface Props {
  myGoals: Goal[]
  onSelectShare: (sharedGoalId: string) => void
}

export function SharedGoalsSection({ myGoals, onSelectShare }: Props) {
  const { t } = useI18n()
  const [shares, setShares] = useState<ShareListItem[]>(cachedShares ?? [])
  const [loading, setLoading] = useState(cachedShares == null)
  const [createOpen, setCreateOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/goal-shares")
      if (!res.ok) throw new Error(`Status ${res.status}`)
      const body = await res.json()
      const next = body.shares ?? []
      cachedShares = next
      setShares(next)
    } catch {
      if (cachedShares == null) setShares([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const pending = shares.filter((s) => s.my_status === "pending")
  const accepted = shares.filter((s) => s.my_status === "accepted")

  return (
    <section className="flex flex-col gap-3 pt-6">
      <div className="flex items-center gap-2">
        <Users size={14} className="text-primary" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("shared.sectionTitle")}
        </h2>
      </div>

      {pending.length > 0 && (
        <div className="flex flex-col gap-2">
          {pending.map((s) => (
            <PendingInviteCard
              key={s.id}
              share={s}
              myGoals={myGoals}
              onResolved={load}
            />
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-2" aria-label={t("shared.loadingSection")}>
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : accepted.length === 0 && pending.length === 0 ? (
        <AppCard padding="lg">
          <div className="flex flex-col items-center justify-center gap-2 text-center">
            <Inbox size={22} className="text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">{t("shared.noSharedGoalsYet")}</p>
            <p className="max-w-[280px] text-xs text-muted-foreground">
              {t("shared.noSharedGoalsDesc")}
            </p>
          </div>
        </AppCard>
      ) : (
        accepted.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelectShare(s.id)}
            className="text-left"
          >
            <AppCard padding="sm">
              <div className="flex items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <Users size={18} className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-foreground">
                    {s.name}
                    {s.my_role === "owner" && (
                      <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                        {t("shared.owner")}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {s.member_count} {s.member_count === 1 ? t("shared.member") : t("shared.members")}
                    {" · "}
                    {isDatePast(s.target_date)
                      ? t("shared.completed")
                      : `${daysUntil(s.target_date)} ${t("shared.daysLeft")} · ${formatDate(s.target_date)}`}
                  </p>
                </div>
                <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
              </div>
            </AppCard>
          </button>
        ))
      )}

      <button
        onClick={() => setCreateOpen(true)}
        className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-2.5 text-sm font-medium text-muted-foreground active:bg-secondary transition-colors"
      >
        <Plus size={16} />
        {t("shared.newSharedGoal")}
      </button>

      {createOpen && (
        <CreateSharedGoalSheet
          myGoals={myGoals}
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            setCreateOpen(false)
            load()
            onSelectShare(id)
          }}
        />
      )}
    </section>
  )
}

// ----------------------------------------------------------

function SkeletonCard() {
  return (
    <AppCard padding="sm">
      <div className="flex items-center gap-3">
        <div className="size-10 shrink-0 rounded-xl bg-secondary animate-pulse" />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="h-3 w-2/3 rounded bg-secondary animate-pulse" />
          <div className="h-2.5 w-1/2 rounded bg-secondary/60 animate-pulse" />
        </div>
      </div>
    </AppCard>
  )
}

function PendingInviteCard({
  share,
  myGoals,
  onResolved,
}: {
  share: ShareListItem
  myGoals: Goal[]
  onResolved: () => void
}) {
  const { t } = useI18n()
  const eligible = myGoals.filter((g) => !isDatePast(g.target_date))
  const [pickerOpen, setPickerOpen] = useState(false)
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(eligible[0]?.id ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const respond = async (action: "accept" | "decline") => {
    if (action === "accept" && !selectedGoalId) {
      setError(t("shared.createGoalFirst"))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/goal-shares/${share.id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, goal_id: action === "accept" ? selectedGoalId : undefined }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `Status ${res.status}`)
      onResolved()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <AppCard state="active">
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <Clock size={18} className="text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">
              {t("shared.invitation")}
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold text-foreground">{share.name}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {share.target_distance_km.toFixed(1)} km · {formatDate(share.target_date)}
            </p>
          </div>
        </div>

        {!pickerOpen ? (
          <div className="flex gap-2">
            <button
              onClick={() => respond("decline")}
              disabled={busy}
              className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 text-sm font-medium text-muted-foreground active:bg-accent disabled:opacity-40"
            >
              <X size={14} />
              {t("shared.decline")}
            </button>
            <button
              onClick={() => {
                if (eligible.length === 0) {
                  setError(t("shared.createGoalFirst"))
                  return
                }
                setPickerOpen(true)
              }}
              disabled={busy}
              className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground active:opacity-80 disabled:opacity-40"
            >
              <Check size={14} />
              {t("shared.accept")}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] font-medium text-muted-foreground">
              {t("shared.pickYourGoal")}
            </p>
            <div className="flex flex-col gap-1.5">
              {eligible.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setSelectedGoalId(g.id)}
                  className={`flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-left transition-colors ${
                    selectedGoalId === g.id
                      ? "border-primary bg-primary/5"
                      : "border-transparent bg-secondary/60"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-xs font-semibold text-foreground">{g.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {g.target_distance_km.toFixed(1)} km · {formatDate(g.target_date)}
                    </p>
                  </div>
                  {selectedGoalId === g.id && <div className="h-2 w-2 rounded-full bg-primary" />}
                </button>
              ))}
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setPickerOpen(false)}
                disabled={busy}
                className="flex min-h-[44px] flex-1 items-center justify-center rounded-lg bg-secondary px-3 text-xs font-medium text-muted-foreground active:bg-accent disabled:opacity-40"
              >
                {t("shared.cancel")}
              </button>
              <button
                onClick={() => respond("accept")}
                disabled={busy || !selectedGoalId}
                className="flex min-h-[44px] flex-1 items-center justify-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground active:opacity-80 disabled:opacity-40"
              >
                {t("shared.confirm")}
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </div>
    </AppCard>
  )
}
