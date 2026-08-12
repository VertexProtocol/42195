"use client"

import { useCallback, useState } from "react"
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
 *
 * The group is handed in rather than fetched. This screen unmounts on every
 * tab change, so a fetch of its own meant a round trip on each visit and a
 * flash of "create a group" before the real row arrived — the same pop-in the
 * plan badges and the test-run chip were moved to the page render to avoid.
 */

const AVATAR_COLORS = ["var(--chart-2)", "var(--chart-4)", "var(--chart-5)"]

interface SharedGoalEntryProps {
  goalId: string
  /** The group this goal belongs to, or null when it is in none. */
  group: SharedGoalSummary | null
  /** Hidden for a race that has already been run. */
  hidden?: boolean
  onOpen: (groupId: string) => void
  /** Re-reads the groups after one is created. */
  onCreated?: () => void
}

export function SharedGoalEntry({
  goalId,
  group,
  hidden,
  onOpen,
  onCreated,
}: SharedGoalEntryProps) {
  const { t } = useI18n()
  const [creating, setCreating] = useState(false)
  const [failed, setFailed] = useState(false)

  const create = useCallback(async () => {
    setCreating(true)
    try {
      const res = await fetch("/api/shared-goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalId }),
      })
      if (!res.ok) {
        setFailed(true)
        return
      }
      const { id } = (await res.json()) as { id: string }
      onCreated?.()
      onOpen(id)
    } catch {
      setFailed(true)
    } finally {
      setCreating(false)
    }
  }, [goalId, onCreated, onOpen])

  if (hidden) return null

  // Offering to make a group that cannot be made is worse than an empty space,
  // so a failed attempt takes the card away rather than inviting a retry that
  // will fail the same way.
  if (failed) return null

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
    <AppCard
      interactive
      className="w-full text-left"
      onClick={() => onOpen(group.id)}
      role="button"
      tabIndex={0}
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
