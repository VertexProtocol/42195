"use client"

import { useEffect, useRef, useState } from "react"
import { Flag, Footprints, Check, Mountain, Wind, ChevronRight, MapPin } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import { BottomSheet } from "@/components/ui/bottom-sheet"
import { Button } from "@/components/ui/button"
import type { TrainingWeek, PlanSessionStatus } from "@/lib/types"

export function journeyProgress(weeks: TrainingWeek[], statuses: Record<string, PlanSessionStatus>, currentIndex: number) {
  const elapsed = weeks.filter((_, i) => i <= currentIndex)
  const completed = (week: TrainingWeek) => week.sessions.filter((_, i) => statuses[`W${week.weekNumber}-${i}`] === "completed").length
  const finished = (week: TrainingWeek) => week.sessions.length > 0 && completed(week) === week.sessions.length
  const recent = elapsed.slice(-4)
  return {
    sessions: elapsed.reduce((sum, week) => sum + completed(week), 0),
    weeks: elapsed.filter(finished).length,
    recentDone: recent.filter(finished).length,
    recentTotal: recent.length,
    blockDone: weeks.length > 0 && elapsed.length === weeks.length && weeks.every(finished),
  }
}

// Fixed-height stops keep the SVG and hit areas aligned at every viewport width.
// These are sessions in sequence, never invented calendar assignments.
const STOP_HEIGHT = 156
const positions = [46, 72, 54, 28, 42, 70, 52, 26]
export function PlanJourney({ goalName, targetDate, blockStartDate, weeks, statuses, currentIndex, archived = false, onToggleSession }: {
  goalName: string
  targetDate: string
  blockStartDate?: string
  weeks: TrainingWeek[]
  statuses: Record<string, PlanSessionStatus>
  currentIndex: number
  archived?: boolean
  onToggleSession?: (week: number, session: number) => void
}) {
  const { locale, t } = useI18n()
  const no = locale === "no"
  const l = (nb: string, en: string) => no ? nb : en
  const current = useRef<HTMLLIElement>(null)
  const [selected, setSelected] = useState<{ wi: number; si: number | null } | null>(null)
  useEffect(() => { if (!archived) current.current?.scrollIntoView?.({ block: "nearest" }) }, [archived])
  const progress = journeyProgress(weeks, statuses, currentIndex)
  const activeWeek = selected ? weeks[selected.wi] : null
  const activeSession = selected && selected.si !== null ? activeWeek?.sessions[selected.si] : null
  const activeStatus = selected && activeWeek && selected.si !== null ? statuses[`W${activeWeek.weekNumber}-${selected.si}`] ?? "planned" : "planned"
  const dateLabel = (i: number) => {
    if (!blockStartDate) return null
    const start = new Date(`${blockStartDate.slice(0,10)}T12:00:00`)
    if (Number.isNaN(+start)) return null
    start.setDate(start.getDate() - (start.getDay() + 6) % 7 + i * 7)
    const end = new Date(start); end.setDate(end.getDate() + 6)
    const options = { day: "numeric", month: "short" } as const
    return `${start.toLocaleDateString(no ? "nb-NO" : "en-GB", options)} – ${end.toLocaleDateString(no ? "nb-NO" : "en-GB", options)}`
  }
  let offset = 0
  let firstCompletedShown = false
  return <section aria-label={l("Veien mot målet", "Your path to the goal")} className="flex flex-col gap-5">
    <div className="flex items-start justify-between gap-3">
      <div><h2 className="text-title font-semibold">{l("Veien mot målet", "Your path to the goal")}</h2><p className="mt-1 text-label text-muted-foreground">{l("Følg stien. Ett steg, én opplevelse om gangen.", "Follow the path. One step, one experience at a time.")}</p></div>
      {!archived && currentIndex >= 0 && currentIndex < weeks.length && <button className="press min-h-11 shrink-0 text-label font-semibold text-primary" onClick={() => current.current?.scrollIntoView?.({ block: "center" })}>{l("Du er her", "You are here")} ↓</button>}
    </div>
    <div className="flex flex-col items-center gap-2 py-5 text-center"><Footprints className="text-primary" size={28} aria-hidden /><p className="text-micro font-semibold uppercase tracking-widest text-muted-foreground">{l("Her begynner denne etappen av reisen", "This part of your journey starts here")}</p></div>
    <ol aria-label={l("Kapitler i treningsblokken", "Chapters in this training block")}>
      {weeks.map((week, wi) => {
        const startOffset = offset; offset += week.sessions.length
        const currentWeek = wi === currentIndex && !archived
        const state = (si: number) => wi <= currentIndex ? statuses[`W${week.weekNumber}-${si}`] ?? "planned" : "planned"
        const done = week.sessions.filter((_, si) => state(si) === "completed").length
        const skipped = week.sessions.filter((_, si) => state(si) === "skipped").length
        const allDone = week.sessions.length > 0 && done === week.sessions.length
        const next = currentWeek ? week.sessions.findIndex((_, si) => state(si) === "planned") : -1
        const lighter = wi > 0 && week.targetKm < weeks[wi-1].targetKm
        const height = Math.max(1, week.sessions.length) * STOP_HEIGHT + 30
        const coords = week.sessions.map((_, si) => ({ x: positions[(startOffset + si) % positions.length] * 3.2, y: si * STOP_HEIGHT + 70 }))
        return <li key={week.weekNumber} ref={currentWeek ? current : undefined} aria-current={currentWeek ? "step" : undefined} className="scroll-mt-20">
          <div className="relative py-5 text-center">
            <p className="text-micro font-semibold uppercase tracking-widest text-primary">{l("Kapittel", "Chapter")} {week.weekNumber}{currentWeek ? ` · ${l("Du er her", "You are here")}` : ""}</p>
            <button onClick={() => setSelected({ wi, si: null })} className="press min-h-11 px-3"><h3 className="text-title font-semibold">{week.theme}</h3><span className="text-micro text-muted-foreground">{dateLabel(wi)} · ~{week.targetKm} km <ChevronRight className="inline" size={12} aria-hidden /></span></button>
            <p className="mx-auto mt-1 max-w-xs text-label text-muted-foreground">{wi === 0 ? l("Finn rytmen. Du trenger bare å ta det neste steget.", "Find your rhythm. You only need to take the next step.") : lighter ? l("Litt lettere steg. Gi plass til å hente deg inn.", "Lighter steps. Make room to recover.") : l("Bygg videre, én økt om gangen.", "Build on your progress, one session at a time.")}</p>
            <p className="mt-2 text-micro text-muted-foreground"><span>{t("gp.sessionsDone", { done, total: week.sessions.length })}</span>{skipped > 0 && <> · <span>{t("gp.sessionsSkipped", { skipped, total: week.sessions.length })}</span></>}</p>
          </div>
          <ol className="relative mx-auto w-full max-w-md" style={{ height }} aria-label={l(`Økter i kapittel ${week.weekNumber}`, `Sessions in chapter ${week.weekNumber}`)}>
            <li aria-hidden className="pointer-events-none absolute inset-0 list-none">
              <svg className="h-full w-full overflow-visible" viewBox={`0 0 320 ${height}`} preserveAspectRatio="none" fill="none" aria-hidden>
                {[...coords, { x: 160, y: height }].map((point, si) => {
                  const previous = si === 0 ? { x: 160, y: 0 } : coords[si-1]
                  const dy = (point.y - previous.y) * .55
                  const d = `M ${previous.x} ${previous.y} C ${previous.x} ${previous.y+dy}, ${point.x} ${point.y-dy}, ${point.x} ${point.y}`
                  return <g key={si}><path d={d} stroke="var(--border)" strokeWidth="14" strokeLinecap="round" /><path d={d} stroke={si < week.sessions.length && state(si) === "completed" ? "var(--success)" : "var(--muted-foreground)"} strokeOpacity={si < week.sessions.length && state(si) === "completed" ? .65 : .25} strokeWidth="2" strokeDasharray="2 8" strokeLinecap="round" /></g>
                })}
              </svg>
            </li>
            {week.sessions.map((session, si) => {
              const status = state(si)
              const isNext = si === next
              const firstCompleted = status === "completed" && !firstCompletedShown
              if (firstCompleted) firstCompletedShown = true
              return <li key={si} className="absolute w-36 -translate-x-1/2 text-center" style={{ left: `${coords[si].x/3.2}%`, top: coords[si].y - 30 }}>
                <button onClick={() => setSelected({ wi, si })} aria-label={`${isNext ? l("Neste steg", "Next step") + ": " : ""}${session.type} · ${session.distance} · ${status === "completed" ? l("Gjennomført", "Completed") : status === "skipped" ? l("Hoppet over", "Skipped") : l("Planlagt", "Planned")}`} className="press group flex w-full flex-col items-center gap-2 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
                  <span className={`flex size-16 items-center justify-center rounded-full border-[5px] border-background shadow-sm transition-transform group-hover:scale-105 motion-reduce:transition-none ${status === "completed" ? "bg-success text-success-foreground" : isNext ? "bg-primary text-primary-foreground ring-4 ring-primary/20" : "bg-surface-sunken text-muted-foreground ring-1 ring-border"}`}>{status === "completed" ? <Check size={26} aria-hidden /> : status === "skipped" ? <span aria-hidden>–</span> : isNext ? <MapPin size={25} aria-hidden /> : <Footprints size={23} aria-hidden />}</span>
                  <span className="rounded-lg bg-background/95 px-2 py-1"><span className="block text-micro font-semibold text-primary">{isNext ? l("Neste steg", "Next step") : firstCompleted ? l("Første økt i blokken", "First session in this block") : ""}</span><span className="line-clamp-2 text-label font-semibold">{session.type}</span><span className="line-clamp-1 text-micro text-muted-foreground">{session.distance}</span></span>
                </button>
              </li>
            })}
          </ol>
          <div className="mx-auto flex max-w-xs flex-col items-center gap-2 pb-7 text-center">
            {allDone ? <><Mountain size={30} className="text-success" aria-hidden /><p className="text-label font-semibold text-success">{l("Etappen gjennomført", "Stage completed")}</p><p className="text-micro text-muted-foreground">{l("Ta med deg denne erfaringen videre.", "Take this experience into the next stage.")}</p></> : <><Wind size={25} className="text-muted-foreground" aria-hidden /><p className="text-micro text-muted-foreground">{skipped > 0 ? l("Veien videre er fortsatt åpen. Du trenger ikke ta igjen økter.", "The path ahead is still open. No need to make up sessions.") : l("Pust mellom stoppene. Hvile er en del av reisen.", "Breathe between stops. Rest is part of the journey.")}</p></>}
          </div>
        </li>
      })}
    </ol>
    <div className="mx-auto h-14 border-l-2 border-dashed border-border" aria-hidden />
    <p className="mx-auto max-w-xs text-center text-micro text-muted-foreground">{l("Dette er én del av reisen. Neste del av stien formes når en ny blokk er klar.", "This is one part of your journey. The next stretch takes shape when a new block is ready.")}</p>
    <div className="flex flex-col items-center gap-2 py-7 text-center"><Flag className="text-primary" size={36} aria-hidden /><p className="text-micro font-semibold uppercase tracking-widest text-primary">{l("Målet ditt", "Your goal")}</p><h3 className="text-lead font-semibold">{goalName}</h3><p className="text-label text-muted-foreground">{new Date(`${targetDate}T12:00:00`).toLocaleDateString(no ? "nb-NO" : "en-GB", { day: "numeric", month: "long", year: "numeric" })}</p></div>
    {progress.recentTotal > 0 && <p className="text-center text-micro text-muted-foreground">{l(`${progress.recentDone} av de siste ${progress.recentTotal} ukene i blokken gjennomført.`, `${progress.recentDone} of the last ${progress.recentTotal} weeks in this block completed.`)}</p>}
    <BottomSheet open={selected !== null} onClose={() => setSelected(null)} title={activeSession?.type ?? activeWeek?.theme ?? ""}>
      {activeWeek && <div className="flex flex-col gap-4 pb-4">
        <p className="text-micro text-muted-foreground">{l("Kapittel", "Chapter")} {activeWeek.weekNumber} · {selected && dateLabel(selected.wi)}</p>
        {activeSession ? <><p className="text-lead font-semibold">{activeSession.distance}</p><p className="text-body">{activeSession.effort}</p><p className="text-label text-muted-foreground">{activeSession.purpose}</p>{activeSession.suggestedPace && <p className="text-label">{activeSession.suggestedPace}</p>}<p className="text-micro text-muted-foreground">{l("Kvalitetsøkter bekreftes manuelt. En rolig tur bekrefter ikke intervaller eller terskel.", "Confirm quality sessions manually. An easy run does not verify intervals or threshold work.")}</p>
        {selected && selected.si !== null && selected.wi <= currentIndex && !archived && onToggleSession && <Button onClick={() => onToggleSession(activeWeek.weekNumber, selected.si!)}>{t(activeStatus === "planned" ? "gp.markCompleted" : activeStatus === "completed" ? "gp.markSkipped" : "gp.markPlanned")}</Button>}
        </> : <><p className="text-label">{l("Planlagt mengde", "Planned volume")}: ~{activeWeek.targetKm} km</p>{activeWeek.coachNote && <p className="text-body">{activeWeek.coachNote}</p>}</>}
      </div>}
    </BottomSheet>
  </section>
}
