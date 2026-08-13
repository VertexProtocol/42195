/**
 * Where a training block sits on the calendar, and what else is on the calendar
 * inside it.
 *
 * A block is generated for one race, and that race sets the periodisation — it
 * is the A race by construction, because it is the goal the runner asked for a
 * plan for. But a runner with a marathon in the autumn does not stop entering
 * 10 km races in the spring, and a block that does not know those races exist
 * will happily prescribe a build week over the top of one.
 *
 * The two things this module settles:
 *
 *  - **when the block runs** — extracted from the generation route, which used
 *    to compute it inline *after* the model call, at which point it was too late
 *    to tell the model what fell inside it;
 *  - **which of the runner's other races fall inside that window**, and what
 *    that does to the affected week's volume.
 */

/** The Monday of the week containing `date`. Weeks run Monday–Sunday. */
export function mondayOf(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  // getDay() is 0 for Sunday, which belongs to the week that began six days ago.
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  d.setHours(0, 0, 0, 0)
  return d
}

/** `YYYY-MM-DD` for a date, in the same form the DB stores block_start_date. */
export function toDateKey(date: Date): string {
  return date.toISOString().split("T")[0]
}

export interface BlockStartInput {
  /** The block currently on file for this goal, if any. */
  prevBlockStartDate?: string | null
  /** How many weeks that block covered. */
  prevWeekCount?: number | null
  /** Defaults to now; injectable so the behaviour is testable. */
  today?: Date
}

/**
 * When the next block begins.
 *
 * Follows on from the previous block rather than restarting the ramp: the
 * Monday after its last week ends. A block whose end has already passed —
 * the runner left it a month before regenerating — starts this Monday instead,
 * because a block that begins in the past is a block whose first weeks are
 * already unachievable.
 */
export function computeBlockStartDate(input: BlockStartInput = {}): string {
  const today = input.today ?? new Date()
  const todayMonday = mondayOf(today)

  if (input.prevBlockStartDate && input.prevWeekCount && input.prevWeekCount > 0) {
    const next = mondayOf(new Date(input.prevBlockStartDate))
    next.setDate(next.getDate() + input.prevWeekCount * 7)
    return toDateKey(next >= todayMonday ? next : todayMonday)
  }

  return toDateKey(todayMonday)
}

export interface BlockWindow {
  start: Date
  /** Exclusive: the Monday after the block's final week. */
  end: Date
}

export function blockWindow(blockStartDate: string, blockWeeks: number): BlockWindow {
  const start = mondayOf(new Date(blockStartDate))
  const end = new Date(start)
  end.setDate(end.getDate() + Math.max(1, blockWeeks) * 7)
  return { start, end }
}

/**
 * Whole weeks still to run in a block, 0 once it has ended.
 *
 * What separates a block worth warning the runner about from one that is merely
 * on file: putting away a block that finished last month costs them nothing,
 * and asking them to confirm it is a dialog about nothing.
 */
export function blockWeeksRemaining(
  blockStartDate: string,
  weekCount: number,
  today: Date = new Date(),
): number {
  const { end } = blockWindow(blockStartDate, weekCount)
  const msPerWeek = 7 * 24 * 60 * 60 * 1000
  return Math.max(0, Math.ceil((end.getTime() - mondayOf(today).getTime()) / msPerWeek))
}

/** A goal the runner holds, as this module needs to see it. */
export interface CalendarRace {
  id: string
  name: string
  target_date: string
  target_distance_km: number
  /**
   * Only `event_training` goals are entries on a start line. A `performance`
   * goal — "sub-40 for 10 km by June" — has a date and a distance too, and
   * without this it would be written into the block as a race the runner had
   * entered and never turns up to.
   */
  goal_category?: string | null
}

export interface RaceInBlock {
  goalId: string
  name: string
  distanceKm: number
  date: string
  /** 0-based index into the block's weeks. */
  weekIndex: number
}

/**
 * The runner's other races falling inside this block.
 *
 * `drivingGoalId` — the race the block is being built for — is excluded: it is
 * not something the block has to work around, it is the thing the block is
 * aimed at. Its own race week is the taper, which the phase logic already owns.
 */
export function racesInBlock(
  races: CalendarRace[],
  drivingGoalId: string,
  blockStartDate: string,
  blockWeeks: number,
): RaceInBlock[] {
  const { start, end } = blockWindow(blockStartDate, blockWeeks)
  const msPerWeek = 7 * 24 * 60 * 60 * 1000

  return races
    .filter((r) => r.id !== drivingGoalId && r.goal_category === "event_training")
    .map((r) => {
      const when = new Date(r.target_date)
      when.setHours(0, 0, 0, 0)
      return { race: r, when }
    })
    .filter(({ when }) => when >= start && when < end)
    .map(({ race, when }) => ({
      goalId: race.id,
      name: race.name,
      distanceKm: Number(race.target_distance_km),
      date: race.target_date,
      weekIndex: Math.floor((when.getTime() - start.getTime()) / msPerWeek),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Two things a race does to the week it lands in.
 *
 * **It does not get to be a step up.** The volume engine ramps week on week; a
 * week containing a race should not also be the biggest week of the block. The
 * target is held at the previous week's level or below — never raised into a
 * start line.
 *
 * **It has to fit.** A 21 km race inside an 18 km week is not a week the runner
 * can run: the race alone overruns it. Where that happens the target rises to
 * hold the race plus one short recovery run, because the alternative — silently
 * allocating the other sessions negative distance — produces a week that looks
 * fine and is not.
 *
 * Later weeks are left alone. They ramp from whatever the race week became,
 * which is the honest base to continue from.
 */
export function holdRaceWeeks(targets: number[], races: RaceInBlock[]): {
  targets: number[]
  notes: string[]
} {
  if (races.length === 0) return { targets, notes: [] }

  const held = [...targets]
  const notes: string[] = []

  // Sum per week: two races in one week is unusual but not impossible, and
  // taking only the longer would under-count the week the runner actually runs.
  const raceKmByWeek = new Map<number, { km: number; names: string[] }>()
  for (const race of races) {
    if (race.weekIndex < 0 || race.weekIndex >= held.length) continue
    const entry = raceKmByWeek.get(race.weekIndex) ?? { km: 0, names: [] }
    entry.km += race.distanceKm
    entry.names.push(race.name)
    raceKmByWeek.set(race.weekIndex, entry)
  }

  for (const [weekIndex, { km, names }] of [...raceKmByWeek.entries()].sort((a, b) => a[0] - b[0])) {
    const before = held[weekIndex]

    // No step up into a race week.
    if (weekIndex > 0 && held[weekIndex] > held[weekIndex - 1]) {
      held[weekIndex] = held[weekIndex - 1]
    }

    // And it has to hold the race itself with something left over.
    const floor = Math.round(km + RECOVERY_RUN_KM)
    if (held[weekIndex] < floor) held[weekIndex] = floor

    if (held[weekIndex] !== before) {
      notes.push(
        `Week ${weekIndex + 1} contains ${names.join(" and ")} (${km.toFixed(1)} km): ` +
        `target ${before} km → ${held[weekIndex]} km.`,
      )
    }
  }

  return { targets: held, notes }
}

/**
 * The shortest week a race week can be beyond the race: one easy run to spin
 * the legs out afterwards. Below this the week is the race and nothing else,
 * which is a race day, not a training week.
 */
const RECOVERY_RUN_KM = 5

/** Kilometres of racing in a given week of the block. */
export function raceKmInWeek(races: RaceInBlock[], weekIndex: number): number {
  return races
    .filter((r) => r.weekIndex === weekIndex)
    .reduce((sum, r) => sum + r.distanceKm, 0)
}

/**
 * How many sessions the coach is asked to prescribe for each week.
 *
 * A race is one of that week's runs, so a week holding one carries a session
 * fewer: asking for the full count and then adding the race on top is how a
 * four-session week quietly becomes five. The count is worked out against what
 * is left after the race, too — a 44 km week with a half marathon in it has
 * 23 km of training in it, not 44, and that is what decides how many useful
 * sessions fit.
 *
 * Never returns zero. A week is not nothing.
 */
export function sessionCountsForBlock(
  weekTargets: number[],
  races: RaceInBlock[],
  supportedCount: (km: number) => number,
): number[] {
  return weekTargets.map((km, weekIndex) => {
    const raceKm = raceKmInWeek(races, weekIndex)
    const raceCount = races.filter((r) => r.weekIndex === weekIndex).length
    return Math.max(1, supportedCount(km - raceKm) - raceCount)
  })
}

export interface RaceSession {
  type: string
  distance: string
  effort: string
  purpose: string
}

/**
 * The races in a week, written as sessions.
 *
 * The `Race:` prefix is load-bearing: it is what `detectZone` matches to leave
 * the entry without a pace, and what tells a reader this is a start line
 * rather than a workout named after one.
 */
export function raceSessionsForWeek(
  races: RaceInBlock[],
  weekIndex: number,
  formatDistance: (km: number) => string,
): RaceSession[] {
  return races
    .filter((r) => r.weekIndex === weekIndex)
    .map((r) => ({
      type: `Race: ${r.name}`,
      distance: formatDistance(r.distanceKm),
      effort: "Race effort — however you have decided to run this one",
      purpose: `${r.name} on ${r.date}. Entered separately; the week is built around it.`,
    }))
}
