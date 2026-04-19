-- Add sanity-check constraints to the activities table. These run on every
-- insert/update and can't be bypassed by a misbehaving client (manual form,
-- malicious POST, or a future API that forgets its own validation).
--
-- Values are intentionally generous — they're guardrails against garbage
-- input, not sport-specific limits. Ultra-marathoners can log 200 km runs;
-- the constraint is about rejecting 9999999 or negative numbers.

alter table public.activities
  add constraint activities_distance_km_reasonable
  check (distance_km > 0 and distance_km <= 500);

alter table public.activities
  add constraint activities_duration_positive
  check (duration_seconds > 0);

alter table public.activities
  add constraint activities_hr_reasonable
  check (avg_heart_rate is null or (avg_heart_rate between 30 and 230));

alter table public.activities
  add constraint activities_elevation_nonnegative
  check (elevation_gain_m is null or elevation_gain_m >= 0);
