-- Goal preferences: per-goal training settings stored before plan generation
create table goal_preferences (
  goal_id uuid primary key references goals(id) on delete cascade,
  user_id uuid references auth.users not null,
  sessions_per_week int not null default 3,
  -- 'volume'   = focus on hitting km targets, flexible sessions
  -- 'workouts' = structured sessions (tempo, intervals, long run)
  -- 'balanced' = mix of both
  focus text not null default 'balanced',
  notes text,
  updated_at timestamptz default now()
);

alter table goal_preferences enable row level security;

create policy "Users manage own goal preferences"
  on goal_preferences for all
  using (auth.uid() = user_id);

-- AI training plans: cached Claude-generated 4-week training blocks
create table ai_training_plans (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid unique references goals(id) on delete cascade,
  user_id uuid references auth.users not null,
  plan jsonb not null,
  block_start_date date not null,
  generated_at timestamptz default now()
);

alter table ai_training_plans enable row level security;

create policy "Users manage own training plans"
  on ai_training_plans for all
  using (auth.uid() = user_id);
