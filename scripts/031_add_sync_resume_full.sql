-- Migration 031: remember whether an unfinished sync was walking the whole history
--
-- A long history is pulled in chunks (see 023). Until now the only thing that
-- knew a chunked run was a *full* backfill was the `?full=1` on the request,
-- which the browser repeated on each continuation. Nothing on the server did.
--
-- That was survivable while the runner's own tab drove every chunk. It stops
-- being survivable once the cron finishes runs nobody is watching: resuming a
-- full backfill as an incremental sync stops the walk at the previous
-- successful sync and quietly abandons every activity older than it.
--
-- False is the right default for existing rows. An unfinished run recorded
-- before this column existed is resumed incrementally, which is correct for the
-- common case and, for the rare interrupted backfill, costs one more `full=1`
-- from Profile rather than losing anything.

alter table public.sync_status
  add column if not exists resume_full boolean not null default false;
