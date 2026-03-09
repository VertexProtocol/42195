-- Add avg_cadence column to activities table
-- Strava provides average_cadence (steps/minute) for running activities
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS avg_cadence integer DEFAULT NULL;

-- Note: existing rows will have avg_cadence = NULL
-- New syncs from Strava will populate this field for activities that have cadence data
