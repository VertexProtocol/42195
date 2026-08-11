-- Migration 025: shared goals — several runners working towards one race.
--
-- A shared goal owns the race and the date. It does not own anyone's target
-- time: each member points at their own existing `goals` row, so the training
-- plan, the target time and the weekly targets stay private and unchanged.
--
-- What members see of each other is one number. The position is computed by
-- the member's own sync run and written to their member row, because working
-- it out needs their activities and no other member may read those. The group
-- screen is then a plain select over rows the group is allowed to see.
--
-- The measure is chosen once, when the goal is created, and never edited.
-- Which measure a group runs under decides who leads it, so a group that can
-- switch mid-block will switch to whichever one flatters the loudest member.


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
