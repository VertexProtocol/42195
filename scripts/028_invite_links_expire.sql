-- Migration 028: invite links that many people can use, and that expire
--
-- The group invite was one token, one person, forever. Forever is the part
-- that mattered: nothing expired, so every link ever generated stayed a
-- working key to the group in whatever message it had been pasted into.
--
-- It becomes the shape people already know from Slack and Discord: one link
-- per group, anyone holding it can join, and it stops working after a week.
-- Handing it to a running club is one message instead of one per runner, and
-- a link that leaks stops mattering on its own.
--
-- accepted_at and accepted_by stay on the table but stop deciding anything.
-- Who is in the group is shared_goal_members, which was always the answer for
-- a group with more than one member in it.

alter table public.shared_goal_invites
  add column if not exists expires_at timestamptz;

-- Backfill before the default lands, and mind the direction: a link that was
-- already spent must not come back to life for a week. Only the ones that
-- were still open get a window.
update public.shared_goal_invites
   set expires_at = case
         when accepted_at is not null then now()
         else now() + interval '7 days'
       end
 where expires_at is null;

alter table public.shared_goal_invites
  alter column expires_at set default (now() + interval '7 days');

alter table public.shared_goal_invites
  alter column expires_at set not null;

-- No index for the join lookup: it reads by token, and token is unique, so
-- Postgres already has one. (A partial index on `expires_at > now()` is not
-- available anyway — now() is not immutable, so it cannot sit in a predicate.)
--
-- The old partial index assumed accepted_at was what "open" meant. It is not
-- any more, and an index on a condition nothing queries is dead weight.
drop index if exists idx_shared_goal_invites_goal;

create index if not exists idx_shared_goal_invites_goal
  on public.shared_goal_invites (shared_goal_id);
