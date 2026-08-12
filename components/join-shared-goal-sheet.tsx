"use client"

import { useCallback, useEffect, useState } from "react"
import { BottomSheet } from "@/components/ui/bottom-sheet"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"
import { formatDate, formatDistance, isDatePast } from "@/lib/format"
import type { Goal } from "@/lib/types"

/**
 * Taking up an invite link.
 *
 * The group owns the race and the date. What the joiner brings is one of their
 * own goals, and it keeps its target time and its plan — so the only decision
 * here is which goal to attach, and there is no reason to make them go and
 * find the group first.
 */

interface InvitePreview {
  id: string
  name: string
  raceDate: string
  distanceKm: number
  memberCount: number
}

interface JoinSharedGoalSheetProps {
  token: string
  goals: Goal[]
  onClose: () => void
  onJoined: (groupId: string) => void
  /**
   * Start a goal for this race, with the race already filled in.
   *
   * Someone invited into their first group has no goal to bring, and the group
   * knows the race, the date and the distance — asking them to go and type all
   * three somewhere else, then find the link again, is not a flow.
   */
  onCreateGoal?: (race: { name: string; raceDate: string; distanceKm: number }) => void
}

export function JoinSharedGoalSheet({ token, goals, onClose, onJoined, onCreateGoal }: JoinSharedGoalSheetProps) {
  const { t } = useI18n()
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [failed, setFailed] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/shared-goals/join?token=${encodeURIComponent(token)}`)
        if (!res.ok) throw new Error(String(res.status))
        const body = (await res.json()) as InvitePreview
        if (!cancelled) setPreview(body)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  // A race in the past is not something to train towards, so it is not offered
  // — the list is what could sensibly carry this group, not everything owned.
  const candidates = goals.filter((g) => !isDatePast(g.target_date))

  const join = useCallback(async () => {
    if (!selected) return
    setBusy(true)
    try {
      const res = await fetch("/api/shared-goals/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, goalId: selected }),
      })
      if (!res.ok) {
        setFailed(true)
        return
      }
      const { id } = (await res.json()) as { id: string }
      onJoined(id)
    } finally {
      setBusy(false)
    }
  }, [selected, token, onJoined])

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={t("shared.joinTitle")}
      description={preview ? `${preview.name} · ${formatDate(preview.raceDate)}` : undefined}
    >
      {failed ? (
        <p className="text-body text-muted-foreground">{t("shared.joinFailed")}</p>
      ) : !preview ? (
        <p className="text-body text-muted-foreground">{t("common.loading")}</p>
      ) : candidates.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-label leading-relaxed text-muted-foreground">
            {t("shared.joinNoGoals")}
          </p>
          {onCreateGoal && (
            <Button
              onClick={() =>
                onCreateGoal({
                  name: preview.name,
                  raceDate: preview.raceDate,
                  distanceKm: preview.distanceKm,
                })
              }
              className="w-full"
            >
              {t("shared.joinCreateGoal")}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-label leading-relaxed text-muted-foreground">
            {t("shared.joinBody")}
          </p>

          <div className="flex flex-col gap-2">
            {candidates.map((goal) => {
              const isSelected = selected === goal.id
              return (
                <button
                  key={goal.id}
                  type="button"
                  onClick={() => setSelected(goal.id)}
                  aria-pressed={isSelected}
                  className={`press rounded-control px-3 py-2.5 text-left ${
                    isSelected
                      ? "bg-primary/12 ring-1 ring-primary/40"
                      : "bg-surface-sunken"
                  }`}
                >
                  <span className="block text-label font-semibold">{goal.name}</span>
                  <span className="measure mt-0.5 block text-micro text-muted-foreground">
                    {formatDistance(goal.target_distance_km)} · {formatDate(goal.target_date)}
                  </span>
                </button>
              )
            })}
          </div>

          <Button onClick={join} disabled={!selected || busy} className="mt-1 w-full">
            {t("shared.joinAction")}
          </Button>
        </div>
      )}
    </BottomSheet>
  )
}
