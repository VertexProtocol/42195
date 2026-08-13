# WEEKLY_GOALS_PLAN.md — suggested weekly targets

How weekly targets stop being a blank number box and start being derived from
the runner's race targets, their plan, and their history. Product truth lives in
`PRODUCT.md`; this file is the implementation plan for one change and can be
deleted once the change has landed.

## The problem

`weekly_goals` is disconnected from everything else the app knows. The editor
(`components/weekly-goal-editor.tsx`) opens on an empty field, so the runner
guesses a number — while the app already holds, for the same week:

| Already exists | Where | What it gives us |
|---|---|---|
| Deterministic weekly volume with ACWR, comeback cap, progression caps | `lib/training-volume.ts` → `computeWeeklyTargets` | this week's km, within safety limits |
| The generated block's weeks | `ai_training_plans.plan.weeks[]` | `targetKm` + session count per week |
| Phase map without a generated plan | `lib/training-timeline.ts` | base / build / peak / taper for any target goal |
| Sessions per week | `goal_preferences.sessions_per_week` | the sessions target |
| Manual ordering of target goals | `goals.display_order`, drag-and-drop in `goals-screen.tsx` | priority, at no schema cost |

So this is not a new calculation. It is wiring numbers we already produce.

**The rule that governs the whole change: there must be exactly one volume
model.** Suggestions go through `computeWeeklyTargets`, never around it.
`lib/training-volume.ts` documents what the alternative cost last time — four
passes that did not know about each other, compounding into 60% of an already
conservative baseline for a returning runner. If Plan and the AI block disagree
about this week's kilometres, the feature is worse than the blank box.

## The model

A weekly target gains a provenance. Three sources, first match wins:

1. **`plan`** — an active AI block covers this week. Week index is
   `(monday(now) − monday(block_start_date)) / 7`; that arithmetic already
   exists in `goal-detail-screen.tsx`. Gives `targetKm` and `sessions.length`.
   An expired block falls through to 2.
2. **`target`** — a target goal with no plan (or an expired one). Run
   `computeWeeklyTargets` over the runner's history for the goal's block, take
   the week we are standing in. Sessions from `goal_preferences.sessions_per_week`.
3. **`history`** — no target goals at all. Median of the last 4 active weeks
   (median, not mean: one holiday or one injury week must not drag the
   suggestion down), plus progression capped by `MAX_WEEKLY_INCREASE[level]`.
   Under three weeks of data: suggest holding level, not increasing, and say
   how thin the evidence is.

Only two metrics are suggested: `distance_km` and `sessions`.
`duration_minutes` is a restatement of distance through average pace, and
nothing in the data model says whether a race is on trails, so `elevation_m`
has no honest basis. PRODUCT.md: the runner came for a number and a decision.

### Multiple target goals

Volume does not add. Two 40 km plans are not an 80 km week — the body has one
load budget, and an app that runs an injury-risk engine cannot be the thing
that suggests the sum. Taking the max across goals is the same failure wearing
a hat: you inherit the most aggressive goal's peak without its taper.

One goal sets the pace; the others act as constraints:

```
candidates  = goals where is_active
                     and target_date is in the future
                     and (start_date is null or start_date <= end of week)
pacesetter  = first event_training goal by display_order
weekKm      = volume from the pacesetter (source 1 or 2 above)

# safety clamp — a rule, not a preference:
for every other candidate racing within TAPER_CLAMP_DAYS:
    weekKm = min(weekKm, that goal's taper volume for this week)
```

A marathon in November as the A goal and a 10 km on Saturday must not produce a
60 km week into the 10 km. Tapering is a `min`, never a priority contest.

**Performance goals do not compete for volume.** "10 km under 50 min" says
nothing about weekly mileage; it is a session requirement. They contribute a
session suggestion, and they are skipped when picking the pacesetter.

### Where priority is chosen

The Plan tab's Targets list already has drag-and-drop ordering that currently
means nothing (`goals.display_order`, written by `onReorderGoals`). Reuse it as
priority rather than adding a fourth flag: `goals` already carries `is_active`,
`is_starred` and `display_order`, and a `priority` column on top of those would
be a third overlapping way to say "this is the important one".

The cost is that the order silently gains a meaning for runners who ordered by
taste. That has to be made visible — an "A" marker on the top in-window goal and
a line under the list saying what the order drives — so the redefinition is
seen rather than hidden.

### Persistence

**A suggestion is not written to the database until it is accepted.** It is a
pure function of (goals, plans, activities, week). Materialising a row every
Monday needs a scheduler the app does not have (`vercel.json` has no cron), and
produces ghost rows for every week the runner never opened the app.

The consequence is that an unaccepted suggestion changes retroactively if the
plan is regenerated. That is acceptable here: `is_recurring` already behaves
this way — a recurring goal is rendered into every past week at its current
value (`goals-screen.tsx`). No promise the app makes today is broken.

One thing follows from it: `deriveGetStartedSteps` marks the "week" step done
when `weeklyGoalCount > 0`, so a purely ephemeral suggestion would leave the
checklist permanently open. Accepting must write a row — which it does, in
step 2.

## Steps

### Step 1 — the engine, plus the date fixes it stands on — **done**

No schema change. Full value for a new runner, no migration risk.

1. `lib/week.ts` — one Monday helper. Replaces the copies in
   `goals-screen.tsx`, `weekly-goal-editor.tsx` and `training-timeline.ts`.
2. Fix `computeWeeklyProgress` parsing its week start as UTC (below).
3. `lib/weekly-suggestions.ts` — `suggestWeeklyGoals(...)`, pure, returning
   `{ metric, target, source, sourceGoalId, reasonKey, reasonValues }`.
   Reasons are i18n keys, never assembled sentences.
4. `lib/weekly-suggestions.test.ts`.
5. `app/page.tsx` derives a compact plan digest from the `ai_training_plans`
   rows it already fetches — `{ goalId, blockStartDate, weeks: [{targetKm,
   sessionCount}] }` — so the plan JSON stays on the server, and the client can
   recompute suggestions against live activities after a sync.
6. Suggestions replace the empty state on Plan → Weekly, and prefill
   `WeeklyGoalEditor` with the number and its reason.
7. i18n keys in both languages.
8. The race-proximity clamp. Moved forward from step 3, where it was first
   written down: it is the safety half of the multi-goal rule, it is about
   twenty lines, and leaving the engine free to suggest a 48 km week into
   Saturday's race for two more steps is not a defensible gap. What stays in
   step 3 is the visible half — making the drag order legible as priority.

### Step 2 — suggestions as first-class objects — **done**

Landed as `scripts/034_weekly_goal_provenance.sql` — 031 through 033 were taken
by other work in the meantime. It differs from the sketch below in one place:
`dismissed_at` is not a column on `weekly_goals` but its own table,
`weekly_suggestion_dismissals`. A dismissal is keyed by the metric and the
source goal and deliberately *not* by the week, so a row in a week-scoped table
would have carried a `week_start` that had to be ignored and a `target` that
meant nothing — in the one table every screen reads to find what the runner is
working to.

```sql
alter table public.weekly_goals
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'plan', 'target', 'history')),
  add column if not exists source_goal_id uuid references public.goals(id) on delete set null,
  add column if not exists suggested_target numeric(10,2),
  add column if not exists dismissed_at timestamptz;
```

- Accept / edit / dismiss on the suggestion card.
- Editing an accepted suggestion keeps `suggested_target`, so the card can say
  "adjusted from 42 km".
- Dismissal sticks per (metric, source goal), **not** per week. A suggestion
  that returns every Monday after being dismissed is nagging.
- A manual recurring goal for a metric beats the suggestion for that metric;
  the suggestion degrades to a hint with a one-tap "use the plan's number".
- A regenerated plan or an applied `MidBlockCheckpoint` must not move an
  accepted target under the runner's feet — ask, don't rewrite.

### Step 3 — priority and multi-goal resolution — **done**

- Plan → Targets: the existing drag order becomes priority, labelled, with an
  "A" marker on the pacesetter. The engine already reads the order; nothing on
  screen says so yet, which is the part that has to be fixed here.
- Performance goals contribute a session suggestion instead of volume. They
  are currently skipped entirely — they neither set the pace nor clamp — which
  is right for volume and leaves their session requirement on the table.
- Let the week navigator step one week forward when a plan covers it. It is
  capped at the current week today (`canGoForward`), which is right for
  history but wrong once the app can say what next week should hold.

### Step 4 — the server-side week boundary — **done**

Split out because it needed a decision the other steps did not.

`lib/strava-sync.ts` computed the current week in **UTC** while every client
path computes it in **local** time. For UTC+1/+2 that is a real disagreement: a
run at 00:30 Monday local is Sunday 23:30 UTC, so the server filed it in the
previous week and the client in the current one. It wrote
`weekly_goals.current`, which the client then overwrote with its own
`computeWeeklyProgress`.

The two options were: store a timezone on `profiles` and use it server-side, or
stop writing `current` from sync and treat activities as the single source of
truth. **The second was taken.**

What decided it was reading the readers. Nothing reads the column: `app/page.tsx`
and `use-app-data.ts` loaded it into state, and every screen that renders a
weekly figure — Plan, Today — recomputes from the activity list instead. So the
write was a second answer nobody asked for, and the disagreement only mattered
*because* the write existed. Storing a timezone would have made the server agree
with the client about a number the client never uses.

The write is gone, and `current` is gone from `WeeklyGoal` and from every query
that selected it, so the column cannot quietly come back into use. The column
itself stays: dropping it is a migration whose only benefit is tidiness, on a
table every screen reads.

Fixes 4 and 5 below are untouched by this, and stay open. The AI plan route
still groups activities into UTC calendar weeks; that is a server-side
calculation with no client counterpart to disagree with, and changing it changes
what the generator produces.

## Fixes folded in

Found while reading the goal stack; each is small and sits directly under this
change.

1. **`computeWeeklyProgress` reads its week window in UTC** (`lib/format.ts`).
   `new Date("2026-08-10")` is UTC midnight, so for UTC+2 the week runs Monday
   02:00 → Monday 02:00 local. A run at 01:00 on Monday counts toward the
   previous week — against a `week_start` string that was built from *local*
   time by `localMondayStr`. Fixed in step 1: parse the week start as local.
2. **Three copies of "find Monday"** — `goals-screen.tsx`,
   `weekly-goal-editor.tsx`, `training-timeline.ts`, plus the UTC variant in
   `strava-sync.ts`. Suggestions are computed on both server and client, so an
   off-by-one week here becomes a visibly wrong target. Consolidated in step 1
   (`lib/week.ts`); the sync copy is step 4.
3. **The label round-trip in `WeeklyGoalEditor`** — the canonical English label
   is recovered by translating a key and comparing the result against the same
   translations. It works only as long as no two metric labels ever translate
   alike. The canonical label belongs in `METRIC_OPTIONS`. Fixed in step 1.

Found while building step 1, noted rather than fixed:

4. **Two volume baselines.** `computeVolumeBaseline` (`lib/training-volume.ts`)
   measures rolling seven-day windows; `app/api/ai/training-plan/route.ts`
   groups activities into UTC calendar weeks and averages the last four. The
   route's version counts the current partial week as a whole one, so
   regenerating a plan on Tuesday asks for less than the same runner would get
   on Sunday. Unifying them changes what the plan generator produces, which is
   a change to make deliberately and test on its own — not a side effect of
   adding suggestions.
5. **A fifth week-boundary implementation** lives in that route's
   `groupActivitiesByWeek`, in UTC. Same family as fix 2, same reason it is
   left alone: it runs server-side, where local time is not knowable. Step 4.

Noted, not fixed here:

- `weekly_goals.current` is written by sync and ignored by every reader, which
  recomputes from activities. Step 4 territory.
- A recurring weekly goal renders into weeks that predate its creation. It is
  what makes compute-on-read acceptable above, so it stays until someone
  decides weekly history should be immutable — at which point suggestions and
  recurring goals both need materialising, together.
