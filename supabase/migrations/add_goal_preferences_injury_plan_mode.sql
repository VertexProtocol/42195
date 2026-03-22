-- Add injury_notes and plan_mode to goal_preferences.
-- Safe to re-run: IF NOT EXISTS guards prevent errors if already applied.
ALTER TABLE goal_preferences
  ADD COLUMN IF NOT EXISTS injury_notes  text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS plan_mode     text NOT NULL DEFAULT 'block';
