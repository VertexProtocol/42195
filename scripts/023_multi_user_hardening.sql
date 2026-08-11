-- Migration 023: multi-user hardening
--
-- Everything here is a prerequisite for letting more than one athlete into the
-- app. Run it before inviting anyone.
--
--   1. strava_tokens.athlete_id becomes unique — one Strava athlete may only be
--      linked to one app account, otherwise the webhook lookup on athlete_id
--      matches two rows and every delivery for both accounts is dropped.
--   2. allowed_signups — the invite allowlist checked by the sign-up action.
--   3. sync_status gains a resume cursor and two more states so a long history
--      sync can be spread over several requests instead of one long one.


-- ── 1 · One athlete, one account ───────────────────────────────────────────
-- Pre-flight: this index fails if two accounts already share an athlete_id.
-- Find them first, and delete the stale row(s) before running the migration:
--
--   select athlete_id, count(*) from strava_tokens group by 1 having count(*) > 1;
--
create unique index if not exists strava_tokens_athlete_id_key
  on public.strava_tokens (athlete_id);


-- ── 2 · Invite allowlist ───────────────────────────────────────────────────
-- Sign-up is refused unless the email has a row here. Supabase's own
-- "Allow new users to sign up" toggle stays the outer gate; this table decides
-- *who* gets through while it is on.
--
-- Invite someone:
--   insert into public.allowed_signups (email, note)
--   values ('runner@example.com', 'Beta group 1');
--
-- Withdraw an unused invite:
--   delete from public.allowed_signups where email = 'runner@example.com';
--
create table if not exists public.allowed_signups (
  email      text        primary key check (email = lower(email)),
  note       text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by uuid        references auth.users(id) on delete set null
);

-- No policies by design: the allowlist is read and written by the service role
-- only, from the server-side sign-up action. The anon key can never see it, so
-- the list of invited addresses is not enumerable from the browser.
alter table public.allowed_signups enable row level security;


-- ── 3 · Resumable sync ─────────────────────────────────────────────────────
-- cursor_before: the oldest activity start_date (unix seconds) already pulled
--   during a full history sync. The next run continues from there.
-- resume_at: when Strava's rate limit window reopens, if the sync stopped
--   because the app-wide limit was spent.
alter table public.sync_status
  add column if not exists cursor_before bigint,
  add column if not exists resume_at     timestamptz;

alter table public.sync_status drop constraint if exists sync_status_state_check;
alter table public.sync_status
  add constraint sync_status_state_check
  check (state in ('success', 'error', 'syncing', 'never', 'partial', 'rate_limited'));
