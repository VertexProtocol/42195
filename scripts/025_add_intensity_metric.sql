-- Add intensity_metric to goal_preferences
--
-- Controls whether the AI plan generator outputs pace targets (e.g. "4:30/km")
-- or HR-zone targets (e.g. "Z4 — 175–185 bpm") for structured workouts.
--
--   'auto'    — system decides based on available data
--   'pace'    — explicit pace targets
--   'hr_zone' — explicit HR-zone targets
--
-- The choice is resolved server-side at generation time and passed to Claude
-- as a single mode so the plan stays internally consistent (never mixes).

alter table public.goal_preferences
  add column if not exists intensity_metric text default 'auto'
  check (intensity_metric in ('auto', 'pace', 'hr_zone'));
