-- Self-reported onboarding and provisional plans are separate from measured activities.
create table public.starter_plans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null check (jsonb_typeof(state) = 'object' and state->>'source' = 'self_reported'),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);
alter table public.starter_plans enable row level security;
revoke all on public.starter_plans from anon, authenticated;
grant select, insert, update on public.starter_plans to authenticated;
create policy starter_plans_read_own on public.starter_plans for select to authenticated using ((select auth.uid()) = user_id);
create policy starter_plans_insert_own on public.starter_plans for insert to authenticated with check ((select auth.uid()) = user_id);
create policy starter_plans_update_own on public.starter_plans for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
