-- Session completion tracking (persisted from localStorage to DB)
create table if not exists session_completions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Key format: "W{weekNumber}-{sessionIndex}" e.g. "W1-0", "W2-1"
  session_key text not null,
  status text not null check (status in ('planned', 'completed', 'skipped')) default 'planned',
  updated_at timestamptz not null default now(),
  unique(goal_id, session_key)
);

alter table session_completions enable row level security;

create policy "Users can view own session completions"
  on session_completions for select using (auth.uid() = user_id);

create policy "Users can insert own session completions"
  on session_completions for insert with check (auth.uid() = user_id);

create policy "Users can update own session completions"
  on session_completions for update using (auth.uid() = user_id);

create policy "Users can delete own session completions"
  on session_completions for delete using (auth.uid() = user_id);
