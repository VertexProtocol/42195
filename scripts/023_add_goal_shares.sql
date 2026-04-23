-- ============================================================
-- Shared Goals (social feature)
--
-- A "shared goal" is a container that links N users' individual
-- goals together so they can see each other's progress against
-- a common objective (e.g. training for the same marathon).
--
-- Data model:
--   goal_shares         — the shared goal container (name, target)
--   goal_share_members  — N-to-1 membership; each member links one
--                         of their own goals into the container
--                         once they accept the invitation.
--
-- Privacy model:
--   • Members can see the shared goal and each other's linked goal
--     progress (distance, activity summaries) — NOT raw activity
--     data, maps, or HR. Aggregations are surfaced via API only.
--   • Pending invitees can see the invitation exists but no member
--     data until they accept.
-- ============================================================

-- 1. goal_shares --------------------------------------------------
create table if not exists public.goal_shares (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  target_date date not null,
  target_distance_km numeric(8,2) not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists idx_goal_shares_created_by
  on public.goal_shares(created_by);

-- 2. goal_share_members -------------------------------------------
-- Status lifecycle: pending → accepted / declined.
-- `goal_id` is set only when the member accepts and picks a goal to link.
create table if not exists public.goal_share_members (
  id uuid primary key default gen_random_uuid(),
  goal_share_id uuid not null references public.goal_shares(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid references public.goals(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending','accepted','declined')),
  role text not null default 'member'
    check (role in ('owner','member')),
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz default now() not null,
  responded_at timestamptz,
  unique(goal_share_id, user_id)
);

create index if not exists idx_goal_share_members_user
  on public.goal_share_members(user_id, status);

create index if not exists idx_goal_share_members_share
  on public.goal_share_members(goal_share_id);

-- 3. Helper: is the caller a (accepted) member of a shared goal? --
-- SECURITY DEFINER to sidestep the RLS recursion that would
-- otherwise occur when a SELECT policy on goal_share_members
-- needs to check another row of goal_share_members.
create or replace function public.is_goal_share_member(p_share_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.goal_share_members m
    where m.goal_share_id = p_share_id
      and m.user_id = auth.uid()
      and m.status in ('accepted','pending')
  );
$$;

-- Same, restricted to accepted only (for dashboard reads)
create or replace function public.is_accepted_goal_share_member(p_share_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.goal_share_members m
    where m.goal_share_id = p_share_id
      and m.user_id = auth.uid()
      and m.status = 'accepted'
  );
$$;

-- Owner check (used by invite / delete policies)
create or replace function public.is_goal_share_owner(p_share_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.goal_share_members m
    where m.goal_share_id = p_share_id
      and m.user_id = auth.uid()
      and m.role = 'owner'
      and m.status = 'accepted'
  );
$$;

-- 4. RLS: goal_shares ---------------------------------------------
alter table public.goal_shares enable row level security;

drop policy if exists "goal_shares_select_members" on public.goal_shares;
create policy "goal_shares_select_members" on public.goal_shares
  for select using (public.is_goal_share_member(id));

drop policy if exists "goal_shares_insert_self" on public.goal_shares;
create policy "goal_shares_insert_self" on public.goal_shares
  for insert with check (auth.uid() = created_by);

drop policy if exists "goal_shares_update_owner" on public.goal_shares;
create policy "goal_shares_update_owner" on public.goal_shares
  for update using (public.is_goal_share_owner(id));

drop policy if exists "goal_shares_delete_owner" on public.goal_shares;
create policy "goal_shares_delete_owner" on public.goal_shares
  for delete using (public.is_goal_share_owner(id));

-- 5. RLS: goal_share_members --------------------------------------
alter table public.goal_share_members enable row level security;

-- A user can see their own membership rows + all members of shares
-- they themselves are a member of (so the dashboard can list peers).
drop policy if exists "goal_share_members_select" on public.goal_share_members;
create policy "goal_share_members_select" on public.goal_share_members
  for select using (
    user_id = auth.uid()
    or public.is_goal_share_member(goal_share_id)
  );

-- INSERT paths:
--   a) creator bootstraps themselves as owner on a brand-new share
--   b) owner invites another user (role='member', status='pending')
drop policy if exists "goal_share_members_insert" on public.goal_share_members;
create policy "goal_share_members_insert" on public.goal_share_members
  for insert with check (
    -- bootstrap self as owner
    (user_id = auth.uid() and role = 'owner' and invited_by = auth.uid())
    -- or owner inviting someone else
    or (
      role = 'member'
      and invited_by = auth.uid()
      and public.is_goal_share_owner(goal_share_id)
    )
  );

-- UPDATE: the member themselves can respond to their invite;
-- the owner can change role/remove-by-update isn't used (delete instead).
drop policy if exists "goal_share_members_update_self" on public.goal_share_members;
create policy "goal_share_members_update_self" on public.goal_share_members
  for update using (user_id = auth.uid());

-- DELETE: member can leave, owner can remove any member
drop policy if exists "goal_share_members_delete" on public.goal_share_members;
create policy "goal_share_members_delete" on public.goal_share_members
  for delete using (
    user_id = auth.uid()
    or public.is_goal_share_owner(goal_share_id)
  );

-- 6. updated_at trigger for goal_shares ---------------------------
drop trigger if exists goal_shares_updated_at on public.goal_shares;
create trigger goal_shares_updated_at
  before update on public.goal_shares
  for each row execute function public.set_updated_at();
