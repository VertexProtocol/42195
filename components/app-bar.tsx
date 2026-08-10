"use client"

import Image from "next/image"
import { ArrowLeft, CheckCircle2, RefreshCw, TriangleAlert, User } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import type { SyncStatus, UserProfile } from "@/lib/types"

/**
 * AppBar — the one persistent piece of chrome.
 *
 * It carries where you are, whether the data behind the screen is current, and
 * the way out to your account. Sync state lives here rather than being redrawn
 * as a different pill on three different screens.
 */

interface AppBarProps {
  title: string
  /** Rendered instead of the title when the screen has a wordmark of its own. */
  brand?: boolean
  subtitle?: string
  syncStatus?: SyncStatus
  stravaConnected?: boolean
  user?: UserProfile | null
  onOpenProfile?: () => void
  onBack?: () => void
  backLabel?: string
  /** Screen-specific action, right of the sync indicator. */
  action?: React.ReactNode
}

function SyncIndicator({ status }: { status: SyncStatus }) {
  const { t } = useI18n()
  if (status.state === "never") return null

  const map = {
    syncing: {
      icon: <RefreshCw size={13} className="animate-spin" />,
      text: t("profile.syncing"),
      cls: "text-primary",
    },
    error: {
      icon: <TriangleAlert size={13} />,
      text: t("sync.failed"),
      cls: "text-destructive",
    },
    success: {
      icon: <CheckCircle2 size={13} />,
      text: t("profile.synced"),
      cls: "text-muted-foreground",
    },
  } as const

  const view = map[status.state as keyof typeof map]
  if (!view) return null

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-micro font-medium ${view.cls}`}
      role="status"
    >
      {view.icon}
      <span>{view.text}</span>
    </span>
  )
}

export function AppBar({
  title,
  brand = false,
  subtitle,
  syncStatus,
  stravaConnected,
  user,
  onOpenProfile,
  onBack,
  backLabel,
  action,
}: AppBarProps) {
  const { t } = useI18n()

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background">
      <div
        className="mx-auto flex max-w-md items-center gap-3 px-4 pb-2.5 pt-3"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={backLabel ?? t("common.back")}
            className="press -ml-2 flex size-10 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-surface-sunken"
          >
            <ArrowLeft size={20} />
          </button>
        )}

        <div className="min-w-0 flex-1">
          {brand ? (
            <>
              <p className="measure text-lead font-bold leading-none tracking-[-0.03em] text-foreground">
                42195
              </p>
              {subtitle && (
                <p className="mt-1 truncate text-micro text-muted-foreground">{subtitle}</p>
              )}
            </>
          ) : (
            <>
              <h1 className="truncate text-lead font-semibold leading-tight text-foreground">
                {title}
              </h1>
              {subtitle && (
                <p className="mt-0.5 truncate text-micro text-muted-foreground">{subtitle}</p>
              )}
            </>
          )}
        </div>

        {syncStatus && stravaConnected && <SyncIndicator status={syncStatus} />}

        {action}

        {onOpenProfile && (
          <button
            type="button"
            onClick={onOpenProfile}
            aria-label={t("nav.openProfile")}
            className="press -mr-1 flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-surface-sunken"
          >
            {user?.avatar_url ? (
              <Image
                src={user.avatar_url}
                alt=""
                width={32}
                height={32}
                className="size-8 rounded-full object-cover"
                crossOrigin="anonymous"
              />
            ) : (
              <span className="flex size-8 items-center justify-center rounded-full bg-surface-sunken text-muted-foreground">
                <User size={16} />
              </span>
            )}
          </button>
        )}
      </div>
    </header>
  )
}
