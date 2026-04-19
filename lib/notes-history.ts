/**
 * Versioned notes history for goal preferences.
 *
 * When a user saves coach notes or injury notes, we snapshot the surrounding
 * training block context so the AI can reason about *when* and *under what load*
 * each note was written.
 */

export interface NoteHistoryEntry {
  content: string
  type: "coach" | "injury"
  added_at: string             // ISO timestamp — used as a stable entry ID
  resolved_at: string | null   // ISO timestamp if the issue has been resolved, else null
  block_start_date: string | null
  block_week: number | null    // 1-based week within the block
  block_total_weeks: number | null
  training_phase: string | null  // "base" | "build" | "taper"
  weekly_km_target: number | null
  sessions_per_week: number | null
}

/** Mirror of the phase logic in the plan generator. */
export function getPhaseLabel(weekIndex: number, totalWeeks: number): string {
  const taperWeeks = Math.min(3, Math.max(1, Math.floor(totalWeeks * 0.15)))
  const buildWeeks = Math.max(2, Math.floor(totalWeeks * 0.25))
  const baseWeeks = totalWeeks - buildWeeks - taperWeeks
  if (weekIndex < baseWeeks) return "base"
  if (weekIndex < baseWeeks + buildWeeks) return "build"
  return "taper"
}

/**
 * True if the history has at least one injury entry that hasn't been marked
 * as resolved. Used by plan generation to apply a tighter volume cap on
 * return from pause.
 */
export function hasActiveInjury(
  history: NoteHistoryEntry[] | null | undefined,
): boolean {
  if (!history) return false
  return history.some((e) => e.type === "injury" && !e.resolved_at)
}

function formatEntryLabel(entry: NoteHistoryEntry): string {
  const date = new Date(entry.added_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  const parts: string[] = [date]
  if (entry.block_week && entry.block_total_weeks) {
    parts.push(`Block wk ${entry.block_week}/${entry.block_total_weeks}`)
    if (entry.training_phase) parts.push(entry.training_phase)
  }
  if (entry.weekly_km_target) parts.push(`${entry.weekly_km_target} km/wk target`)
  if (entry.sessions_per_week) parts.push(`${entry.sessions_per_week} sessions/wk`)
  return parts.join(" · ")
}

/**
 * Formats the injury history for use in an AI prompt, splitting active and
 * resolved entries so the model treats them with appropriate weight.
 *
 * For coach notes (type "coach") there is no resolved concept — all entries
 * are returned under a single heading, most recent first.
 */
export function formatNotesHistoryForPrompt(
  entries: NoteHistoryEntry[],
  type: "coach" | "injury",
): string | null {
  const filtered = entries.filter((e) => e.type === type)
  if (filtered.length === 0) return null

  const sorted = [...filtered].sort(
    (a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime(),
  )

  if (type === "coach") {
    return sorted.map((e) => `  • [${formatEntryLabel(e)}]: "${e.content}"`).join("\n")
  }

  // Injury entries: separate active from resolved
  const active = sorted.filter((e) => !e.resolved_at)
  const resolved = sorted.filter((e) => e.resolved_at)

  const parts: string[] = []

  if (active.length > 0) {
    parts.push(
      "  Active (restrict volume/intensity to avoid aggravating these):\n" +
        active.map((e) => `    • [${formatEntryLabel(e)}]: "${e.content}"`).join("\n"),
    )
  }

  if (resolved.length > 0) {
    parts.push(
      "  Resolved (historical context only — do NOT restrict training based on these):\n" +
        resolved
          .map((e) => {
            const resolvedDate = new Date(e.resolved_at!).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
            return `    • [${formatEntryLabel(e)} · resolved ${resolvedDate}]: "${e.content}"`
          })
          .join("\n"),
    )
  }

  return parts.join("\n")
}
