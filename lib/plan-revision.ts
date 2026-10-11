import type { TrainingPlan } from './types'
import { allocateSessionDistances, formatSessionDistance, parseSessionDistanceKm, supportedSessionCount } from './training-sessions'

/** Keep history immutable and preserve settled sessions when revising a live block. */
export function preservePlanProgress(
  previous: TrainingPlan,
  revised: TrainingPlan,
  statuses: Record<string, string>,
  blockStart: string,
  now = new Date(),
): TrainingPlan {
  const current = Math.max(0, Math.floor((+now - +new Date(blockStart)) / (7 * 86400000)))
  return { ...revised, weeks: revised.weeks.map((week, wi) => {
    const old = previous.weeks[wi]
    if (!old) return week
    if (wi < current) return old
    if (wi !== current) return week
    const settled = old.sessions.map((session, i) => ({session, i, status: statuses[`W${old.weekNumber}-${i}`]}))
      .filter(s => s.status === 'completed' || s.status === 'skipped')
    if (!settled.length) return week
    const fixedKm = settled.reduce((sum, s) => sum + parseSessionDistanceKm(s.session.distance), 0)
    const remainingKm = Math.max(0, week.targetKm - fixedKm)
    const pending = week.sessions.slice(0, remainingKm >= 1 ? supportedSessionCount(remainingKm, Math.max(1, week.sessions.length - settled.length), 'balanced') : 0)
    const cap = Math.max(0, ...week.sessions.map(s => parseSessionDistanceKm(s.distance)))
    const distances = allocateSessionDistances(remainingKm, pending.map(s => s.type), cap)
    const replacement = pending.map((s, i) => ({ ...s, distance: formatSessionDistance(distances.distances[i]) }))
    const sessions = [...settled.map(s => s.session), ...replacement]
    return { ...week, sessions, targetKm: sessions.reduce((sum, s) => sum + parseSessionDistanceKm(s.distance), 0) }
  }) }
}
