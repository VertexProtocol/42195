-- =============================================
-- 005: Add per-session requirement columns to weekly_goals
-- =============================================
-- Allows a "sessions" weekly goal to only count sessions that meet
-- a minimum duration or minimum distance threshold.
-- Both are optional; if both are set, a session must satisfy both.

alter table public.weekly_goals
  add column if not exists session_min_duration_minutes integer,
  add column if not exists session_min_distance_km numeric(6,2);
