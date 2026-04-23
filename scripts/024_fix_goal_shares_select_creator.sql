-- Fix: allow the creator of a shared goal to see it immediately after INSERT.
--
-- The original SELECT policy required is_goal_share_member(id), but that
-- lookup runs on the PostgREST auto-SELECT after INSERT — BEFORE the API
-- has had a chance to insert the owner's membership row. That made the
-- insert appear to "violate RLS" even though WITH CHECK passed.
--
-- Adding `created_by = auth.uid()` lets the creator see their own row
-- regardless of membership state. Other members still see the share only
-- via the membership join.

drop policy if exists "goal_shares_select_members" on public.goal_shares;

create policy "goal_shares_select_members" on public.goal_shares
  for select using (
    created_by = auth.uid()
    or public.is_goal_share_member(id)
  );
