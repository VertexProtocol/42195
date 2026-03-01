-- =============================================
-- Migration 010: Add Walk activity type and map_polyline column
-- =============================================

-- The sync code now includes Walk activities from Strava, but the CHECK
-- constraint on activities.type only allows ('Run', 'Trail Run', 'Race').
-- This causes the entire upsert batch to fail when any Walk activity is
-- present, breaking both full and incremental sync.

-- 1. Drop the old CHECK constraint and replace with one that includes 'Walk'.
--    PostgreSQL names auto-generated CHECK constraints as <table>_<column>_check.
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_type_check;
ALTER TABLE public.activities
  ADD CONSTRAINT activities_type_check CHECK (type IN ('Run', 'Trail Run', 'Race', 'Walk'));

-- 2. Add map_polyline column (referenced in queries but never created).
ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS map_polyline text;
