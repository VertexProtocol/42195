-- Migration 023: enforce one app user per Strava athlete
--
-- Multi-user readiness fix. strava_tokens.user_id is the primary key, so a
-- single user can only have one Strava connection. But nothing previously
-- stopped two *different* app users from connecting the SAME Strava athlete.
--
-- That breaks the webhook dispatcher in app/api/webhooks/strava/route.ts, which
-- resolves an incoming event's owner_id (athlete_id) to a user via
--   .eq("athlete_id", owner_id).maybeSingle()
-- maybeSingle() throws when more than one row matches, so a duplicate athlete
-- would silently drop every webhook for both users.
--
-- A Strava athlete maps to exactly one app account, so we enforce that with a
-- UNIQUE constraint on athlete_id.

-- Defensive de-dupe: if duplicates already exist, keep the most recently
-- updated row (the freshest binding) and drop the stale ones. On a clean
-- install this deletes nothing.
delete from strava_tokens t
using strava_tokens newer
where t.athlete_id = newer.athlete_id
  and (
    newer.updated_at > t.updated_at
    or (newer.updated_at = t.updated_at and newer.user_id > t.user_id)
  );

create unique index if not exists strava_tokens_athlete_id_key
  on strava_tokens (athlete_id);
