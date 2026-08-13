-- Migration 032: somewhere a server error can be read
--
-- The app's only observability was `console.error`, which on this plan goes
-- to runtime logs nobody can open. That is not a gap you notice until
-- something fails: a Strava account could not give itself an email address,
-- the screen said so, and the reason was written to a log that does not
-- exist. Every fact about that failure had to be inferred from Supabase's own
-- logs and the shape of the data left behind, and the cause is still unknown.
--
-- So errors go somewhere readable instead. This is a log table, not an
-- application table: nothing reads it at runtime, and the app does not change
-- behaviour based on what is in it.
--
--   Newest first:
--     select occurred_at, context, message, stack
--     from public.app_errors order by occurred_at desc limit 50;
--
--   One screen's worth of trouble:
--     select * from public.app_errors
--     where context like 'auth.finish%' order by occurred_at desc;
--
--   Housekeeping, when it stops being interesting:
--     delete from public.app_errors where occurred_at < now() - interval '30 days';

create table if not exists public.app_errors (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  -- Where it happened, in the app's own vocabulary: "auth.finish.unexpected".
  context     text        not null,
  message     text,
  stack       text,
  -- Whose request it was, when that is known. Set null on delete rather than
  -- cascade: an account going away should not quietly erase the record of a
  -- failure that may still be unfixed.
  user_id     uuid        references auth.users(id) on delete set null
);

create index if not exists app_errors_occurred_at_idx
  on public.app_errors (occurred_at desc);

-- No policies, by design. Written by the server holding the service-role key
-- and read in the SQL editor; the anon key can never see it. Error text has a
-- habit of carrying identifiers and internals, and none of that belongs in a
-- browser.
alter table public.app_errors enable row level security;
