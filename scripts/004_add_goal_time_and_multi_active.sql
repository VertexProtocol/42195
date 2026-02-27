-- =============================================
-- Migration 004: Add missing goal columns and allow multiple active goals
-- =============================================

-- Add start_date and target_time_seconds to goals table
-- (these were referenced in the app code but never created in the DB)
ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS target_time_seconds integer;

-- Drop the single-active-goal constraint so multiple goals can be active
DROP INDEX IF EXISTS idx_goals_one_active;
