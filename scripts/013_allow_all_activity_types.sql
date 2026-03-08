-- Remove the restrictive CHECK constraint on activity type
-- to allow all Strava activity types (Ride, Swim, Hike, etc.)
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_type_check;
