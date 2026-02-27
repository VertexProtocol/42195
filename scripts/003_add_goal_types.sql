-- =============================================
-- Migration 003: Add goal categories and recurring weekly goals
-- =============================================

-- Add goal_category to goals table
-- 'performance'     : timed/distance benchmark (e.g. run 10 km in under 50 min)
-- 'event_training'  : preparing for a race/event (e.g. marathon in September)
ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS goal_category text NOT NULL DEFAULT 'performance'
  CHECK (goal_category IN ('performance', 'event_training'));

-- Add is_recurring to weekly_goals table
-- Recurring goals act as a template and appear in every week's view.
-- One-off goals are tied to a specific week_start date.
ALTER TABLE public.weekly_goals
  ADD COLUMN IF NOT EXISTS is_recurring boolean NOT NULL DEFAULT false;
