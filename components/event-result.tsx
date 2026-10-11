"use client"
import { useState } from "react"
import { useI18n } from "@/lib/i18n"
import { eventResult } from "@/lib/event-result"
import type { Activity, Goal } from "@/lib/types"
import { formatTargetTime, formatDateShort } from "@/lib/format"
import { Button } from "@/components/ui/button"

export function EventResult({ goal, activities, onChange }: { goal: Goal; activities: Activity[]; onChange?: (patch: Partial<Goal> & { id: string }) => void }) {
  const { locale } = useI18n()
  const no = locale === "no"
  const result = eventResult(goal, activities)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  async function save(action: "confirm" | "dismiss" | "reset", activityId?: string) {
    setBusy(true); setError(false)
    try {
      const response = await fetch(`/api/goals/${goal.id}/event-result`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, activityId }) })
      if (!response.ok) throw new Error("save")
      onChange?.(await response.json())
    } catch { setError(true) } finally { setBusy(false) }
  }
  if (goal.goal_category !== "event_training" || (!result.activity && !result.candidates.length && !goal.event_match_dismissed)) return null
  return <div className="space-y-3 px-5 py-4">
    {result.activity ? <>
      <a className="text-label font-semibold underline underline-offset-4" href={`https://www.strava.com/activities/${result.activity.strava_id}`} target="_blank" rel="noreferrer">{result.activity.name} ↗</a>
      <p className="text-micro text-muted-foreground">{result.automatic ? (no ? "Gjenkjent fra Strava" : "Recognized from Strava") : (no ? "Bekreftet løp" : "Confirmed race")}</p>
      {goal.target_time_seconds != null && <p className="text-label">{result.timeReached === null ? (no ? "Tidsmål: totaltid mangler" : "Time target: elapsed time missing") : `${no ? "Totaltid" : "Elapsed time"} ${formatTargetTime(result.activity.elapsed_seconds!)} · ${result.timeReached ? (no ? "Tidsmål nådd" : "Time target reached") : (no ? "Over tidsmålet" : "Above time target")}`}</p>}
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => save("dismiss")}>{no ? "Dette var ikke løpet" : "This wasn't the race"}</Button>
    </> : goal.event_match_dismissed ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => save("reset")}>{no ? "Se Strava-treff igjen" : "Review Strava matches"}</Button> : result.candidates.length > 0 ? <>
      <p className="text-label font-semibold">{no ? "Var dette løpet ditt?" : "Was this your race?"}</p>
      {result.candidates.map(a => <div key={a.id} className="flex items-center justify-between gap-3"><a href={`https://www.strava.com/activities/${a.strava_id}`} target="_blank" rel="noreferrer" className="text-micro underline">{a.name} · {formatDateShort(a.local_date ?? a.date)} · {a.distance_km.toFixed(1)} km ↗</a><Button size="sm" disabled={busy} onClick={() => save("confirm", a.id)}>{no ? "Ja" : "Yes"}</Button></div>)}
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => save("dismiss")}>{no ? "Nei" : "No"}</Button>
    </> : null}
    {error && <p role="alert" className="text-label text-destructive">{no ? "Kunne ikke lagre. Prøv igjen." : "Could not save. Try again."}</p>}
  </div>
}
