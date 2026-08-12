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
    setFailed(false)
    try {
      const res = await fetch("/api/shared-goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalId }),
      })
      if (!res.ok) {
        // 409 means this goal is already in a group, and the server hands back
        // which one. That is the answer to the question the button asked, not
        // a failure — throwing it away is what made the button look dead to a
        // runner whose screen had not caught up with a group they had joined.
        const body = (await res.json().catch(() => null)) as { id?: string } | null
        if (res.status === 409 && body?.id) {
          onCreated?.()
          onOpen(body.id)
          return
        }
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

  if (!group) {
    return (
      <AppCard>
        <p className="text-body font-semibold">{t("shared.startTitle")}</p>
        <p className="mt-1 max-w-[46ch] text-label leading-relaxed text-muted-foreground">
          {t("shared.startBody")}
        </p>
        {/* A failure used to take the whole card away on the reasoning that
            offering something that cannot be done is worse than an empty
            space. But the one failure that really could not be retried — the
            goal is already in a group — now opens that group instead, and
            what is left is a lost request. Vanishing is the wrong answer to
            that: it reads as the button doing nothing, and it removes the
            retry that would have worked. */}
        {failed && (
          <p role="alert" className="mt-2 text-micro leading-relaxed text-destructive">
            {t("shared.startFailed")}
          </p>
        )}
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
