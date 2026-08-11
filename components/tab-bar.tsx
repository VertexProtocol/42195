"use client"

import { CalendarDays, Route, Target, LineChart } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import type { TabId } from "@/lib/types"

/**
 * Four destinations, not five.
 *
 * Profile moved into the app bar: it is a place you visit occasionally, not a
 * peer of the three things you do every day. Dropping it buys each remaining
 * tab enough width for a legible label instead of the 9px text the five-tab
 * bar forced.
 *
 * The active tab is marked twice — by an ember lane above the icon and by
 * weight — so the state does not rely on colour alone.
 *
 * The bar carries no rule along its top edge. Content dissolves into the ground
 * through a short scrim instead, which separates the bar from the list without
 * boxing the screen in.
 */

const tabs: {
  id: TabId
  labelKey: "tab.home" | "tab.activities" | "tab.goals" | "tab.insights"
  icon: typeof Route
}[] = [
  { id: "home", labelKey: "tab.home", icon: CalendarDays },
  { id: "activities", labelKey: "tab.activities", icon: Route },
  { id: "goals", labelKey: "tab.goals", icon: Target },
  { id: "insights", labelKey: "tab.insights", icon: LineChart },
]

interface TabBarProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
}

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
  const { t } = useI18n()

  return (
    <nav
      className="chrome chrome-bottom fixed inset-x-0 bottom-0 z-50"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      role="tablist"
      aria-label={t("nav.main")}
    >
      <div className="mx-auto flex max-w-md items-stretch">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              className="press relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 pb-1.5 pt-2"
              onClick={() => onTabChange(tab.id)}
            >
              <span
                aria-hidden
                className="absolute inset-x-4 top-0 h-[2px] rounded-full bg-primary"
                style={{
                  opacity: isActive ? 1 : 0,
                  transform: isActive ? "scaleX(1)" : "scaleX(0.4)",
                  transition:
                    "opacity var(--dur-state) var(--ease-out), transform var(--dur-state) var(--ease-out)",
                }}
              />
              <Icon
                size={20}
                strokeWidth={isActive ? 2.2 : 1.7}
                className={isActive ? "text-primary" : "text-muted-foreground"}
              />
              <span
                className={`text-micro leading-none ${
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
  )
}
