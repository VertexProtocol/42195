-- Test Runs: user-tagged benchmark activities for fitness calibration.
-- Stores extracted metrics and derived fitness estimates.

create table if not exists test_runs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  activity_id   uuid not null references activities(id) on delete cascade,
  test_type     text not null default 'custom',
  -- Extracted metrics (denormalized from activity for quick access)
  distance_km   numeric not null,
  time_seconds  integer not null,
  avg_pace      numeric,          -- min/km
  avg_hr        integer,
  max_hr        integer,
  elevation_m   numeric,
  -- Derived fitness metrics (computed on creation)
  derived_metrics jsonb not null default '{}',
  notes         text,
  created_at    timestamptz not null default now(),

  -- One test run per activity
  unique(activity_id)
);

alter table test_runs enable row level security;

create policy "Users read own test runs" on test_runs
  for select using (user_id = auth.uid());

create policy "Users insert own test runs" on test_runs
  for insert with check (user_id = auth.uid());

create policy "Users update own test runs" on test_runs
  for update using (user_id = auth.uid());

create policy "Users delete own test runs" on test_runs
  for delete using (user_id = auth.uid());

-- Index for querying user's test runs by type and date
create index if not exists idx_test_runs_user_type
  on test_runs(user_id, test_type, created_at desc);
