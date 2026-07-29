"use client"

import { Home, Activity, Target, User, Lightbulb } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import type { TabId } from "@/lib/types"

/**
 * TabBar — the app's primary navigation.
 *
 * Design notes
 * ────────────
 * · A translucent, blurred bar plus a scrim above it, so content scrolls
 *   *under* the navigation instead of stopping dead behind an opaque strip.
 * · Active state is carried by three cues at once — a tinted pill, brand
 *   colour, and a heavier stroke. Colour alone would fail for anyone who
 *   cannot distinguish it (WCAG 1.4.1).
 * · Each button is 56px tall and full-width within its column: the visible
 *   pill is small, but the target is not.
 */

interface TabBarProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
}

const tabs: {
  id: TabId
  labelKey: "tab.home" | "tab.activities" | "tab.goals" | "tab.insights" | "tab.profile"
  icon: typeof Home
}[] = [
  { id: "home", labelKey: "tab.home", icon: Home },
  { id: "activities", labelKey: "tab.activities", icon: Activity },
  { id: "goals", labelKey: "tab.goals", icon: Target },
  { id: "insights", labelKey: "tab.insights", icon: Lightbulb },
  { id: "profile", labelKey: "tab.profile", icon: User },
]

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
  const { t } = useI18n()

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50">
      {/* Scrim: lets text dissolve into the bar rather than collide with it. */}
      <div
        aria-hidden
        className="h-6 bg-gradient-to-t from-background to-transparent"
      />

      <nav
        className="safe-bottom pointer-events-auto border-t border-border bg-card/85 backdrop-blur-xl"
        role="tablist"
        aria-label="Main navigation"
      >
        <div className="mx-auto flex max-w-md items-stretch justify-around px-1 py-1">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-current={isActive ? "page" : undefined}
                onClick={() => onTabChange(tab.id)}
                className="press group flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1"
              >
                <span
                  className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-[var(--dur-base)] ease-[var(--ease-out-quint)] ${
                    isActive ? "bg-accent text-primary" : "text-muted-foreground"
                  }`}
                >
                  <Icon size={19} strokeWidth={isActive ? 2.4 : 1.8} />
                </span>
                <span
                  className={`max-w-full truncate text-[10px] leading-none transition-colors duration-[var(--dur-base)] ${
                    isActive ? "font-semibold text-primary" : "font-medium text-muted-foreground"
                  }`}
                >
                  {t(tab.labelKey)}
                </span>
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
