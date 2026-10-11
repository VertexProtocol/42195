"use client"
import { createContext, useContext, useMemo, useState, type ReactNode } from "react"
import type { StarterState } from "@/lib/starter-plan"
export type SavedStarterPlan = { state: StarterState; version: number }
export type StarterSnapshot = { plan: SavedStarterPlan | null; userId?: string }
const CacheContext = createContext<{ snapshot: StarterSnapshot | undefined; update: (next: StarterSnapshot) => void } | null>(null)
// Lives with the signed-in app shell, keyed by account. No shared module cache
// or persistent browser storage can expose another account's training data.
export function StarterPlanProvider({ children, initialSnapshot }: { children: ReactNode; initialSnapshot?: StarterSnapshot }) {
  const [snapshot, setSnapshot] = useState<StarterSnapshot | undefined>(initialSnapshot)
  const value = useMemo(() => ({ snapshot, update: (next: StarterSnapshot) => setSnapshot(previous => {
    if ((previous?.plan?.version ?? 0) > (next.plan?.version ?? 0)) return previous
    return { ...previous, ...next }
  }) }), [snapshot])
  return <CacheContext.Provider value={value}>{children}</CacheContext.Provider>
}
export function useStarterPlanCache() { return useContext(CacheContext) }
