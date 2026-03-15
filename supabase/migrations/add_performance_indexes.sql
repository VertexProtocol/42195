-- Performance indexes for common query patterns
-- These indexes support the most frequent queries in the application

-- HR analysis queries filter by user_id with avg_heart_rate conditions
CREATE INDEX IF NOT EXISTS idx_activities_user_hr
  ON activities (user_id, avg_heart_rate)
  WHERE avg_heart_rate IS NOT NULL AND avg_heart_rate > 0;

-- Reverse chronological activity listing (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_activities_user_date_desc
  ON activities (user_id, date DESC);

-- Test run trend analysis
CREATE INDEX IF NOT EXISTS idx_test_runs_user_created
  ON test_runs (user_id, created_at DESC);

-- Plan history lookups
CREATE INDEX IF NOT EXISTS idx_ai_training_plans_user_generated
  ON ai_training_plans (user_id, generated_at DESC);

-- Weekly goals lookups by week_start (used in recalculateGoals)
CREATE INDEX IF NOT EXISTS idx_weekly_goals_user_week
  ON weekly_goals (user_id, week_start);

-- Goals active filter (used in recalculateGoals)
CREATE INDEX IF NOT EXISTS idx_goals_user_active
  ON goals (user_id, is_active)
  WHERE is_active = true;

-- Replace global strava_id UNIQUE with per-user composite unique constraint.
-- This is safer: prevents cross-user data conflicts while allowing the
-- upsert on (user_id, strava_id) to work correctly.
-- Drop the old constraint first, then add the composite one.
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_strava_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_user_strava_id
  ON activities (user_id, strava_id)
  WHERE strava_id IS NOT NULL;
