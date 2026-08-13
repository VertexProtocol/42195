-- Migration 031: remember whether an unfinished sync was walking the whole history
--
-- A long history is pulled in chunks (see 023), and until now the only thing
-- that knew a chunked run was a *full* backfill rather than an incremental
-- sync was the `?full=1` on the request. The browser repeated it on each
-- continuation; the server never recorded it.
--
-- That holds exactly as long as the same loop drives every chunk. It does not
-- survive the runner leaving:
--
--   1. An account that has synced before triggers "full resync" from Profile.
--   2. The run stops short — eight pages, the time budget, or Strava's limit.
--   3. They close the app, come back later, and press Sync.
--
-- Step 3 arrives without `full=1`, so the run reads `last_sync_at`, decides
-- everything older than the previous successful sync is already known, stops
-- on the first page and records success. The history the resync was for is
-- never fetched, and nothing anywhere says so.
--
-- With the flag stored, a continuation is whatever the run it continues was.
--
-- False is the right default for existing rows: an unfinished run recorded
-- before this column existed resumes incrementally, exactly as it would have.

alter table public.sync_status
  add column if not exists resume_full boolean not null default false;
