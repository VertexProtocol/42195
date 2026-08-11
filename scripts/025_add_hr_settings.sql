-- Heart-rate calibration inputs.
--
-- Two problems this fixes:
--
-- 1. `activities` stored only avg_heart_rate, so max HR had to be *guessed*
--    from the highest average by multiplying it. Strava returns max_heartrate
--    on the same activity-list payload we already fetch, so the real per-run
--    peak was being thrown away. Storing it turns the estimate into an
--    observation.
--
-- 2. `profiles` had nowhere to record the athlete's own max/resting HR, yet
--    the calibration card compared the recommendation against a "current"
--    value it invented (observed max × 1.2). With no configured value to
--    compare against, the comparison was meaningless. These columns give it
--    a real baseline; when they are null the card now says "not configured"
--    instead of "misconfigured".
--
-- Existing rows keep max_heart_rate = null until the user re-syncs; the
-- analysis engine falls back to the old average-based estimate for them and
-- labels the result as lower confidence.

alter table public.activities
  add column if not exists max_heart_rate integer;

-- Same generous guardrail as avg_heart_rate (022): reject garbage, not
-- sport-specific extremes.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'activities_max_hr_reasonable'
  ) then
    alter table public.activities
      add constraint activities_max_hr_reasonable
      check (max_heart_rate is null or (max_heart_rate between 30 and 230));
  end if;
end $$;

-- A recorded peak below the recorded average is a data error, not a workout.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'activities_max_hr_gte_avg'
  ) then
    alter table public.activities
      add constraint activities_max_hr_gte_avg
      check (
        max_heart_rate is null
        or avg_heart_rate is null
        or max_heart_rate >= avg_heart_rate
      );
  end if;
end $$;

-- Partial index mirroring idx_activities_user_hr: the calibration query only
-- ever reads rows that actually carry a peak.
create index if not exists idx_activities_user_max_hr
  on public.activities(user_id, max_heart_rate)
  where max_heart_rate is not null and max_heart_rate > 0;

-- The athlete's own values. Null means "not configured" — the engine then
-- reports its estimate without claiming the user's setup is wrong.
alter table public.profiles
  add column if not exists max_hr integer,
  add column if not exists resting_hr integer;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_max_hr_reasonable'
  ) then
    alter table public.profiles
      add constraint profiles_max_hr_reasonable
      check (max_hr is null or (max_hr between 120 and 230));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_resting_hr_reasonable'
  ) then
    alter table public.profiles
      add constraint profiles_resting_hr_reasonable
      check (resting_hr is null or (resting_hr between 25 and 110));
  end if;
end $$;

-- Cached analyses were computed against the invented baseline, so every one
-- of them holds a bogus calibrationStatus. Drop them; the next page load
-- recomputes.
update public.profiles set hr_analysis_cache = null where hr_analysis_cache is not null;
