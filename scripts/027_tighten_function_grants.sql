-- 027 · Close the function surface the linter kept pointing at
--
-- Nothing here changes what the app can do. It changes who else can.
--
-- PostgREST publishes every function in `public` that the caller's role may
-- execute, so a grant is not a permission — it is an endpoint. Supabase grants
-- EXECUTE to `anon` and `authenticated` on new functions by default, which
-- means a function is public the moment it exists unless something says
-- otherwise. Three of ours never should have been reachable that way.
--
--   1. Two trigger helpers run with the caller's own search_path, so whoever
--      fires them decides what `now()` resolves to.
--   2. `handle_new_user` and `increment_ai_rate_limit` are SECURITY DEFINER and
--      were callable over HTTP by anyone with the anon key.
--   3. `is_shared_goal_member` answers a question no signed-in runner should be
--      able to ask about a group they are not in.
--
-- `shared_goal_member_names` deliberately stays where it is: the app calls it
-- over PostgREST with the runner's own session, and it already refuses anyone
-- who is not a member of the group they are asking about. The linter flags it
-- as a signed-in-callable definer function, and that is exactly what it is
-- meant to be.


-- ── 1 · Pin the trigger helpers' search_path ────────────────────────────────
-- Both only call `now()`, which lives in pg_catalog and is always resolvable,
-- so the empty path costs nothing and removes the question entirely.
--
-- The strava one is guarded because it comes from 002 and not from the master
-- migration, so a database built the other way has never heard of it.
alter function public.set_updated_at() set search_path = '';

do $$ begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_strava_tokens_updated_at'
  ) then
    alter function public.update_strava_tokens_updated_at() set search_path = '';
  end if;
end $$;


-- ── 2 · Take the definer functions off the public API ───────────────────────
-- `handle_new_user` is a trigger on auth.users and nothing else. PostgreSQL
-- checks EXECUTE when a trigger is *created*, not when it fires, so revoking it
-- now leaves sign-up working while removing /rest/v1/rpc/handle_new_user.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- `increment_ai_rate_limit` is called from the server with the service-role key
-- (lib/ai-rate-limit.ts) and from nowhere else. Leaving it exposed let any
-- signed-in runner spend somebody else's AI quota by passing their user id —
-- the function takes the id as an argument and never compares it to auth.uid().
revoke execute on function public.increment_ai_rate_limit(uuid, timestamptz)
  from public, anon, authenticated;


-- ── 3 · Move the RLS helper out of the exposed schema ───────────────────────
-- The two policies that call it keep working: a policy stores the function it
-- resolved to, so moving the function moves the reference with it. But the
-- policy is evaluated as the querying role, so `authenticated` still needs to
-- reach it — hence the grants. A schema outside PostgREST's exposed list is
-- reachable from SQL and not over HTTP, which is the whole distinction we want.
create schema if not exists private;
grant usage on schema private to authenticated, service_role;

alter function public.is_shared_goal_member(uuid, uuid) set schema private;
grant execute on function private.is_shared_goal_member(uuid, uuid)
  to authenticated, service_role;

-- Re-qualify the one caller. It runs as definer so it does not need the grant,
-- but its search_path is pinned to `public` and the name has just left it.
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
    and private.is_shared_goal_member(g, auth.uid());
$$;

revoke execute on function public.shared_goal_member_names(uuid) from public, anon;
grant execute on function public.shared_goal_member_names(uuid) to authenticated;


-- ── Left alone on purpose ───────────────────────────────────────────────────
--
-- `allowed_signups` has RLS on and no policies, which the linter reports as a
-- table nobody can read. That is the design — 023 created it for the service
-- role only — but the allowlist it was built for is gone: the sign-up action
-- never reads it, and sign-up is closed at the Supabase project level instead.
-- It is a dead table holding live-looking rows, which is worse than either, so
-- it wants deleting rather than a policy:
--
--   drop table if exists public.allowed_signups;
--
-- Not done here, because the rows are somebody's list and dropping data is not
-- a lint fix.
