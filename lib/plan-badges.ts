/**
 * Plan badges for the starred-goal cards on Today.
 *
 * Kept out of the screen so the server can derive them during the page render:
 * counting a block's weeks needs the whole plan JSON, which is kilobytes per
 * goal and was previously shipped to the browser for the sake of two booleans.
 */

export interface PlanBadge {
  /** A mid-block checkpoint has adjusted the remaining weeks. */
  checkpoint: boolean
  /** The block's last week is in the past — time to regenerate. */
  blockCompleted: boolean
}

export interface PlanBadgeRow {
  goal_id: string
  block_start_date: string
  plan: unknown
  mid_block_checkpoint: unknown
}

/** Monday of the week `date` falls in, at local midnight. */
function startOfWeek(date: Date): Date {
  const monday = new Date(date)
  monday.setHours(0, 0, 0, 0)
  const day = monday.getDay()
  monday.setDate(monday.getDate() + (day === 0 ? -6 : 1 - day))
  return monday
}

/**
 * @param rows Plan rows for the goals worth badging
 * @param now  Evaluation time — passed in so the result is testable
 */
export function derivePlanBadges(
  rows: PlanBadgeRow[],
  now: Date = new Date(),
): Record<string, PlanBadge> {
  const badges: Record<string, PlanBadge> = {}

  for (const row of rows) {
    // Snap to Monday (same as goal-detail-screen) so blockEnd lands on a week
    // boundary.
    const weeks = (row.plan as { weeks?: unknown })?.weeks
    const weekCount = Array.isArray(weeks) ? weeks.length : 0

    const blockEnd = startOfWeek(new Date(row.block_start_date))
    blockEnd.setDate(blockEnd.getDate() + weekCount * 7)

    badges[row.goal_id] = {
      checkpoint: !!(row.mid_block_checkpoint as { adjustmentApplied?: unknown } | null)
        ?.adjustmentApplied,
      blockCompleted: weekCount > 0 && now > blockEnd,
    }
  }

  return badges
}
