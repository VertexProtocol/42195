"use client"

import { useEffect, useRef, type ReactNode } from "react"
import { Flag, Footprints, Check } from "lucide-react"
import { useI18n } from "@/lib/i18n"
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

export function PlanJourney({ goalName, targetDate, weeks, statuses, currentIndex, archived = false, children }: {
  goalName: string
  targetDate: string
  weeks: TrainingWeek[]
  statuses: Record<string, PlanSessionStatus>
  currentIndex: number
  archived?: boolean
  children: ReactNode[]
}) {
  const { locale } = useI18n()
  const no = locale === "no"
  const l = (nb: string, en: string) => no ? nb : en
  const current = useRef<HTMLLIElement>(null)
  useEffect(() => { if (!archived) current.current?.scrollIntoView?.({ block: "nearest" }) }, [archived])
  const progress = journeyProgress(weeks, statuses, currentIndex)
  const milestones = [
    { label: l("Første økt", "First session"), reached: progress.sessions > 0 },
    { label: l("Første hele uke", "First full week"), reached: progress.weeks > 0 },
    { label: l("Blokk gjennomført", "Block completed"), reached: progress.blockDone },
  ]
  return <section aria-label={l("Veien mot målet", "Your path to the goal")} className="flex flex-col gap-5">
    <div className="flex items-start justify-between gap-3">
      <div><h2 className="text-title font-semibold">{l("Veien mot målet", "Your path to the goal")}</h2><p className="mt-1 text-label text-muted-foreground">{l("Én etappe om gangen. Hvile er en del av planen.", "One stage at a time. Rest is part of the plan.")}</p></div>
      {!archived && currentIndex >= 0 && currentIndex < weeks.length && <button className="press min-h-11 shrink-0 text-label font-semibold text-primary" onClick={() => current.current?.scrollIntoView?.({ block: "center" })}>{l("Du er her", "You are here")} ↓</button>}
    </div>
    <div className="relative ml-5 border-l-2 border-dashed border-border pl-7 py-3">
      <Flag className="absolute -left-4 top-3 size-8 rounded-full bg-background p-1 text-primary" aria-hidden />
      <p className="text-micro font-semibold uppercase tracking-wider text-primary">{l("Målet ditt", "Your goal")}</p>
      <h3 className="text-title font-semibold">{goalName}</h3>
      <p className="text-label text-muted-foreground">{new Date(`${targetDate}T12:00:00`).toLocaleDateString(no ? "nb-NO" : "en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
      <p className="mt-2 text-micro text-muted-foreground">{l("Veien videre formes når neste blokk er klar.", "The path ahead takes shape when the next block is ready.")}</p>
    </div>
    <ol reversed className="flex flex-col" aria-label={l("Etapper i denne blokken", "Stages in this block")}>
      {weeks.map((week, i) => <li key={week.weekNumber} ref={i === currentIndex ? current : undefined} aria-current={!archived && i === currentIndex ? "step" : undefined} className="relative ml-5 border-l-2 border-border pb-6 pl-7 scroll-mt-20">
        <span aria-hidden className={`absolute -left-[9px] top-5 size-4 rounded-full border-4 border-background ${i === currentIndex && !archived ? "bg-primary ring-2 ring-primary/30" : "bg-muted-foreground/40"}`} />
        {i === currentIndex && !archived && <p className="mb-2 text-micro font-semibold text-primary">{l("DU ER HER", "YOU ARE HERE")}</p>}
        {children[i]}
      </li>).reverse()}
    </ol>
    <div className="ml-5 flex items-center gap-3 text-label text-muted-foreground"><Footprints size={18} aria-hidden />{l("Start på denne blokken", "Start of this block")}</div>
    <div className="border-t border-border pt-4" aria-live="polite">
      <p className="text-micro font-semibold text-muted-foreground">{l("Milepæler i denne blokken", "Milestones in this block")}</p>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-3">{milestones.map(m => <li key={m.label} className={`flex items-center gap-2 text-label ${m.reached ? "text-success" : "text-muted-foreground"}`}><span className={`flex size-6 items-center justify-center rounded-full border ${m.reached ? "border-success bg-success/10 pop-in" : "border-border"}`} aria-hidden>{m.reached ? <Check size={14} /> : "·"}</span><span>{m.label}<span className="sr-only">{m.reached ? l(" – nådd", " – reached") : l(" – ikke nådd ennå", " – not reached yet")}</span></span></li>)}</ul>
      {progress.recentTotal > 0 && <p className="mt-3 text-label text-muted-foreground">{l(`${progress.recentDone} av de siste ${progress.recentTotal} ukene i blokken gjennomført.`, `${progress.recentDone} of the last ${progress.recentTotal} weeks in this block completed.`)}</p>}
      <p className="mt-2 text-micro text-muted-foreground">{l("En tilpasset uke er også et steg videre. Du trenger ikke ta igjen økter du har hoppet over.", "An adjusted week is a step forward too. You do not need to make up skipped sessions.")}</p>
    </div>
  </section>
}
