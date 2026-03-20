-- Activity Analyses: cached AI coaching feedback per activity.
-- Avoids regenerating analysis on every visit to the activity detail screen.

create table if not exists activity_analyses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  activity_id uuid not null references activities(id) on delete cascade,
  analysis    text not null,
  created_at  timestamptz not null default now(),

  -- One analysis per activity
  unique(activity_id)
);

alter table activity_analyses enable row level security;

create policy "Users read own activity analyses" on activity_analyses
  for select using (user_id = auth.uid());

create policy "Users insert own activity analyses" on activity_analyses
  for insert with check (user_id = auth.uid());

create policy "Users delete own activity analyses" on activity_analyses
  for delete using (user_id = auth.uid());

create index if not exists idx_activity_analyses_user
  on activity_analyses(user_id, activity_id);
