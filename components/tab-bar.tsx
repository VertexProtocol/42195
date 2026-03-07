"use client"

import { Home, Activity, Target, BookOpen, User } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import type { TabId } from "@/lib/types"

interface TabBarProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
}

const tabs: { id: TabId; labelKey: "tab.home" | "tab.activities" | "tab.goals" | "tab.plan" | "tab.profile"; icon: typeof Home }[] = [
  { id: "home", labelKey: "tab.home", icon: Home },
  { id: "activities", labelKey: "tab.activities", icon: Activity },
  { id: "goals", labelKey: "tab.goals", icon: Target },
  { id: "plan", labelKey: "tab.plan", icon: BookOpen },
  { id: "profile", labelKey: "tab.profile", icon: User },
]

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
  const { t } = useI18n()
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/80 backdrop-blur-xl"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      role="tablist"
      aria-label="Main navigation"
    >
      <div className="mx-auto flex max-w-md items-center justify-around px-1 py-1">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              aria-label={t(tab.labelKey)}
              className={`flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 rounded-xl px-3 py-1 transition-colors ${
                isActive
                  ? "text-primary"
                  : "text-muted-foreground active:text-foreground"
              }`}
              onClick={() => onTabChange(tab.id)}
            >
              <Icon
                size={22}
                strokeWidth={isActive ? 2.5 : 1.8}
              />
              <span className={`text-[10px] ${isActive ? "font-semibold" : "font-medium"}`}>
                {t(tab.labelKey)}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
