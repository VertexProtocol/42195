"use client"

import { Home, Activity, Target, User, Lightbulb } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import type { TabId } from "@/lib/types"

interface TabBarProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
}

const tabs: { id: TabId; labelKey: "tab.home" | "tab.activities" | "tab.goals" | "tab.insights" | "tab.profile"; icon: typeof Home }[] = [
  { id: "home", labelKey: "tab.home", icon: Home },
  { id: "activities", labelKey: "tab.activities", icon: Activity },
  { id: "goals", labelKey: "tab.goals", icon: Target },
  { id: "insights", labelKey: "tab.insights", icon: Lightbulb },
  { id: "profile", labelKey: "tab.profile", icon: User },
]

// Icons that render well as filled (fill="currentColor")
const FILLABLE = new Set<TabId>(["home", "insights", "profile"])

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
  const { t } = useI18n()

  function handleTabChange(tab: TabId) {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(8)
    }
    onTabChange(tab)
  }

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/80 backdrop-blur-xl overflow-visible"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      role="tablist"
      aria-label="Main navigation"
    >
      <div className="mx-auto flex max-w-md items-center justify-around px-0.5 py-1">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          const isGoals = tab.id === "goals"

          if (isGoals) {
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                aria-label={t(tab.labelKey)}
                className="flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1 -mt-3"
                onClick={() => handleTabChange(tab.id)}
              >
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-full shadow-md transition-all duration-200 ${
                    isActive
                      ? "bg-primary text-primary-foreground shadow-primary/25"
                      : "bg-card ring-1 ring-border text-muted-foreground"
                  }`}
                >
                  <Icon size={22} strokeWidth={isActive ? 2.5 : 1.8} />
                </div>
                <span
                  className={`text-[9px] leading-tight font-semibold transition-colors duration-200 ${
                    isActive ? "text-primary" : "text-transparent select-none"
                  }`}
                >
                  {t(tab.labelKey)}
                </span>
              </button>
            )
          }

          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              aria-label={t(tab.labelKey)}
              className={`flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 transition-colors duration-200 ${
                isActive ? "text-primary" : "text-muted-foreground active:text-foreground"
              }`}
              onClick={() => handleTabChange(tab.id)}
            >
              <Icon
                size={20}
                strokeWidth={isActive ? 2.5 : 1.8}
                fill={isActive && FILLABLE.has(tab.id) ? "currentColor" : "none"}
                stroke={isActive && FILLABLE.has(tab.id) ? "none" : "currentColor"}
              />
              {/* Always reserve label height to prevent layout shift */}
              <span
                className={`text-[9px] leading-tight truncate max-w-full transition-all duration-200 ${
                  isActive ? "font-semibold opacity-100" : "opacity-0 select-none"
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
