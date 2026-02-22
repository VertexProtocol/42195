"use client"

import { useState, useCallback } from "react"
import { TabBar } from "@/components/tab-bar"
import { HomeScreen } from "@/components/screens/home-screen"
import { ActivitiesScreen } from "@/components/screens/activities-screen"
import { ActivityDetailScreen } from "@/components/screens/activity-detail-screen"
import { GoalsScreen } from "@/components/screens/goals-screen"
import { ProfileScreen } from "@/components/screens/profile-screen"
import {
  mockActivities,
  mockGoals,
  mockWeeklySummary,
  mockSyncStatus,
  mockUser,
} from "@/lib/mock-data"
import type { TabId, Activity, Goal } from "@/lib/types"

export function AppShell() {
  const [activeTab, setActiveTab] = useState<TabId>("home")
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null)
  const [goals, setGoals] = useState<Goal[]>(mockGoals)

  const activeGoal = goals.find((g) => g.is_active) || null

  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab)
    setSelectedActivity(null)
  }, [])

  const handleSelectActivity = useCallback((activity: Activity) => {
    setSelectedActivity(activity)
  }, [])

  const handleBackFromDetail = useCallback(() => {
    setSelectedActivity(null)
  }, [])

  const handleSetActiveGoal = useCallback((goalId: string) => {
    setGoals((prev) =>
      prev.map((g) => ({
        ...g,
        is_active: g.id === goalId,
      }))
    )
  }, [])

  const handleSync = useCallback(() => {
    // Placeholder: would trigger Supabase sync
  }, [])

  const handleSignOut = useCallback(() => {
    // Placeholder: would trigger sign out
  }, [])

  return (
    <div className="mx-auto min-h-dvh max-w-md bg-background">
      {/* Screen content */}
      <main className="relative">
        {activeTab === "home" && (
          <HomeScreen
            activeGoal={activeGoal}
            weeklySummary={mockWeeklySummary}
            onViewActivities={() => handleTabChange("activities")}
            onViewGoal={() => handleTabChange("goals")}
          />
        )}

        {activeTab === "activities" && !selectedActivity && (
          <ActivitiesScreen
            activities={mockActivities}
            onSelectActivity={handleSelectActivity}
          />
        )}

        {activeTab === "activities" && selectedActivity && (
          <ActivityDetailScreen
            activity={selectedActivity}
            onBack={handleBackFromDetail}
          />
        )}

        {activeTab === "goals" && (
          <GoalsScreen
            goals={goals}
            onSetActive={handleSetActiveGoal}
          />
        )}

        {activeTab === "profile" && (
          <ProfileScreen
            user={mockUser}
            syncStatus={mockSyncStatus}
            onSync={handleSync}
            onSignOut={handleSignOut}
          />
        )}
      </main>

      {/* Bottom Tab Bar */}
      <TabBar activeTab={activeTab} onTabChange={handleTabChange} />
    </div>
  )
}
