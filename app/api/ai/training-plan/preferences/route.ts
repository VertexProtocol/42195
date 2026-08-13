import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { type NoteHistoryEntry, hasActiveInjury, containsNewActiveInjury } from "@/lib/notes-history"
import { racePhase, daysUntil } from "@/lib/training-phase"
import { PLAN_REGENERATE_COOLDOWN_MS } from "@/lib/training-constants"

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const goalId = req.nextUrl.searchParams.get("goalId")
  if (!goalId) return NextResponse.json({ error: "goalId is required" }, { status: 400 })

  const { data } = await supabase
    .from("goal_preferences")
    .select("*")
    .eq("goal_id", goalId)
    .maybeSingle()

  if (!data) return NextResponse.json({ preferences: null })

  return NextResponse.json({
    preferences: {
      goal_id: data.goal_id,
      sessions_per_week: data.sessions_per_week,
      focus: data.focus,
      notes: data.notes ?? null,
      injury_notes: (data as any).injury_notes ?? null,
      notes_history: (data as any).notes_history ?? [],
      weekly_increase_pct: data.weekly_increase_pct ?? 10,
      block_weeks: data.block_weeks ?? 4,
      regenerate_every_weeks: data.regenerate_every_weeks ?? 4,
    },
  })
}

// PATCH — mark a specific notes_history entry as resolved
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: { goalId?: string; entry_added_at?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { goalId, entry_added_at } = body
  if (!goalId || !entry_added_at) {
    return NextResponse.json({ error: "goalId and entry_added_at are required" }, { status: 400 })
  }

  const { data: row } = await supabase
    .from("goal_preferences")
    .select("notes_history")
    .eq("goal_id", goalId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!row) return NextResponse.json({ error: "Preferences not found" }, { status: 404 })

  const history: NoteHistoryEntry[] = (row as any).notes_history ?? []
  const updated = history.map((e) =>
    e.added_at === entry_added_at && !e.resolved_at
      ? { ...e, resolved_at: new Date().toISOString() }
      : e,
  )

  const { error } = await supabase
    .from("goal_preferences")
    .update({ notes_history: updated })
    .eq("goal_id", goalId)
    .eq("user_id", user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ notes_history: updated })
}

const PreferencesSchema = z.object({
  goalId: z.string().uuid(),
  sessions_per_week: z.number().int().min(1).max(14),
  focus: z.enum(["volume", "workouts", "balanced"]),
  notes: z.string().max(500).nullable().optional(),
  injury_notes: z.string().max(500).nullable().optional(),
  // Capped at 10: MAX_WEEKLY_INCREASE allows 8-12% depending on athlete level,
  // so a higher request was always clipped back — and the runner was told their
  // week had been "reduced for safety" for using a control we offered them.
  weekly_increase_pct: z.number().int().min(0).max(10).default(10),
  block_weeks: z.number().int().min(1).max(20).default(4),
  regenerate_every_weeks: z.number().int().min(1).max(12).default(4),
})

// PUT — save/update preferences for a goal
export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = PreferencesSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
  }

  const { goalId, sessions_per_week, focus, notes, injury_notes, weekly_increase_pct, block_weeks, regenerate_every_weeks } = parsed.data

  // Fetch current prefs, active plan and the goal, to compare notes and capture
  // the block context a note was written under.
  const [{ data: currentPrefs }, { data: activePlan }, { data: goal }] = await Promise.all([
    supabase
      .from("goal_preferences")
      .select("notes, injury_notes, notes_history")
      .eq("goal_id", goalId)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("ai_training_plans")
      .select("plan, block_start_date, generated_at")
      .eq("goal_id", goalId)
      .eq("user_id", user.id)
      .is("archived_at", null)
      .maybeSingle(),
    supabase
      .from("goals")
      .select("target_date")
      .eq("id", goalId)
      .eq("user_id", user.id)
      .maybeSingle(),
  ])

  // Build block context snapshot for any notes that changed
  const now = new Date().toISOString()
  const existingHistory: NoteHistoryEntry[] = (currentPrefs as any)?.notes_history ?? []
  const newEntries: NoteHistoryEntry[] = []

  const plan = activePlan?.plan as { weeks?: Array<{ targetKm?: number }> } | null
  const blockStartDate = activePlan?.block_start_date ?? null
  let blockWeekIndex: number | null = null
  let blockTotalWeeks: number | null = null
  let weeklyKmTarget: number | null = null

  if (plan?.weeks && blockStartDate) {
    const msPerWeek = 7 * 24 * 60 * 60 * 1000
    blockWeekIndex = Math.floor((Date.now() - new Date(blockStartDate).getTime()) / msPerWeek)
    blockTotalWeeks = plan.weeks.length
    if (blockWeekIndex >= 0 && blockWeekIndex < blockTotalWeeks) {
      weeklyKmTarget = plan.weeks[blockWeekIndex]?.targetKm ?? null
    } else {
      blockWeekIndex = null // outside the block
    }
  }

  const blockContext = {
    block_start_date: blockStartDate,
    block_week: blockWeekIndex !== null ? blockWeekIndex + 1 : null,
    block_total_weeks: blockTotalWeeks,
    // The phase of the training cycle, not of the block. getPhaseLabel used to
    // fill this in from the note's position within its four-week block, so a
    // note could be tagged "build" meaning "week 3 of 4" while the cycle was
    // still base-building — and both readings reached the coach.
    training_phase: goal?.target_date ? racePhase(daysUntil(goal.target_date)) : null,
    weekly_km_target: weeklyKmTarget,
    sessions_per_week,
  }

  const prevNotes = currentPrefs?.notes ?? null
  const prevInjuryNotes = (currentPrefs as any)?.injury_notes ?? null

  // An injury was already active before this save. Used twice below: editing an
  // existing note supersedes it rather than stacking a duplicate, and only a
  // genuinely new injury is worth interrupting the user to regenerate for.
  const hadActiveInjury = hasActiveInjury(existingHistory)

  if ((notes || null) !== prevNotes && notes) {
    newEntries.push({ content: notes, type: "coach", added_at: now, resolved_at: null, ...blockContext })
  }

  // Editing the injury text replaces the active entry instead of appending a
  // second one. Without this, fixing a typo leaves two contradictory "active"
  // injuries in the history, and both get sent to the coach as current.
  let supersededHistory = existingHistory
  if ((injury_notes || null) !== prevInjuryNotes && injury_notes) {
    supersededHistory = existingHistory.map((e) =>
      e.type === "injury" && !e.resolved_at ? { ...e, resolved_at: now } : e,
    )
    newEntries.push({ content: injury_notes, type: "injury", added_at: now, resolved_at: null, ...blockContext })
  }

  const updatedHistory = newEntries.length > 0 ? [...supersededHistory, ...newEntries] : existingHistory

  // One write. This used to be three — the base columns, then injury_notes and
  // notes_history, then plan_mode — each justified by the column possibly not
  // existing yet. The migrations are in the repo and are idempotent, and the
  // split meant a save could half-succeed and still answer ok: true.
  const { error } = await supabase.from("goal_preferences").upsert(
    {
      goal_id: goalId,
      user_id: user.id,
      sessions_per_week,
      focus,
      notes: notes || null,
      injury_notes: injury_notes || null,
      notes_history: updatedHistory,
      weekly_increase_pct: weekly_increase_pct ?? 10,
      block_weeks: block_weeks ?? 4,
      regenerate_every_weeks: regenerate_every_weeks ?? 4,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "goal_id" }
  )

  if (error) {
    console.error("Failed to save goal preferences:", error)
    return NextResponse.json({ error: error.message ?? "Failed to save preferences" }, { status: 500 })
  }

  // Signal the client to regenerate the plan immediately when a new active
  // injury was just logged. Resolving an existing injury or adding a coach
  // note does NOT auto-regenerate — the user can trigger that manually.
  //
  // Two gates, both of which used to be missing:
  //   - `!hadActiveInjury`: editing the wording of an injury the coach already
  //     knows about is not new information. Regenerating on a typo fix is noise.
  //   - cooldown: POST refuses to regenerate within PLAN_REGENERATE_COOLDOWN_MS,
  //     so telling the client to regenerate inside that window only produces a
  //     429 the user reads as "saving my injury failed".
  const lastGeneratedAt = activePlan?.generated_at
    ? new Date(activePlan.generated_at).getTime()
    : null
  const inCooldown =
    lastGeneratedAt !== null && Date.now() - lastGeneratedAt < PLAN_REGENERATE_COOLDOWN_MS

  const newActiveInjury =
    containsNewActiveInjury(newEntries) && !hadActiveInjury && !inCooldown

  return NextResponse.json({
    ok: true,
    shouldRegenerate: newActiveInjury,
    regenerateReason: newActiveInjury ? "new_active_injury" : null,
  })
}
