import type { Goal, AiTrainingPlan } from "@/lib/types"

export type TrainingPhaseType =
  | "base_building"
  | "endurance_development"
  | "peak_training"
  | "taper"
  | "race_week"

export interface TrainingPhase {
  type: TrainingPhaseType
  startDate: Date
  endDate: Date
  weekStart: number   // week number from training start (1-based)
  weekEnd: number     // inclusive
  totalWeeks: number
  description: string
}

export interface TrainingTimeline {
  phases: TrainingPhase[]
  totalWeeks: number
  currentWeek: number          // 1-based, 0 if before start
  currentPhase: TrainingPhase | null
  nextPhase: TrainingPhase | null
  weeksRemaining: number
  progressPct: number          // 0–100
  raceDate: Date
  startDate: Date
}

const PHASE_CONFIG: Record<TrainingPhaseType, {
  /** fraction of total training weeks allocated to this phase */
  fraction: number
  /** minimum weeks for the phase (0 = can be skipped) */
  minWeeks: number
  /** hard ceiling — excess weeks flow back to earlier phases */
  maxWeeks?: number
}> = {
  base_building:         { fraction: 0.30, minWeeks: 2 },
  endurance_development: { fraction: 0.30, minWeeks: 2 },
  peak_training:         { fraction: 0.20, minWeeks: 1 },
  taper:                 { fraction: 0.13, minWeeks: 2, maxWeeks: 3 },
  race_week:             { fraction: 0.07, minWeeks: 1, maxWeeks: 1 },
}

const PHASE_ORDER: TrainingPhaseType[] = [
  "base_building",
  "endurance_development",
  "peak_training",
  "taper",
  "race_week",
]

function toMonday(d: Date): Date {
  const out = new Date(d)
  const day = out.getDay()
  const diff = day === 0 ? -6 : 1 - day
  out.setDate(out.getDate() + diff)
  out.setHours(0, 0, 0, 0)
  return out
}

function weeksBetween(a: Date, b: Date): number {
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / (7 * 24 * 60 * 60 * 1000)))
}

/** Distribute `total` weeks among phases proportionally, respecting minimums. */
function distributeWeeks(total: number): Map<TrainingPhaseType, number> {
  const result = new Map<TrainingPhaseType, number>()

  // Very short plans (< 4 weeks): collapse into fewer phases
  if (total <= 2) {
    result.set("base_building", 0)
    result.set("endurance_development", 0)
    result.set("peak_training", 0)
    result.set("taper", Math.max(0, total - 1))
    result.set("race_week", 1)
    return result
  }

  if (total <= 4) {
    result.set("base_building", 0)
    result.set("endurance_development", Math.max(0, total - 2))
    result.set("peak_training", 0)
    result.set("taper", 1)
    result.set("race_week", 1)
    return result
  }

  // Allocate minimums first
  let remaining = total
  for (const phase of PHASE_ORDER) {
    const min = PHASE_CONFIG[phase].minWeeks
    result.set(phase, min)
    remaining -= min
  }

  // Distribute remaining proportionally
  if (remaining > 0) {
    const totalFraction = PHASE_ORDER.reduce((s, p) => s + PHASE_CONFIG[p].fraction, 0)
    const extras: { phase: TrainingPhaseType; frac: number }[] = PHASE_ORDER.map((p) => ({
      phase: p,
      frac: PHASE_CONFIG[p].fraction / totalFraction,
    }))

    // Integer distribution with largest remainder method
    const rawAlloc = extras.map((e) => ({
      phase: e.phase,
      raw: e.frac * remaining,
      floor: Math.floor(e.frac * remaining),
    }))
    let distributed = rawAlloc.reduce((s, a) => s + a.floor, 0)
    rawAlloc.forEach((a) => result.set(a.phase, result.get(a.phase)! + a.floor))

    // Assign leftover to phases with largest remainders
    const sorted = [...rawAlloc].sort((a, b) => (b.raw - b.floor) - (a.raw - a.floor))
    let idx = 0
    while (distributed < remaining) {
      result.set(sorted[idx].phase, result.get(sorted[idx].phase)! + 1)
      distributed++
      idx++
    }
  }

  // Apply maxWeeks caps — overflow flows to peak_training (highest-intensity phase)
  for (const phase of PHASE_ORDER) {
    const max = PHASE_CONFIG[phase].maxWeeks
    if (max !== undefined) {
      const allocated = result.get(phase) ?? 0
      if (allocated > max) {
        const overflow = allocated - max
        result.set(phase, max)
        result.set("peak_training", (result.get("peak_training") ?? 0) + overflow)
      }
    }
  }

  // Remove phases with 0 weeks
  for (const phase of PHASE_ORDER) {
    if (result.get(phase) === 0) result.delete(phase)
  }

  return result
}

/** Parse a date string that may be date-only ("2026-09-12") or full ISO datetime */
function parseDate(s: string): Date {
  // If it already contains a time component, parse directly
  if (s.includes("T") || s.includes(" ")) return new Date(s)
  // Date-only: add noon to avoid timezone drift
  return new Date(s + "T12:00:00")
}

export function computeTrainingTimeline(
  goal: Goal,
  _aiPlan?: AiTrainingPlan | null,
): TrainingTimeline | null {
  const raceDate = parseDate(goal.target_date)
  const startDate = goal.start_date
    ? parseDate(goal.start_date)
    : new Date(goal.created_at)

  const raceMonday = toMonday(raceDate)
  const startMonday = toMonday(startDate)
  const now = new Date()

  // Don't show timeline if race is in the past
  if (raceMonday.getTime() <= startMonday.getTime()) return null

  const totalWeeks = weeksBetween(startMonday, raceMonday)
  const weekDistribution = distributeWeeks(totalWeeks)

  // Build phases
  const phases: TrainingPhase[] = []
  let weekCursor = 1
  let dateCursor = new Date(startMonday)

  for (const phaseType of PHASE_ORDER) {
    const weeks = weekDistribution.get(phaseType)
    if (!weeks || weeks === 0) continue

    const phaseStart = new Date(dateCursor)
    const phaseEnd = new Date(dateCursor)
    phaseEnd.setDate(phaseEnd.getDate() + weeks * 7)

    phases.push({
      type: phaseType,
      startDate: phaseStart,
      endDate: phaseEnd,
      weekStart: weekCursor,
      weekEnd: weekCursor + weeks - 1,
      totalWeeks: weeks,
      description: getPhaseDescription(phaseType, weeks, goal.target_distance_km),
    })

    weekCursor += weeks
    dateCursor = phaseEnd
  }

  // Current week (1-based)
  const elapsed = now.getTime() - startMonday.getTime()
  const currentWeek = elapsed < 0
    ? 0
    : Math.min(totalWeeks, Math.floor(elapsed / (7 * 24 * 60 * 60 * 1000)) + 1)

  const currentPhase = phases.find(
    (p) => currentWeek >= p.weekStart && currentWeek <= p.weekEnd
  ) ?? null

  const currentPhaseIdx = currentPhase ? phases.indexOf(currentPhase) : -1
  const nextPhase = currentPhaseIdx >= 0 && currentPhaseIdx < phases.length - 1
    ? phases[currentPhaseIdx + 1]
    : null

  const weeksRemaining = Math.max(0, totalWeeks - currentWeek)
  const progressPct = totalWeeks > 0
    ? Math.min(100, Math.round((currentWeek / totalWeeks) * 100))
    : 0

  return {
    phases,
    totalWeeks,
    currentWeek,
    currentPhase,
    nextPhase,
    weeksRemaining,
    progressPct,
    raceDate,
    startDate: startMonday,
  }
}

function getPhaseDescription(
  type: TrainingPhaseType,
  weeks: number,
  distanceKm: number,
): string {
  const isMarathon = distanceKm >= 42
  const isHalf = distanceKm >= 20 && distanceKm < 42

  switch (type) {
    case "base_building":
      return isMarathon
        ? "Build aerobic foundation with easy runs and gradual mileage increases"
        : "Establish consistent running habit with easy-effort mileage"
    case "endurance_development":
      return isMarathon
        ? "Introduce long runs and tempo work to build marathon-specific endurance"
        : isHalf
          ? "Extend long runs and add tempo sessions for half marathon preparation"
          : "Increase distance and add structured workouts to build race fitness"
    case "peak_training":
      return isMarathon
        ? "Highest mileage weeks with race-pace long runs and marathon simulations"
        : "Peak intensity with race-specific workouts and longest training runs"
    case "taper":
      return "Reduce volume while maintaining intensity to arrive fresh on race day"
    case "race_week":
      return "Final easy runs, rest, and race-day preparation"
  }
}
