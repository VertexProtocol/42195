-- Add injury_notes column to goal_preferences for recurring injury context
ALTER TABLE goal_preferences
  ADD COLUMN IF NOT EXISTS injury_notes TEXT;
