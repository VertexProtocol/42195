-- Migration 014: Reset Strava tokens
--
-- Clears all stored Strava OAuth tokens so a fresh bootstrap or OAuth flow
-- can be used without conflicts from stale / previously-issued tokens.
-- Run this before executing the bootstrap endpoint or re-authorising via OAuth.

truncate table strava_tokens;

-- Also clear any lingering sync status so the first sync runs as a full sync.
update sync_status
  set state        = 'never',
      last_sync_at = null,
      error_message = null,
      updated_at   = now()
  where true;
