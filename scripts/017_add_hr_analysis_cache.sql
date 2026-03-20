-- Add HR analysis cache column to profiles table.
-- Stores the last computed HrAnalysisResult so it persists across sessions.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS hr_analysis_cache jsonb DEFAULT NULL;
