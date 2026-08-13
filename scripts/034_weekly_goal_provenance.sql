-- Migration 034: where a weekly target came from, and what was turned down
--
-- Weekly targets are now offered rather than only typed (see
-- WEEKLY_GOALS_PLAN.md). A suggestion stays out of the database until the
-- runner accepts it — it is a pure function of the goals, the plans and the
-- activities, recomputed on read. What has to be stored is the two things that
-- function cannot recover afterwards: which offer a saved row came from, and
-- which offers were turned down.
--
--   source            'manual' for a number the runner typed, otherwise the
--                     provenance the engine gave it. Defaulting to 'manual'
--                     is the honest reading of every row that already exists.
--
--   source_goal_id    the race the number was derived from. Null for a
--                     history-based suggestion, which belongs to no race.
--                     Set null rather than deleted with the goal: the target
--                     the runner committed to is still their target for this
--                     week, it has just lost its explanation.
--
--   suggested_target  what was offered, kept when the runner edits the number
--                     so the card can say "adjusted from 42 km". Without it an
--                     edited suggestion is indistinguishable from a typed one,
--                     and the app forgets it ever had an opinion.

alter table public.weekly_goals
  add column if not exists source           text not null default 'manual',
  add column if not exists source_goal_id   uuid references public.goals(id) on delete set null,
  add column if not exists suggested_target numeric(10,2);

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'weekly_goals_source_check'
  ) then
    alter table public.weekly_goals
      add constraint weekly_goals_source_check
      check (source in ('manual', 'plan', 'target', 'history'));
  end if;
end $$;


-- A dismissal is not a goal, so it is not a weekly_goals row.
--
-- It is also not weekly. A suggestion that returns every Monday after being
-- turned down is nagging, so the dismissal is keyed by what was offered — the
-- metric and the race it came from — and never by the week it was offered in.
-- Putting it on weekly_goals would have meant a row with a week_start that had
-- to be ignored, and a target column that meant nothing, in the one table
-- every screen reads to find out what the runner is working to.
create table if not exists public.weekly_suggestion_dismissals (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,
  metric         text        not null check (metric in ('distance_km', 'sessions')),
  -- Cascades, unlike the column above: a dismissal is about an offer, and when
  -- the race is gone there is no offer left to keep refusing.
  source_goal_id uuid        references public.goals(id) on delete cascade,
  dismissed_at   timestamptz not null default now()
);

-- One dismissal per thing that can be offered. Split in two because a unique
-- constraint treats nulls as distinct, which would let the history suggestion
-- — the one with no race behind it — be dismissed over and over.
create unique index if not exists idx_weekly_dismissal_goal
  on public.weekly_suggestion_dismissals(user_id, metric, source_goal_id)
  where source_goal_id is not null;

create unique index if not exists idx_weekly_dismissal_history
  on public.weekly_suggestion_dismissals(user_id, metric)
  where source_goal_id is null;

alter table public.weekly_suggestion_dismissals enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'weekly_suggestion_dismissals' and policyname = 'weekly_dismissals_select_own') then
    create policy "weekly_dismissals_select_own" on public.weekly_suggestion_dismissals for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'weekly_suggestion_dismissals' and policyname = 'weekly_dismissals_insert_own') then
    create policy "weekly_dismissals_insert_own" on public.weekly_suggestion_dismissals for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'weekly_suggestion_dismissals' and policyname = 'weekly_dismissals_delete_own') then
    create policy "weekly_dismissals_delete_own" on public.weekly_suggestion_dismissals for delete using (auth.uid() = user_id);
  end if;
end $$;
