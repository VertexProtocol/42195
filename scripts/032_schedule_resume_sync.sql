-- Migration 032: schedule the sync-resume job
--
-- The job itself is an HTTP route in the app (/api/cron/resume-sync). This is
-- only the clock, and the clock lives in Postgres rather than in vercel.json
-- because Vercel's Hobby plan does not merely limit crons to once a day — it
-- refuses the deployment outright:
--
--   Hobby accounts are limited to daily cron jobs. This cron expression
--   (*/15 * * * *) would run more than once per day.
--
-- Once a day would not be worth much anyway. Strava's window reopens every 15
-- minutes, and the whole point is that a runner who closed the app gets the
-- rest of their history without touching anything.
--
-- ── Run this by hand, not as part of a schema migration ────────────────────
--
-- It needs two values that must not be committed: the deployed origin and the
-- CRON_SECRET set in the Vercel project. Both go into Supabase Vault first, so
-- the secret is not sitting in plaintext in cron.job.command.
--
--   1. In the SQL editor, store the two values (once):
--
--        select vault.create_secret('https://your-app.vercel.app', 'app_origin');
--        select vault.create_secret('<the CRON_SECRET value>', 'cron_secret');
--
--      To rotate later, update the secret and leave the job alone:
--        select vault.update_secret(
--          (select id from vault.secrets where name = 'cron_secret'),
--          '<new value>');
--
--   2. Then run everything below.
--
-- To stop the job:  select cron.unschedule('resume-sync');
-- To see its runs:  select * from cron.job_run_details
--                     where jobid = (select jobid from cron.job where jobname = 'resume-sync')
--                     order by start_time desc limit 20;
--
-- Note that job_run_details records whether the *request was sent*, not what
-- the route answered. pg_net is asynchronous: the response lands in
-- net._http_response, and the route's own summary line goes to the platform
-- logs, which is the better place to read it.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Both extensions are superuser-owned and the schedule is infrastructure, not
-- application data: nothing reachable by the anon or authenticated roles
-- touches either.

select cron.schedule(
  'resume-sync',
  '*/15 * * * *',
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_origin')
             || '/api/cron/resume-sync',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    -- The route carries up to three runners through a chunk each, and its own
    -- ceiling is 60s. Timing out here would only orphan the request; the work
    -- continues either way, and the next tick picks up whatever it left.
    timeout_milliseconds := 60000
  );
  $$
);
