-- Add missing preference columns to goal_preferences.
-- These columns are referenced by the AI training plan API but were not
-- included in the original 007 migration.

ALTER TABLE goal_preferences
  ADD COLUMN IF NOT EXISTS weekly_increase_pct int NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS block_weeks int NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS regenerate_every_weeks int NOT NULL DEFAULT 4;

-- Store the user's adjustment note alongside the generated plan
ALTER TABLE ai_training_plans
  ADD COLUMN IF NOT EXISTS adjust_note text;
