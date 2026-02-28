-- Add previous_plans column to ai_training_plans for plan versioning.
-- Stores an array of {plan, generated_at, adjust_note, block_start_date} objects.
ALTER TABLE ai_training_plans
  ADD COLUMN IF NOT EXISTS previous_plans jsonb NOT NULL DEFAULT '[]';
