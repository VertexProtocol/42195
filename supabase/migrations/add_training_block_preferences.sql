-- Add training block configuration fields to goal_preferences
ALTER TABLE goal_preferences
  ADD COLUMN IF NOT EXISTS weekly_increase_pct  integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS block_weeks          integer NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS regenerate_every_weeks integer NOT NULL DEFAULT 4;
