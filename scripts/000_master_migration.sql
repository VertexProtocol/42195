-- ============================================================
-- MASTER MIGRATION SCRIPT
-- Consolidates ALL migrations from scripts/ and supabase/migrations/
-- into a single idempotent file.
--
-- SAFE TO RUN ON AN EXISTING DATABASE:
--   • CREATE TABLE / INDEX use IF NOT EXISTS
--   • ALTER TABLE ADD COLUMN uses IF NOT EXISTS
--   • RLS policies are wrapped in DO $$ existence guards
--   • Triggers use DROP IF EXISTS before re-creating
--   • display_order backfills only touch rows still at 0
--   • Constraint changes use DROP IF EXISTS before adding
--
-- EXCLUDED (run manually when needed):
--   • 002_create_strava_tokens.sql  — service-role OAuth table,
--     managed separately from app schema.
--   • 014_reset_strava_tokens.sql   — truncates live token data,
--     only run when forcing a full OAuth re-authorisation.
--   • rollback_007_goal_display_order.sql — rollback helper only.
--
-- NOTE: Two files in scripts/ were accidentally both named "007".
--   007_add_ai_training.sql        → section "007a" below
--   007_add_goal_display_order.sql → section "007b" below
-- ============================================================


-- ============================================================
-- 001 · Core tables
-- ============================================================

-- PROFILES ------------------------------------------------
create table if not exists public.profiles (
  id           uuid        primary key references auth.users(id) on delete cascade,
  display_name text,
  email        text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'profiles' and policyname = 'profiles_select_own') then
    create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'profiles' and policyname = 'profiles_insert_own') then
    create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'profiles' and policyname = 'profiles_update_own') then
    create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'profiles' and policyname = 'profiles_delete_own') then
    create policy "profiles_delete_own" on public.profiles for delete using (auth.uid() = id);
  end if;
end $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, email, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data ->> 'avatar_url', null)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ACTIVITIES ----------------------------------------------
-- The original type CHECK (Run/Trail Run/Race) was broadened to include
-- Walk in 010, then removed entirely in 013 to allow all Strava types.
-- The global strava_id UNIQUE was replaced by a per-user composite
-- unique constraint (add_performance_indexes + fix_activities_unique_constraint).
-- The final schema reflects all of these changes directly.
create table if not exists public.activities (
  id               uuid         primary key default gen_random_uuid(),
  user_id          uuid         not null references auth.users(id) on delete cascade,
  strava_id        bigint,
  type             text         not null default 'Run',
  name             text         not null,
  date             timestamptz  not null,
  distance_km      numeric(8,3) not null default 0,
  duration_seconds integer      not null default 0,
  pace_min_per_km  numeric(6,2),
  elevation_gain_m numeric(8,1),
  avg_heart_rate   integer,
  avg_cadence      integer,
  calories         integer,
  map_polyline     text,
  created_at       timestamptz  not null default now()
);

create index if not exists idx_activities_user_id      on public.activities(user_id);
create index if not exists idx_activities_date         on public.activities(user_id, date desc);
create index if not exists idx_activities_user_date_desc on public.activities(user_id, date desc);
create index if not exists idx_activities_user_hr
  on public.activities(user_id, avg_heart_rate)
  where avg_heart_rate is not null and avg_heart_rate > 0;

alter table public.activities enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'activities' and policyname = 'activities_select_own') then
    create policy "activities_select_own" on public.activities for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'activities' and policyname = 'activities_insert_own') then
    create policy "activities_insert_own" on public.activities for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'activities' and policyname = 'activities_update_own') then
    create policy "activities_update_own" on public.activities for update using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'activities' and policyname = 'activities_delete_own') then
    create policy "activities_delete_own" on public.activities for delete using (auth.uid() = user_id);
  end if;
end $$;

-- Replace any legacy global strava_id unique with a per-user composite unique.
-- (add_performance_indexes dropped the global one; fix_activities_unique_constraint
--  replaced the partial index with a proper constraint for ON CONFLICT upserts.)
alter table public.activities drop constraint if exists activities_strava_id_key;
drop index if exists idx_activities_user_strava_id;
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'activities_user_id_strava_id_key'
  ) then
    alter table public.activities
      add constraint activities_user_id_strava_id_key unique (user_id, strava_id);
  end if;
end $$;

-- Remove any leftover type CHECK constraints (010 added Walk, 013 removed all).
alter table public.activities drop constraint if exists activities_type_check;


-- GOALS ---------------------------------------------------
create table if not exists public.goals (
  id                  uuid         primary key default gen_random_uuid(),
  user_id             uuid         not null references auth.users(id) on delete cascade,
  name                text         not null,
  target_distance_km  numeric(8,2) not null default 0,
  target_date         date         not null,
  current_distance_km numeric(8,2) not null default 0,
  is_active           boolean      not null default false,
  created_at          timestamptz  not null default now(),
  updated_at          timestamptz  not null default now()
);

create index if not exists idx_goals_user_id   on public.goals(user_id);
create index if not exists idx_goals_user_active on public.goals(user_id, is_active) where is_active = true;

alter table public.goals enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'goals' and policyname = 'goals_select_own') then
    create policy "goals_select_own" on public.goals for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'goals' and policyname = 'goals_insert_own') then
    create policy "goals_insert_own" on public.goals for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'goals' and policyname = 'goals_update_own') then
    create policy "goals_update_own" on public.goals for update using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'goals' and policyname = 'goals_delete_own') then
    create policy "goals_delete_own" on public.goals for delete using (auth.uid() = user_id);
  end if;
end $$;

-- The single-active-goal constraint was removed in 004.
drop index if exists idx_goals_one_active;


-- WEEKLY GOALS --------------------------------------------
create table if not exists public.weekly_goals (
  id          uuid          primary key default gen_random_uuid(),
  user_id     uuid          not null references auth.users(id) on delete cascade,
  metric      text          not null check (metric in ('distance_km', 'sessions', 'duration_minutes', 'elevation_m')),
  label       text          not null,
  target      numeric(10,2) not null default 0,
  current     numeric(10,2) not null default 0,
  week_start  date          not null,
  created_at  timestamptz   not null default now(),
  updated_at  timestamptz   not null default now()
);

create index if not exists idx_weekly_goals_user_week on public.weekly_goals(user_id, week_start);

alter table public.weekly_goals enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'weekly_goals' and policyname = 'weekly_goals_select_own') then
    create policy "weekly_goals_select_own" on public.weekly_goals for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'weekly_goals' and policyname = 'weekly_goals_insert_own') then
    create policy "weekly_goals_insert_own" on public.weekly_goals for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'weekly_goals' and policyname = 'weekly_goals_update_own') then
    create policy "weekly_goals_update_own" on public.weekly_goals for update using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'weekly_goals' and policyname = 'weekly_goals_delete_own') then
    create policy "weekly_goals_delete_own" on public.weekly_goals for delete using (auth.uid() = user_id);
  end if;
end $$;


-- SYNC STATUS ---------------------------------------------
create table if not exists public.sync_status (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        unique not null references auth.users(id) on delete cascade,
  last_sync_at  timestamptz,
  state         text        not null default 'never' check (state in ('success', 'error', 'syncing', 'never')),
  error_message text,
  updated_at    timestamptz not null default now()
);

alter table public.sync_status enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'sync_status' and policyname = 'sync_status_select_own') then
    create policy "sync_status_select_own" on public.sync_status for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'sync_status' and policyname = 'sync_status_insert_own') then
    create policy "sync_status_insert_own" on public.sync_status for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'sync_status' and policyname = 'sync_status_update_own') then
    create policy "sync_status_update_own" on public.sync_status for update using (auth.uid() = user_id);
  end if;
end $$;


-- UPDATED_AT helper ---------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at     on public.profiles;
drop trigger if exists goals_updated_at        on public.goals;
drop trigger if exists weekly_goals_updated_at on public.weekly_goals;
drop trigger if exists sync_status_updated_at  on public.sync_status;

create trigger profiles_updated_at     before update on public.profiles     for each row execute function public.set_updated_at();
create trigger goals_updated_at        before update on public.goals        for each row execute function public.set_updated_at();
create trigger weekly_goals_updated_at before update on public.weekly_goals for each row execute function public.set_updated_at();
create trigger sync_status_updated_at  before update on public.sync_status  for each row execute function public.set_updated_at();


-- ============================================================
-- 003 · Goal categories + recurring weekly goals
-- ============================================================
alter table public.goals
  add column if not exists goal_category text not null default 'performance'
  check (goal_category in ('performance', 'event_training'));

alter table public.weekly_goals
  add column if not exists is_recurring boolean not null default false;


-- ============================================================
-- 004 · Goal time fields; drop single-active constraint
-- ============================================================
alter table public.goals
  add column if not exists start_date          date,
  add column if not exists target_time_seconds integer;


-- ============================================================
-- 005 · Per-session thresholds on weekly goals
-- ============================================================
alter table public.weekly_goals
  add column if not exists session_min_duration_minutes integer,
  add column if not exists session_min_distance_km      numeric(6,2);


-- ============================================================
-- 006 · Activity streams and laps (lazy-cached per activity)
-- ============================================================
create table if not exists activity_streams (
  activity_id uuid        primary key references activities(id) on delete cascade,
  points      jsonb       not null,
  fetched_at  timestamptz not null default now()
);

alter table activity_streams enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'activity_streams' and policyname = 'Users read own activity streams') then
    create policy "Users read own activity streams" on activity_streams for select using (
      exists (select 1 from activities where activities.id = activity_streams.activity_id and activities.user_id = auth.uid())
    );
  end if;
end $$;

create table if not exists activity_laps (
  activity_id uuid        primary key references activities(id) on delete cascade,
  laps        jsonb       not null,
  fetched_at  timestamptz not null default now()
);

alter table activity_laps enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'activity_laps' and policyname = 'Users read own activity laps') then
    create policy "Users read own activity laps" on activity_laps for select using (
      exists (select 1 from activities where activities.id = activity_laps.activity_id and activities.user_id = auth.uid())
    );
  end if;
end $$;


-- ============================================================
-- 007a · Goal preferences + AI training plans
-- ============================================================
create table if not exists goal_preferences (
  goal_id           uuid    primary key references goals(id) on delete cascade,
  user_id           uuid    not null references auth.users,
  sessions_per_week int     not null default 3,
  focus             text    not null default 'balanced',
  notes             text,
  updated_at        timestamptz default now()
);

alter table goal_preferences enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'goal_preferences' and policyname = 'Users manage own goal preferences') then
    create policy "Users manage own goal preferences" on goal_preferences for all using (auth.uid() = user_id);
  end if;
end $$;

create table if not exists ai_training_plans (
  id               uuid    primary key default gen_random_uuid(),
  goal_id          uuid    unique references goals(id) on delete cascade,
  user_id          uuid    not null references auth.users,
  plan             jsonb   not null,
  block_start_date date    not null,
  generated_at     timestamptz default now()
);

alter table ai_training_plans enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'ai_training_plans' and policyname = 'Users manage own training plans') then
    create policy "Users manage own training plans" on ai_training_plans for all using (auth.uid() = user_id);
  end if;
end $$;

create index if not exists idx_ai_training_plans_user_generated
  on ai_training_plans(user_id, generated_at desc);


-- ============================================================
-- 007b · Goals display_order for drag-and-drop reordering
-- ============================================================
alter table goals add column if not exists display_order integer default 0;

-- Backfill only rows still at the default (0) to preserve existing ordering.
update goals set display_order = sub.row_num
from (
  select id, row_number() over (partition by user_id order by created_at) as row_num
  from goals
) sub
where goals.id = sub.id
  and goals.display_order = 0;


-- ============================================================
-- 008 · Additional goal_preferences / ai_training_plans columns
-- (also covered by add_training_block_preferences.sql)
-- ============================================================
alter table goal_preferences
  add column if not exists weekly_increase_pct    int not null default 10,
  add column if not exists block_weeks            int not null default 4,
  add column if not exists regenerate_every_weeks int not null default 4;

alter table ai_training_plans
  add column if not exists adjust_note text;


-- ============================================================
-- 009 · Plan versioning — previous_plans history array
-- ============================================================
alter table ai_training_plans
  add column if not exists previous_plans jsonb not null default '[]';


-- ============================================================
-- 011 · Session completions
-- ============================================================
create table if not exists session_completions (
  id          uuid    primary key default gen_random_uuid(),
  goal_id     uuid    not null references goals(id) on delete cascade,
  user_id     uuid    not null references auth.users(id) on delete cascade,
  session_key text    not null,
  status      text    not null default 'planned' check (status in ('planned', 'completed', 'skipped')),
  updated_at  timestamptz not null default now(),
  unique(goal_id, session_key)
);

alter table session_completions enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'session_completions' and policyname = 'Users can view own session completions') then
    create policy "Users can view own session completions"   on session_completions for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'session_completions' and policyname = 'Users can insert own session completions') then
    create policy "Users can insert own session completions" on session_completions for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'session_completions' and policyname = 'Users can update own session completions') then
    create policy "Users can update own session completions" on session_completions for update using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'session_completions' and policyname = 'Users can delete own session completions') then
    create policy "Users can delete own session completions" on session_completions for delete using (auth.uid() = user_id);
  end if;
end $$;


-- ============================================================
-- 012 + 016 · plan_mode on goal_preferences
-- (016 is a catch-up for 008/012; both are idempotent)
-- ============================================================
alter table goal_preferences
  add column if not exists plan_mode text not null default 'block';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'goal_preferences_plan_mode_check') then
    alter table goal_preferences
      add constraint goal_preferences_plan_mode_check check (plan_mode in ('block', 'full_cycle'));
  end if;
end $$;


-- ============================================================
-- 015 · Mid-block checkpoint on ai_training_plans
-- ============================================================
alter table ai_training_plans
  add column if not exists mid_block_checkpoint jsonb default null;


-- ============================================================
-- 017 · HR analysis cache on profiles
-- ============================================================
alter table public.profiles
  add column if not exists hr_analysis_cache jsonb default null;


-- ============================================================
-- 018 · Weekly goals display_order for drag-and-drop reordering
-- ============================================================
alter table weekly_goals add column if not exists display_order integer default 0;

-- Backfill only rows still at the default (0).
update weekly_goals set display_order = sub.row_num
from (
  select id, row_number() over (partition by user_id order by created_at) as row_num
  from weekly_goals
) sub
where weekly_goals.id = sub.id
  and weekly_goals.display_order = 0;


-- ============================================================
-- 019 · Starred goals for home screen pins
-- ============================================================
alter table goals
  add column if not exists is_starred boolean not null default false;


-- ============================================================
-- 020 · Injury notes on goal_preferences
-- (also covered by add_goal_preferences_injury_plan_mode.sql)
-- ============================================================
alter table goal_preferences
  add column if not exists injury_notes text;


-- ============================================================
-- supabase/migrations/add_profile_locale.sql
-- ============================================================
alter table public.profiles
  add column if not exists locale varchar(2);


-- ============================================================
-- supabase/migrations/add_activity_analyses.sql
-- ============================================================
create table if not exists activity_analyses (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  activity_id uuid        not null references activities(id) on delete cascade,
  analysis    text        not null,
  created_at  timestamptz not null default now(),
  unique(activity_id)
);

alter table activity_analyses enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'activity_analyses' and policyname = 'Users read own activity analyses') then
    create policy "Users read own activity analyses"   on activity_analyses for select using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'activity_analyses' and policyname = 'Users insert own activity analyses') then
    create policy "Users insert own activity analyses" on activity_analyses for insert with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'activity_analyses' and policyname = 'Users delete own activity analyses') then
    create policy "Users delete own activity analyses" on activity_analyses for delete using (user_id = auth.uid());
  end if;
end $$;

create index if not exists idx_activity_analyses_user
  on activity_analyses(user_id, activity_id);


-- ============================================================
-- supabase/migrations/add_test_runs.sql
-- ============================================================
create table if not exists test_runs (
  id                  uuid    primary key default gen_random_uuid(),
  user_id             uuid    not null references auth.users(id) on delete cascade,
  activity_id         uuid    not null references activities(id) on delete cascade,
  test_type           text    not null default 'custom',
  distance_km         numeric not null,
  time_seconds        integer not null,
  avg_pace            numeric,
  avg_hr              integer,
  max_hr              integer,
  elevation_m         numeric,
  derived_metrics     jsonb   not null default '{}',
  notes               text,
  created_at          timestamptz not null default now(),
  unique(activity_id)
);

alter table test_runs enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'test_runs' and policyname = 'Users read own test runs') then
    create policy "Users read own test runs"   on test_runs for select using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'test_runs' and policyname = 'Users insert own test runs') then
    create policy "Users insert own test runs" on test_runs for insert with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'test_runs' and policyname = 'Users update own test runs') then
    create policy "Users update own test runs" on test_runs for update using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'test_runs' and policyname = 'Users delete own test runs') then
    create policy "Users delete own test runs" on test_runs for delete using (user_id = auth.uid());
  end if;
end $$;

create index if not exists idx_test_runs_user_type    on test_runs(user_id, test_type, created_at desc);
create index if not exists idx_test_runs_user_created on test_runs(user_id, created_at desc);


-- supabase/migrations/add_prediction_validation.sql
alter table test_runs
  add column if not exists prediction_validation jsonb default null;


-- ============================================================
-- supabase/migrations/add_ai_rate_limits.sql
-- ============================================================
create table if not exists ai_rate_limits (
  user_id       uuid        not null references auth.users(id) on delete cascade,
  hour_bucket   timestamptz not null,
  request_count integer     not null default 0,
  primary key (user_id, hour_bucket)
);

alter table ai_rate_limits enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'ai_rate_limits' and policyname = 'Users manage their own rate limits') then
    create policy "Users manage their own rate limits" on ai_rate_limits for all
      using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

create or replace function increment_ai_rate_limit(p_user_id uuid, p_hour_bucket timestamptz)
returns integer language plpgsql security definer set search_path = public as $$
declare
  new_count integer;
begin
  insert into ai_rate_limits (user_id, hour_bucket, request_count)
  values (p_user_id, p_hour_bucket, 1)
  on conflict (user_id, hour_bucket)
  do update set request_count = ai_rate_limits.request_count + 1
  returning request_count into new_count;
  return new_count;
end;
$$;


-- ============================================================
-- supabase/migrations/add_notes_history.sql
-- ============================================================
alter table goal_preferences
  add column if not exists notes_history jsonb not null default '[]'::jsonb;


-- ============================================================
-- 023_multi_user_hardening.sql
-- (strava_tokens.athlete_id unique index lives in 023 only — that table is
--  managed separately, see the EXCLUDED note at the top of this file.)
-- ============================================================

-- Invite allowlist. Sign-up is refused unless the address has a row here.
-- Service-role only: no policies, so the invited addresses are not readable
-- from the browser.
create table if not exists public.allowed_signups (
  email      text        primary key check (email = lower(email)),
  note       text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by uuid        references auth.users(id) on delete set null
);

alter table public.allowed_signups enable row level security;

-- Resumable sync: a long history is pulled in chunks, so a run records where
-- to continue from and when the rate limit window reopens.
alter table public.sync_status
  add column if not exists cursor_before bigint,
  add column if not exists resume_at     timestamptz;

alter table public.sync_status drop constraint if exists sync_status_state_check;
alter table public.sync_status
  add constraint sync_status_state_check
  check (state in ('success', 'error', 'syncing', 'never', 'partial', 'rate_limited'));


-- ============================================================
-- 024_add_onboarding_state.sql
-- ============================================================

-- Null means the "Get started" checklist is live for this account; a
-- timestamp means the runner closed it. Clearing it back to null is how
-- Profile reopens the checklist.
alter table public.profiles
  add column if not exists onboarding_dismissed_at timestamptz;


-- ============================================================
-- 025_add_shared_goals.sql
-- ============================================================

-- Several runners against one race. The shared goal owns the race and the
-- date; each member keeps their own goals row, and the only thing the group
-- reads about each other is the position written by that member's own sync.

-- SHARED GOALS --------------------------------------------
create table if not exists public.shared_goals (
  id           uuid         primary key default gen_random_uuid(),
  owner_id     uuid         not null references auth.users(id) on delete cascade,
  name         text         not null,
  race_date    date         not null,
  distance_km  numeric(8,2) not null,
  -- 'progress'  — share of your own gap closed since you joined
  -- 'adherence' — km run against km planned
  -- 'proximity' — how close your predicted time is to your target time
  metric       text         not null default 'progress'
               check (metric in ('progress', 'adherence', 'proximity')),
  created_at   timestamptz  not null default now(),
  updated_at   timestamptz  not null default now()
);

create index if not exists idx_shared_goals_owner on public.shared_goals(owner_id);

alter table public.shared_goals enable row level security;


-- MEMBERS -------------------------------------------------
-- `baseline_seconds` is the predicted time over the race distance on the day
-- the runner joined. It is written once and never recomputed: recomputing it
-- would let a member reset their own starting point by rejoining, and the
-- whole measure rests on the starting point being fixed.
create table if not exists public.shared_goal_members (
  shared_goal_id   uuid        not null references public.shared_goals(id) on delete cascade,
  user_id          uuid        not null references auth.users(id) on delete cascade,
  goal_id          uuid        not null references public.goals(id) on delete cascade,
  baseline_seconds integer,
  -- Where the baseline came from, in the vocabulary lib/pace-guide.ts already
  -- uses: 'test_run' | 'prediction' | 'historical' | 'none'. A thin source is
  -- shown as a thin number rather than hidden.
  baseline_source  text,
  -- Denormalised by the member's own sync run. Null means "not measured yet",
  -- which the group screen shows as a dash rather than as a zero.
  position_pct     numeric(6,1),
  adherence_done   numeric(8,2),
  adherence_target numeric(8,2),
  updated_at       timestamptz,
  joined_at        timestamptz not null default now(),
  primary key (shared_goal_id, user_id)
);

create index if not exists idx_shared_goal_members_user on public.shared_goal_members(user_id);
create index if not exists idx_shared_goal_members_goal on public.shared_goal_members(goal_id);

alter table public.shared_goal_members enable row level security;


-- INVITES -------------------------------------------------
-- The token is the invitation. It is looked up by the service role during
-- accept, so there is no select policy for members here: an invite list is
-- a list of email addresses, and the group does not need to read it.
create table if not exists public.shared_goal_invites (
  id             uuid        primary key default gen_random_uuid(),
  shared_goal_id uuid        not null references public.shared_goals(id) on delete cascade,
  email          text        not null check (email = lower(email)),
  token          text        not null unique,
  invited_by     uuid        references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  accepted_at    timestamptz
);

create unique index if not exists idx_shared_goal_invites_pending
  on public.shared_goal_invites(shared_goal_id, email)
  where accepted_at is null;

alter table public.shared_goal_invites enable row level security;


-- MEMBERSHIP LOOKUP ---------------------------------------
-- "Members may read member rows of groups they are a member of" is recursive:
-- the policy on shared_goal_members would have to read shared_goal_members to
-- decide, and Postgres stops with `infinite recursion detected in policy`.
-- A security definer function answers the question outside RLS, so the policy
-- can ask it without re-entering the table.
create or replace function public.is_shared_goal_member(g uuid, u uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.shared_goal_members
    where shared_goal_id = g and user_id = u
  );
$$;

revoke all on function public.is_shared_goal_member(uuid, uuid) from public;
grant execute on function public.is_shared_goal_member(uuid, uuid) to authenticated;


-- POLICIES ------------------------------------------------
do $$ begin
  -- The goal itself: any member reads it, only the owner changes or deletes it.
  if not exists (select 1 from pg_policies where tablename = 'shared_goals' and policyname = 'shared_goals_select_member') then
    create policy "shared_goals_select_member" on public.shared_goals for select
      using (auth.uid() = owner_id or public.is_shared_goal_member(id, auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'shared_goals' and policyname = 'shared_goals_insert_own') then
    create policy "shared_goals_insert_own" on public.shared_goals for insert
      with check (auth.uid() = owner_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'shared_goals' and policyname = 'shared_goals_update_owner') then
    create policy "shared_goals_update_owner" on public.shared_goals for update
      using (auth.uid() = owner_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'shared_goals' and policyname = 'shared_goals_delete_owner') then
    create policy "shared_goals_delete_owner" on public.shared_goals for delete
      using (auth.uid() = owner_id);
  end if;

  -- Member rows: the group reads everyone's position, but a member writes
  -- only their own. Reading another runner's progress is allowed; reading the
  -- activities it was computed from is not, and no policy here grants that.
  if not exists (select 1 from pg_policies where tablename = 'shared_goal_members' and policyname = 'shared_goal_members_select_member') then
    create policy "shared_goal_members_select_member" on public.shared_goal_members for select
      using (public.is_shared_goal_member(shared_goal_id, auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'shared_goal_members' and policyname = 'shared_goal_members_insert_own') then
    create policy "shared_goal_members_insert_own" on public.shared_goal_members for insert
      with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'shared_goal_members' and policyname = 'shared_goal_members_update_own') then
    create policy "shared_goal_members_update_own" on public.shared_goal_members for update
      using (auth.uid() = user_id);
  end if;
  -- Leaving is your own decision; removing someone else is the owner's.
  if not exists (select 1 from pg_policies where tablename = 'shared_goal_members' and policyname = 'shared_goal_members_delete_own_or_owner') then
    create policy "shared_goal_members_delete_own_or_owner" on public.shared_goal_members for delete
      using (
        auth.uid() = user_id
        or exists (
          select 1 from public.shared_goals g
          where g.id = shared_goal_id and g.owner_id = auth.uid()
        )
      );
  end if;

  -- Invites: the owner manages them. Accepting runs through the service role,
  -- which is not subject to these policies.
  if not exists (select 1 from pg_policies where tablename = 'shared_goal_invites' and policyname = 'shared_goal_invites_select_owner') then
    create policy "shared_goal_invites_select_owner" on public.shared_goal_invites for select
      using (
        exists (
          select 1 from public.shared_goals g
          where g.id = shared_goal_id and g.owner_id = auth.uid()
        )
      );
  end if;
  if not exists (select 1 from pg_policies where tablename = 'shared_goal_invites' and policyname = 'shared_goal_invites_insert_owner') then
    create policy "shared_goal_invites_insert_owner" on public.shared_goal_invites for insert
      with check (
        auth.uid() = invited_by
        and exists (
          select 1 from public.shared_goals g
          where g.id = shared_goal_id and g.owner_id = auth.uid()
        )
      );
  end if;
  if not exists (select 1 from pg_policies where tablename = 'shared_goal_invites' and policyname = 'shared_goal_invites_delete_owner') then
    create policy "shared_goal_invites_delete_owner" on public.shared_goal_invites for delete
      using (
        exists (
          select 1 from public.shared_goals g
          where g.id = shared_goal_id and g.owner_id = auth.uid()
        )
      );
  end if;
end $$;


-- DISPLAY NAMES -------------------------------------------
-- A row of positions with no names on it is not a group screen, but
-- `profiles` is select-own and must stay that way. This exposes exactly the
-- two fields a member list needs, for exactly the people you share a goal
-- with, and nothing else on the profile row.
create or replace function public.shared_goal_member_names(g uuid)
returns table (user_id uuid, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name
  from public.profiles p
  join public.shared_goal_members m on m.user_id = p.id
  where m.shared_goal_id = g
    and public.is_shared_goal_member(g, auth.uid());
$$;

revoke all on function public.shared_goal_member_names(uuid) from public;
grant execute on function public.shared_goal_member_names(uuid) to authenticated;
