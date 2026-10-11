alter table public.activities
  add column if not exists elapsed_seconds integer check (elapsed_seconds > 0),
  add column if not exists local_date date;
alter table public.goals
  add column if not exists event_activity_id uuid references public.activities(id) on delete set null,
  add column if not exists event_match_dismissed boolean not null default false;
alter table public.shared_goal_members drop constraint if exists shared_goal_members_outcome_check;
alter table public.shared_goal_members add constraint shared_goal_members_outcome_check
  check (outcome is null or outcome in ('reached', 'ended', 'completed'));
