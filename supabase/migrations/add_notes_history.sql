-- Add versioned notes history to goal_preferences so the AI can understand
-- when coach notes and injury notes were written and what training context surrounded them.
ALTER TABLE goal_preferences
  ADD COLUMN IF NOT EXISTS notes_history jsonb NOT NULL DEFAULT '[]'::jsonb;
