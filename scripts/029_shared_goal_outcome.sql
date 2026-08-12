-- Migration 029: how it went, and when to stop asking
--
-- A group had no ending. The day after the race its row vanished from the
-- goal it hung off, nothing else linked to it, and the positions carried on
-- being recomputed against a race that had already been run — so the final
-- standing was never final.
--
-- Two columns close it:
--
--   outcome    the verdict for this member, in the same two words their own
--              goal screen uses: 'reached' or 'ended'. Null means nobody has
--              recorded one, which is not the same as failing and must not
--              read as it.
--
--   settled_at when the verdict was written. It is also the freeze: once it
--              is set, this row stops being recomputed. The number on it is
--              the number it finished with.
--
-- The verdict is written by the member's own sync, like the position beside
-- it. Working it out needs their activities, and no other member of the group
-- may read those — so the side that already holds the data is the side that
-- computes it, and the group screen reads a column it is allowed to read.

alter table public.shared_goal_members
  add column if not exists outcome text,
  add column if not exists settled_at timestamptz;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'shared_goal_members_outcome_check'
  ) then
    alter table public.shared_goal_members
      add constraint shared_goal_members_outcome_check
      check (outcome is null or outcome in ('reached', 'ended'));
  end if;
end $$;
