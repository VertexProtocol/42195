-- Fix: Replace partial unique index with a proper unique constraint.
-- PostgreSQL does not allow partial unique indexes for ON CONFLICT upsert,
-- causing "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" errors during Strava activity sync.

-- Drop the partial index that can't be used for upserts
DROP INDEX IF EXISTS idx_activities_user_strava_id;

-- Add a proper unique constraint on (user_id, strava_id) for upsert support
ALTER TABLE activities ADD CONSTRAINT activities_user_id_strava_id_key
  UNIQUE (user_id, strava_id);
