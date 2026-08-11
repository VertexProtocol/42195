"use client"

import { useCallback, useEffect, useState } from "react"
import { ChevronRight, Users } from "lucide-react"
import { AppCard } from "@/components/ui/app-card"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"
import type { SharedGoalSummary } from "@/app/api/shared-goals/route"

/**
 * The way in to a group, from the goal it is attached to.
 *
 * One row on the goal's own screen and nothing on Today. Today answers one
 * question — what am I doing today — and how someone else's week is going is
 * not it. The whole social layer has to be ignorable without any other screen
 * noticing.
 */

const AVATAR_COLORS = ["var(--chart-2)", "var(--chart-4)", "var(--chart-5)"]

interface SharedGoalEntryProps {
  goalId: string
  /** Hidden for a race that has already been run. */
  hidden?: boolean
  onOpen: (groupId: string) => void
}

export function SharedGoalEntry({ goalId, hidden, onOpen }: SharedGoalEntryProps) {
  const { t } = useI18n()
  const [group, setGroup] = useState<SharedGoalSummary | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/shared-goals?goal=${encodeURIComponent(goalId)}`)
        if (!res.ok) return
        const body = (await res.json()) as { group: SharedGoalSummary | null }
        if (!cancelled) setGroup(body.group)
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [goalId])

  const create = useCallback(async () => {
    setCreating(true)
    try {
      const res = await fetch("/api/shared-goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalId }),
      })
      if (!res.ok) return
      const { id } = (await res.json()) as { id: string }
      onOpen(id)
    } finally {
      setCreating(false)
    }
  }, [goalId, onOpen])

  // Nothing is drawn until the answer is known. A prompt that appears and then
  // turns into a group row a moment later is the pop-in this screen has spent
  // several passes removing.
  if (hidden || !loaded) return null

  if (!group) {
    return (
      <AppCard>
        <p className="text-body font-semibold">{t("shared.startTitle")}</p>
        <p className="mt-1 max-w-[46ch] text-label leading-relaxed text-muted-foreground">
          {t("shared.startBody")}
        </p>
        <Button size="sm" variant="secondary" className="mt-3" onClick={create} disabled={creating}>
          <Users className="size-4" />
          {t("shared.startAction")}
        </Button>
      </AppCard>
    )
  }

  const others = group.memberCount - 1

  return (
    <AppCard interactive className="w-full text-left" onClick={() => onOpen(group.id)} role="button" tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen(group.id)
        }
      }}
    >
      <div className="flex items-center gap-3">
        <div className="flex shrink-0">
          {group.initials.length > 0 ? (
            group.initials.map((initial, i) => (
              <span
                key={`${initial}-${i}`}
                className="measure grid size-[1.55rem] place-items-center rounded-full text-micro text-card ring-2 ring-card"
                style={{
                  background: AVATAR_COLORS[i % AVATAR_COLORS.length],
                  marginLeft: i === 0 ? 0 : "-0.55rem",
                }}
              >
                {initial}
              </span>
            ))
          ) : (
            <Users className="size-5 text-muted-foreground" aria-hidden />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-label font-semibold">
            {others > 0
              ? t("shared.entryTitle").replace("{count}", String(others))
              : t("shared.entryAlone")}
          </p>
          <p className="mt-0.5 truncate text-micro text-muted-foreground">
            {group.myPositionPct == null
              ? t("shared.entryUnmeasured")
              : t("shared.entryPosition").replace(
                  "{pct}",
                  String(Math.round(group.myPositionPct)),
                )}
          </p>
        </div>

        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </div>
    </AppCard>
  )
}
