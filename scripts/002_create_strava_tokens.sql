-- Migration 002: strava_tokens table
--
-- Stores Strava OAuth tokens server-side only.
-- RLS is intentionally DISABLED on this table — access is restricted to the
-- Supabase service role (used exclusively in server-side API routes).
-- The browser / anon key can never read or write this table.

create table if not exists strava_tokens (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  athlete_id   bigint not null,
  access_token text not null,
  refresh_token text not null,
  expires_at   timestamptz not null,
  scope        text,
  updated_at   timestamptz not null default now()
);

-- No RLS policies — service role only.
-- If you ever need row-level access for the authenticated user (e.g. to let the
-- client check whether Strava is connected without exposing the token), add a
-- policy that selects only a boolean "connected" flag via a separate view.

-- Trigger to keep updated_at current
create or replace function update_strava_tokens_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists strava_tokens_updated_at on strava_tokens;
create trigger strava_tokens_updated_at
  before update on strava_tokens
  for each row execute function update_strava_tokens_updated_at();
