"use client"

import { Home, Activity, Target, BookOpen, User } from "lucide-react"
import type { TabId } from "@/lib/types"

interface TabBarProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
}

const tabs: { id: TabId; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "activities", label: "Activities", icon: Activity },
  { id: "goals", label: "Goals", icon: Target },
  { id: "plan", label: "Plan", icon: BookOpen },
  { id: "profile", label: "Profile", icon: User },
]

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
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
              aria-label={tab.label}
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
                {tab.label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
