-- =============================================
-- 42195 Fitness App - Full Schema Migration
-- =============================================

-- 1. PROFILES
-- Extends Supabase auth.users with app-specific data
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email text,
  avatar_url text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);
create policy "profiles_delete_own" on public.profiles
  for delete using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
  for each row
  execute function public.handle_new_user();


-- 2. ACTIVITIES
-- Running activities synced from Strava via backend
create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  strava_id bigint unique,
  type text not null default 'Run' check (type in ('Run', 'Trail Run', 'Race')),
  name text not null,
  date timestamptz not null,
  distance_km numeric(8,3) not null default 0,
  duration_seconds integer not null default 0,
  pace_min_per_km numeric(6,2),
  elevation_gain_m numeric(8,1),
  avg_heart_rate integer,
  calories integer,
  created_at timestamptz default now() not null
);

create index if not exists idx_activities_user_id on public.activities(user_id);
create index if not exists idx_activities_date on public.activities(user_id, date desc);

alter table public.activities enable row level security;

create policy "activities_select_own" on public.activities
  for select using (auth.uid() = user_id);
create policy "activities_insert_own" on public.activities
  for insert with check (auth.uid() = user_id);
create policy "activities_update_own" on public.activities
  for update using (auth.uid() = user_id);
create policy "activities_delete_own" on public.activities
  for delete using (auth.uid() = user_id);


-- 3. GOALS (long-term)
-- Training goals such as marathon targets
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  target_distance_km numeric(8,2) not null default 0,
  target_date date not null,
  current_distance_km numeric(8,2) not null default 0,
  is_active boolean not null default false,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists idx_goals_user_id on public.goals(user_id);

alter table public.goals enable row level security;

create policy "goals_select_own" on public.goals
  for select using (auth.uid() = user_id);
create policy "goals_insert_own" on public.goals
  for insert with check (auth.uid() = user_id);
create policy "goals_update_own" on public.goals
  for update using (auth.uid() = user_id);
create policy "goals_delete_own" on public.goals
  for delete using (auth.uid() = user_id);

-- Ensure only one active goal per user (partial unique index)
create unique index if not exists idx_goals_one_active
  on public.goals(user_id)
  where is_active = true;


-- 4. WEEKLY GOALS
-- Recurring weekly targets (distance, sessions, duration, elevation)
create table if not exists public.weekly_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  metric text not null check (metric in ('distance_km', 'sessions', 'duration_minutes', 'elevation_m')),
  label text not null,
  target numeric(10,2) not null default 0,
  current numeric(10,2) not null default 0,
  week_start date not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists idx_weekly_goals_user_week
  on public.weekly_goals(user_id, week_start desc);

alter table public.weekly_goals enable row level security;

create policy "weekly_goals_select_own" on public.weekly_goals
  for select using (auth.uid() = user_id);
create policy "weekly_goals_insert_own" on public.weekly_goals
  for insert with check (auth.uid() = user_id);
create policy "weekly_goals_update_own" on public.weekly_goals
  for update using (auth.uid() = user_id);
create policy "weekly_goals_delete_own" on public.weekly_goals
  for delete using (auth.uid() = user_id);


-- 5. SYNC STATUS
-- Tracks Strava sync state per user
create table if not exists public.sync_status (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null references auth.users(id) on delete cascade,
  last_sync_at timestamptz,
  state text not null default 'never' check (state in ('success', 'error', 'syncing', 'never')),
  error_message text,
  updated_at timestamptz default now() not null
);

alter table public.sync_status enable row level security;

create policy "sync_status_select_own" on public.sync_status
  for select using (auth.uid() = user_id);
create policy "sync_status_insert_own" on public.sync_status
  for insert with check (auth.uid() = user_id);
create policy "sync_status_update_own" on public.sync_status
  for update using (auth.uid() = user_id);


-- 6. UPDATED_AT TRIGGER
-- Automatically sets updated_at on row changes
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger goals_updated_at
  before update on public.goals
  for each row execute function public.set_updated_at();

create trigger weekly_goals_updated_at
  before update on public.weekly_goals
  for each row execute function public.set_updated_at();

create trigger sync_status_updated_at
  before update on public.sync_status
  for each row execute function public.set_updated_at();
