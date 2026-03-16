-- Ensure all goal_preferences columns added in later migrations exist.
-- Safe to run multiple times (IF NOT EXISTS guards).

ALTER TABLE goal_preferences
  ADD COLUMN IF NOT EXISTS weekly_increase_pct integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS block_weeks         integer NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS regenerate_every_weeks integer NOT NULL DEFAULT 4;

ALTER TABLE goal_preferences
  ADD COLUMN IF NOT EXISTS plan_mode text NOT NULL DEFAULT 'block';

-- Add the check constraint only if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'goal_preferences_plan_mode_check'
  ) THEN
    ALTER TABLE goal_preferences
      ADD CONSTRAINT goal_preferences_plan_mode_check
      CHECK (plan_mode IN ('block', 'full_cycle'));
  END IF;
END $$;

-- Ensure mid_block_checkpoint column exists on ai_training_plans
ALTER TABLE ai_training_plans
  ADD COLUMN IF NOT EXISTS mid_block_checkpoint jsonb DEFAULT NULL;
