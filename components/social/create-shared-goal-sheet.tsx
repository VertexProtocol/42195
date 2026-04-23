"use client"

import { useEffect, useState } from "react"
import { X, Users } from "lucide-react"
import type { Goal } from "@/lib/types"
import { formatDate } from "@/lib/format"

interface Props {
  myGoals: Goal[]
  onClose: () => void
  onCreated: (sharedGoalId: string) => void
}

export function CreateSharedGoalSheet({ myGoals, onClose, onCreated }: Props) {
  const eligible = myGoals.filter((g) => g.goal_category === "event_training" && !isPastDate(g.target_date))

  const [linkedGoalId, setLinkedGoalId] = useState<string | null>(eligible[0]?.id ?? null)
  const [name, setName] = useState("")
  const [targetDistance, setTargetDistance] = useState("")
  const [targetDate, setTargetDate] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auto-fill fields from the selected linked goal
  useEffect(() => {
    const g = eligible.find((x) => x.id === linkedGoalId)
    if (!g) return
    if (!name) setName(g.name)
    if (!targetDistance) setTargetDistance(String(g.target_distance_km).replace(".", ","))
    if (!targetDate) setTargetDate(g.target_date.split("T")[0])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedGoalId])

  const canSave =
    name.trim().length > 0 &&
    targetDistance.replace(",", ".").length > 0 &&
    Number(targetDistance.replace(",", ".")) > 0 &&
    targetDate.length === 10

  const submit = async () => {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/goal-shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          target_date: targetDate,
          target_distance_km: Number(targetDistance.replace(",", ".")),
          goal_id: linkedGoalId,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `Status ${res.status}`)
      onCreated(body.share.id)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-foreground/30" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-x-0 bottom-0 z-[70] mx-auto max-w-md animate-in slide-in-from-bottom duration-300">
        <div className="flex max-h-[92dvh] flex-col rounded-t-3xl bg-card shadow-2xl ring-1 ring-border">
          <div className="flex shrink-0 justify-center pt-3 pb-1">
            <div className="h-1 w-10 rounded-full bg-border" />
          </div>
          <div className="flex shrink-0 items-center justify-between px-5 pb-3 pt-2">
            <button
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary active:bg-accent"
              aria-label="Lukk"
            >
              <X size={18} className="text-muted-foreground" />
            </button>
            <h2 className="text-base font-semibold">Nytt felles mål</h2>
            <button
              onClick={submit}
              disabled={!canSave || busy}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                canSave && !busy ? "bg-primary text-primary-foreground active:opacity-80" : "bg-secondary text-muted-foreground"
              }`}
            >
              {busy ? "Oppretter…" : "Opprett"}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="flex flex-col gap-5 px-5 pb-6 pt-2">
              {/* Intro */}
              <div className="flex items-start gap-2.5 rounded-xl bg-primary/5 p-3 ring-1 ring-primary/10">
                <Users size={16} className="mt-0.5 text-primary" />
                <p className="text-xs text-muted-foreground">
                  Et felles mål lar deg og vennene dine se hverandres progresjon mot samme løp. Alle beholder
                  sin egen treningsplan og aktiviteter.
                </p>
              </div>

              {/* Pick own goal to link */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Koble til ditt eget mål
                </label>
                {eligible.length === 0 ? (
                  <div className="rounded-xl bg-secondary/60 p-3 text-xs text-muted-foreground">
                    Du har ingen aktive løpsmål. Opprett et event-mål først for å koble det til.
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {eligible.map((g) => (
                      <button
                        key={g.id}
                        onClick={() => setLinkedGoalId(g.id)}
                        className={`flex items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left transition-colors ${
                          linkedGoalId === g.id
                            ? "border-primary bg-primary/5"
                            : "border-transparent bg-secondary/60 active:bg-secondary"
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">{g.name}</p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {g.target_distance_km.toFixed(1)} km · {formatDate(g.target_date)}
                          </p>
                        </div>
                        {linkedGoalId === g.id && (
                          <div className="h-2 w-2 rounded-full bg-primary" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Shared goal name */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Navn på felles mål
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="f.eks. Oslo Maraton 2026"
                  className="h-12 rounded-xl border-0 bg-secondary px-4 text-base text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>

              {/* Target distance + date */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Distanse (km)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={targetDistance}
                    onChange={(e) => setTargetDistance(e.target.value)}
                    placeholder="42,195"
                    className="h-12 rounded-xl border-0 bg-secondary px-4 text-base text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Dato
                  </label>
                  <input
                    type="date"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                    className="h-12 rounded-xl border-0 bg-secondary px-4 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
              </div>

              {error && (
                <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function isPastDate(iso: string): boolean {
  return new Date(iso).getTime() < Date.now() - 86400_000
}
