"use client"

import { Flame, Footprints, Trophy } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import type { TabId } from "@/lib/types"

/**
 * Three destinations: today, the runs, the goals.
 *
 * Insights is not a tab of its own any more — it is the second half of Runs,
 * because records and predictions are just another way of looking at the log.
 * Profile lives behind the avatar in the app bar.
 *
 * The active tab sits in a tile with a coloured edge, so the state is carried
 * by shape as well as colour.
 */

type MainTab = "home" | "activities" | "goals"

const tabs: {
  id: MainTab
  labelKey: "tab.home" | "tab.activities" | "tab.goals"
  icon: typeof Flame
}[] = [
  { id: "home", labelKey: "tab.home", icon: Flame },
  { id: "activities", labelKey: "tab.activities", icon: Footprints },
  { id: "goals", labelKey: "tab.goals", icon: Trophy },
]

/** Which of the three tabs a route belongs to. Insights lives under Runs. */
export function mainTabOf(tab: TabId): MainTab | null {
  if (tab === "insights") return "activities"
  if (tab === "home" || tab === "activities" || tab === "goals") return tab
  return null
}

interface TabBarProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
}

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
  const { t } = useI18n()
  const current = mainTabOf(activeTab)

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t-2 border-[var(--chunk-edge)] bg-background"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      role="tablist"
      aria-label={t("nav.main")}
    >
      <div className="mx-auto flex max-w-md items-stretch gap-2 px-4 py-2">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = current === tab.id
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              className={`press flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 rounded-md border-2 ${
                isActive
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-transparent text-muted-foreground"
              }`}
              onClick={() => onTabChange(tab.id)}
            >
              {/* Keyed on the state so the icon remounts, and hops, the
                  moment its tab becomes the one you are on. */}
              <Icon
                key={isActive ? "on" : "off"}
                size={26}
                strokeWidth={isActive ? 2.5 : 2}
                className={isActive ? "hop" : undefined}
              />
              <span className="text-micro font-extrabold uppercase leading-none tracking-wide">
                {t(tab.labelKey)}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
