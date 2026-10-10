"use client"

import { useEffect, useState, type CSSProperties } from "react"
import { Award, Flame, Footprints, Lock, Medal, Route, Trophy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"
import type { Badge, BadgeId, StreakSummary } from "@/lib/gamification"

const BADGE_ICONS: Record<BadgeId, typeof Flame> = {
  first_run: Footprints,
  km_5: Medal,
  km_10: Medal,
  half: Award,
  marathon: Trophy,
  total_100: Route,
  total_500: Route,
  total_1000: Route,
  streak_4: Flame,
  streak_12: Flame,
}

/** The flame and the number. Grey until this week is won. */
export function StreakChip({ streak, className = "" }: { streak: StreakSummary; className?: string }) {
  const { t } = useI18n()
  const lit = streak.thisWeekWon
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-label font-extrabold ${
        lit ? "bg-primary/12 text-primary" : "bg-surface-sunken text-muted-foreground"
      } ${className}`}
      title={t("streak.weeks", { count: streak.current })}
      aria-label={t("streak.weeks", { count: streak.current })}
    >
      <Flame
        size={18}
        fill={lit ? "currentColor" : "none"}
        className={lit ? "flicker" : undefined}
        aria-hidden
      />
      <span className="measure">{streak.current}</span>
    </span>
  )
}

/** One medal: coloured once earned, a locked grey disc until then. */
function BadgeMedal({ badge, order }: { badge: Badge; order: number }) {
  const { t } = useI18n()
  const Icon = badge.earned ? BADGE_ICONS[badge.id] : Lock
  const name = t(`badge.${badge.id}`)
  return (
    <div
      className="flex flex-col items-center gap-1.5 text-center"
      style={{ "--i": order } as CSSProperties}
    >
      <span
        className={`flex size-16 items-center justify-center rounded-full border ${
          badge.earned
            ? "border-[var(--primary-edge)] bg-primary text-primary-foreground"
            : "border-[var(--chunk-edge)] bg-surface-sunken text-muted-foreground"
        }`}
        aria-hidden
      >
        <Icon size={28} strokeWidth={2.4} />
      </span>
      <span
        className={`text-micro font-bold leading-tight ${
          badge.earned ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        {name}
        <span className="sr-only"> — {badge.earned ? "✓" : t("badges.locked")}</span>
      </span>
    </div>
  )
}

export function BadgeGrid({ badges }: { badges: Badge[] }) {
  return (
    // Medals drop in one after another, the earned ones first in line.
    <div className="pop-stagger grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-4">
      {badges.map((b, i) => (
        <BadgeMedal key={b.id} badge={b} order={i} />
      ))}
    </div>
  )
}

/** A streak at a glance: the big flame, the count and the best. */
export function StreakCard({ streak }: { streak: StreakSummary }) {
  const { t } = useI18n()
  const lit = streak.thisWeekWon
  return (
    <div className="surface flex items-center gap-4 p-4">
      <span
        className={`flex size-14 shrink-0 items-center justify-center rounded-full ${
          lit ? "bg-primary text-primary-foreground" : "bg-surface-sunken text-muted-foreground"
        }`}
        aria-hidden
      >
        <Flame size={30} fill={lit ? "currentColor" : "none"} className={lit ? "flicker" : undefined} />
      </span>
      <div className="min-w-0">
        <p className="text-title font-extrabold text-foreground">
          {t("streak.weeks", { count: streak.current })}
        </p>
        <p className="text-label font-semibold text-muted-foreground">
          {lit ? t("streak.thisWeekWon") : t(streak.current > 0 ? "streak.keepGoing" : "streak.start")}
        </p>
      </div>
    </div>
  )
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Private mode or blocked storage: the celebration simply shows again.
  }
}

type Celebration = { kind: "week" } | { kind: "badge"; id: BadgeId }

const WEEK_KEY = "42195.celebratedWeek"
const BADGES_KEY = "42195.seenBadges"

/**
 * Works out, once per load, whether there is something to celebrate.
 *
 * The first time a runner opens this version every badge they already hold is
 * marked as seen without a fuss — a stack of celebrations for runs done months
 * ago would be noise, not a reward.
 */
export function useCelebration(
  ready: boolean,
  userId: string | undefined,
  weekStart: string,
  streak: StreakSummary,
  badges: Badge[],
  hasWeeklyGoals: boolean,
) {
  const [queue, setQueue] = useState<Celebration[]>([])

  const earnedKey = badges
    .filter((b) => b.earned)
    .map((b) => b.id)
    .join(",")

  useEffect(() => {
    if (!ready || !userId) return
    const next: Celebration[] = []
    const weekKey = `${WEEK_KEY}.${userId}`
    const badgesKey = `${BADGES_KEY}.${userId}`

    if (hasWeeklyGoals && streak.thisWeekWon && readStorage(weekKey) !== weekStart) {
      writeStorage(weekKey, weekStart)
      next.push({ kind: "week" })
    }

    const earned = earnedKey ? (earnedKey.split(",") as BadgeId[]) : []
    const stored = readStorage(badgesKey)
    if (stored !== null) {
      const seen = new Set(stored.split(",").filter(Boolean))
      for (const id of earned) if (!seen.has(id)) next.push({ kind: "badge", id })
    }
    writeStorage(badgesKey, earned.join(","))

    // Syncing a celebration out of storage is exactly what an effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (next.length > 0) setQueue((q) => [...q, ...next])
  }, [ready, userId, weekStart, streak.thisWeekWon, earnedKey, hasWeeklyGoals])

  return {
    current: queue[0] ?? null,
    dismiss: () => setQueue((q) => q.slice(1)),
  }
}

const CONFETTI_COLOURS = [
  "var(--primary)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
]

/**
 * A burst of paper from behind the medal. The spread is fixed per piece
 * (computed from its index) rather than random, so it renders the same on
 * every pass and never shifts under a re-render.
 */
function Confetti() {
  const pieces = Array.from({ length: 28 }, (_, i) => {
    const angle = (i / 28) * Math.PI * 2
    const reach = 120 + ((i * 37) % 90)
    return {
      dx: `${Math.round(Math.cos(angle) * reach)}px`,
      // Biased downward, so it falls rather than only bursting.
      dy: `${Math.round(Math.sin(angle) * reach + 160)}px`,
      rot: `${(i % 2 ? 1 : -1) * (240 + ((i * 53) % 300))}deg`,
      colour: CONFETTI_COLOURS[i % CONFETTI_COLOURS.length],
      delay: `${(i % 5) * 30}ms`,
    }
  })
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={
            {
              "--dx": p.dx,
              "--dy": p.dy,
              "--rot": p.rot,
              background: p.colour,
              animationDelay: p.delay,
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}

/** Counts up to `to` once, quickly, so the streak number lands rather than appears. */
function useCountUp(to: number, run: boolean): number {
  const [value, setValue] = useState(run ? 0 : to)
  useEffect(() => {
    if (!run) return
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduce || to <= 1) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setValue(to)
      return
    }
    setValue(0)
    const start = performance.now()
    const duration = 700
    let frame = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      setValue(Math.round(to * (1 - Math.pow(1 - t, 3))))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [to, run])
  return value
}

/** The full-screen moment: one big icon, one line, one button. */
export function CelebrationOverlay({
  celebration,
  streak,
  onClose,
}: {
  celebration: Celebration | null
  streak: StreakSummary
  onClose: () => void
}) {
  const { t } = useI18n()
  const count = useCountUp(streak.current, celebration?.kind === "week")
  if (!celebration) return null

  const Icon = celebration.kind === "week" ? Flame : BADGE_ICONS[celebration.id]
  const title = celebration.kind === "week" ? t("celebrate.weekTitle") : t("celebrate.badgeTitle")
  const body =
    celebration.kind === "week"
      ? `${t("celebrate.weekBody")} ${t("streak.weeks", { count })}`
      : t(`badge.${celebration.id}`)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="celebration-title"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 overflow-hidden bg-background px-6 text-center"
    >
      <Confetti />
      <span
        className="pop-in flex size-32 items-center justify-center rounded-full border-4 border-b-8 border-[var(--primary-edge)] bg-primary text-primary-foreground"
        aria-hidden
      >
        <Icon size={64} strokeWidth={2.4} fill={celebration.kind === "week" ? "currentColor" : "none"} />
      </span>
      <div className="flex flex-col gap-2 [animation:rise_var(--dur-view)_var(--ease-out)_200ms_both]">
        <h2 id="celebration-title" className="text-screen font-extrabold text-foreground">
          {title}
        </h2>
        <p className="text-lead font-semibold text-muted-foreground">{body}</p>
      </div>
      <div
        className="w-full max-w-xs [animation:rise_var(--dur-view)_var(--ease-out)_380ms_both]"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <Button size="lg" block onClick={onClose} autoFocus>
          {t("celebrate.continue")}
        </Button>
      </div>
    </div>
  )
}
