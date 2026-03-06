"use client"

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react"

export type Locale = "en" | "no"

const translations = {
  en: {
    // App
    "app.tagline": "Your training, at a glance",
    // Tabs
    "tab.home": "Home",
    "tab.activities": "Activities",
    "tab.goals": "Goals",
    "tab.plan": "Plan",
    "tab.profile": "Profile",
    // Home
    "home.activeGoals": "Active Goals",
    "home.goals": "goals",
    "home.setGoal": "Set a goal",
    "home.noActiveGoals": "No active goals set",
    "home.daysLeft": "days left",
    "home.logged": "logged",
    "home.thisWeek": "This Week",
    "home.km": "km",
    "home.time": "time",
    "home.runs": "runs",
    "home.trainingLoad": "Training Load",
    "home.days7": "7 days",
    "home.days30": "30 days",
    "home.weeklyGoals": "Weekly Goals",
    "home.seeAll": "See all",
    "home.recentActivities": "Recent Activities",
    "home.racePredictions": "Race Predictions",
    "home.basedOn": "Based on",
    "home.on": "on",
    "home.fitnessFatigue": "Fitness & Fatigue",
    "home.highInjuryRisk": "High injury risk",
    "home.elevatedLoad": "Elevated training load",
    "home.considerRecovery": "Consider taking a recovery day.",
    "home.monitorFeeling": "Monitor how you feel.",
    // Activities
    "activities.title": "Activities",
    "activities.activity": "activity",
    "activities.activities": "activities",
    "activities.noActivities": "No activities yet",
    "activities.addActivity": "Add Activity",
    "activities.save": "Save Activity",
    "activities.saving": "Saving...",
    "activities.name": "Activity name",
    "activities.distance": "Distance (km)",
    "activities.duration": "Duration",
    "activities.elevation": "Elevation (m)",
    "activities.avgHr": "Avg HR (bpm)",
    "activities.optional": "optional",
    // Goals
    "goals.title": "Goals",
    "goals.subtitle": "Weekly targets and performance benchmarks",
    "goals.weekly": "Weekly",
    "goals.performance": "Performance",
    "goals.addWeeklyGoal": "Add weekly goal",
    "goals.addPerfGoal": "Add performance goal",
    "goals.noWeeklyGoals": "No weekly goals",
    "goals.setTargets": "Set targets for distance, sessions, or more",
    "goals.noPerfGoals": "No performance goals",
    "goals.setPerfTargets": "Set a timed benchmark to chase, e.g. sub-50 10 km",
    "goals.thisWeek": "This week",
    "goals.noGoalsThisWeek": "No goals this week",
    "goals.noGoalsSetThisWeek": "No goals were set for this week",
    "goals.completed": "Completed",
    "goals.goalReached": "Goal reached",
    "goals.daysRemaining": "days remaining",
    "goals.targetDatePassed": "Target date passed",
    "goals.active": "Active",
    "goals.setActive": "Set active",
    "goals.bestTime": "Best time",
    "goals.noQualifyingRuns": "No qualifying runs yet",
    "goals.longestRun": "Longest run",
    "goals.noRuns": "No runs yet",
    // Plan
    "plan.title": "Plan",
    "plan.subtitle": "Race preparation and long-term training",
    "plan.addEvent": "Add event / race goal",
    "plan.noEvents": "No events planned",
    "plan.noEventsDesc": "Add a race or event goal to start tracking your training preparation",
    "plan.raceComplete": "Race complete",
    "plan.activePlan": "Active plan",
    "plan.daysToGo": "days to go",
    "plan.raceDay": "Race day!",
    "plan.kmLogged": "km logged",
    "plan.longestRun": "longest run",
    "plan.bestSimRun": "best sim. run",
    "plan.aiPlan": "Tap to view AI training plan",
    // Profile
    "profile.title": "Profile",
    "profile.appearance": "Appearance",
    "profile.darkMode": "Dark Mode",
    "profile.language": "Language",
    "profile.personalRecords": "Personal Records",
    "profile.stravaSync": "Strava Sync",
    "profile.stravaConnected": "Strava connected",
    "profile.stravaNotConnected": "Strava not connected",
    "profile.connect": "Connect",
    "profile.syncWithStrava": "Sync with Strava",
    "profile.fullResync": "Full re-sync (re-fetch all activities)",
    "profile.account": "Account",
    "profile.signOut": "Sign Out",
    "profile.synced": "Synced",
    "profile.syncError": "Sync error",
    "profile.syncing": "Syncing...",
    "profile.neverSynced": "Never synced",
    // Training plan
    "plan.generate": "Generate your training plan",
    "plan.generateDesc": "Claude will analyse your activity history and build a personalised training block",
    "plan.generateBtn": "Generate plan",
    "plan.preferences": "Preferences",
    "plan.savePrefs": "Save preferences",
    "plan.adjustPlan": "Adjust plan",
    "plan.cancel": "Cancel",
    "plan.regenerate": "Regenerate (fresh start)",
    "plan.previousPlans": "Previous plans",
    "plan.restore": "Restore",
    "plan.dueForRefresh": "Due for refresh",
    "plan.generatedToday": "Generated today",
    "plan.done": "done",
  },
  no: {
    // App
    "app.tagline": "Treningen din, i et overblikk",
    // Tabs
    "tab.home": "Hjem",
    "tab.activities": "Aktiviteter",
    "tab.goals": "Mål",
    "tab.plan": "Plan",
    "tab.profile": "Profil",
    // Home
    "home.activeGoals": "Aktive mål",
    "home.goals": "mål",
    "home.setGoal": "Sett et mål",
    "home.noActiveGoals": "Ingen aktive mål satt",
    "home.daysLeft": "dager igjen",
    "home.logged": "logget",
    "home.thisWeek": "Denne uken",
    "home.km": "km",
    "home.time": "tid",
    "home.runs": "løp",
    "home.trainingLoad": "Treningsbelastning",
    "home.days7": "7 dager",
    "home.days30": "30 dager",
    "home.weeklyGoals": "Ukentlige mål",
    "home.seeAll": "Se alle",
    "home.recentActivities": "Nylige aktiviteter",
    "home.racePredictions": "Løpsprediksjoner",
    "home.basedOn": "Basert på",
    "home.on": "den",
    "home.fitnessFatigue": "Form og tretthet",
    "home.highInjuryRisk": "Høy skaderisiko",
    "home.elevatedLoad": "Forhøyet treningsbelastning",
    "home.considerRecovery": "Vurder en hviledag.",
    "home.monitorFeeling": "Følg med på hvordan du føler deg.",
    // Activities
    "activities.title": "Aktiviteter",
    "activities.activity": "aktivitet",
    "activities.activities": "aktiviteter",
    "activities.noActivities": "Ingen aktiviteter ennå",
    "activities.addActivity": "Legg til aktivitet",
    "activities.save": "Lagre aktivitet",
    "activities.saving": "Lagrer...",
    "activities.name": "Aktivitetsnavn",
    "activities.distance": "Distanse (km)",
    "activities.duration": "Varighet",
    "activities.elevation": "Stigning (m)",
    "activities.avgHr": "Snitt-puls (bpm)",
    "activities.optional": "valgfritt",
    // Goals
    "goals.title": "Mål",
    "goals.subtitle": "Ukentlige mål og ytelsesbenchmarks",
    "goals.weekly": "Ukentlig",
    "goals.performance": "Ytelse",
    "goals.addWeeklyGoal": "Legg til ukentlig mål",
    "goals.addPerfGoal": "Legg til ytelsesmål",
    "goals.noWeeklyGoals": "Ingen ukentlige mål",
    "goals.setTargets": "Sett mål for distanse, økter eller mer",
    "goals.noPerfGoals": "Ingen ytelsesmål",
    "goals.setPerfTargets": "Sett et tidsmål å jakte på, f.eks. sub-50 10 km",
    "goals.thisWeek": "Denne uken",
    "goals.noGoalsThisWeek": "Ingen mål denne uken",
    "goals.noGoalsSetThisWeek": "Ingen mål ble satt for denne uken",
    "goals.completed": "Fullført",
    "goals.goalReached": "Mål nådd",
    "goals.daysRemaining": "dager igjen",
    "goals.targetDatePassed": "Måldato passert",
    "goals.active": "Aktiv",
    "goals.setActive": "Sett aktiv",
    "goals.bestTime": "Beste tid",
    "goals.noQualifyingRuns": "Ingen kvalifiserende løp ennå",
    "goals.longestRun": "Lengste løp",
    "goals.noRuns": "Ingen løp ennå",
    // Plan
    "plan.title": "Plan",
    "plan.subtitle": "Løpsforberedelse og langsiktig trening",
    "plan.addEvent": "Legg til arrangement / løpsmål",
    "plan.noEvents": "Ingen planlagte løp",
    "plan.noEventsDesc": "Legg til et løps- eller arrangementsmål for å begynne å spore treningsforberedelsene dine",
    "plan.raceComplete": "Løp fullført",
    "plan.activePlan": "Aktiv plan",
    "plan.daysToGo": "dager igjen",
    "plan.raceDay": "Løpsdag!",
    "plan.kmLogged": "km logget",
    "plan.longestRun": "lengste løp",
    "plan.bestSimRun": "beste sim. løp",
    "plan.aiPlan": "Trykk for å se AI-treningsplan",
    // Profile
    "profile.title": "Profil",
    "profile.appearance": "Utseende",
    "profile.darkMode": "Mørk modus",
    "profile.language": "Språk",
    "profile.personalRecords": "Personlige rekorder",
    "profile.stravaSync": "Strava-synkronisering",
    "profile.stravaConnected": "Strava tilkoblet",
    "profile.stravaNotConnected": "Strava ikke tilkoblet",
    "profile.connect": "Koble til",
    "profile.syncWithStrava": "Synkroniser med Strava",
    "profile.fullResync": "Full re-synk (hent alle aktiviteter på nytt)",
    "profile.account": "Konto",
    "profile.signOut": "Logg ut",
    "profile.synced": "Synkronisert",
    "profile.syncError": "Synkroniseringsfeil",
    "profile.syncing": "Synkroniserer...",
    "profile.neverSynced": "Aldri synkronisert",
    // Training plan
    "plan.generate": "Generer treningsplanen din",
    "plan.generateDesc": "Claude analyserer aktivitetshistorikken din og bygger en personlig treningsblokk",
    "plan.generateBtn": "Generer plan",
    "plan.preferences": "Innstillinger",
    "plan.savePrefs": "Lagre innstillinger",
    "plan.adjustPlan": "Juster plan",
    "plan.cancel": "Avbryt",
    "plan.regenerate": "Regenerer (ny start)",
    "plan.previousPlans": "Tidligere planer",
    "plan.restore": "Gjenopprett",
    "plan.dueForRefresh": "Tid for oppdatering",
    "plan.generatedToday": "Generert i dag",
    "plan.done": "fullført",
  },
} as const

type TranslationKey = keyof typeof translations.en

interface I18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: TranslationKey) => string
}

const I18nContext = createContext<I18nContextValue>({
  locale: "en",
  setLocale: () => {},
  t: (key) => key,
})

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en")

  useEffect(() => {
    try {
      const stored = localStorage.getItem("locale") as Locale | null
      if (stored === "en" || stored === "no") setLocaleState(stored)
    } catch {}
  }, [])

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    try { localStorage.setItem("locale", l) } catch {}
  }, [])

  const t = useCallback(
    (key: TranslationKey): string => {
      return translations[locale]?.[key] ?? translations.en[key] ?? key
    },
    [locale],
  )

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  return useContext(I18nContext)
}
