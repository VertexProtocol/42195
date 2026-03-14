-- Add prediction validation column to test_runs.
-- Stores the comparison between predicted and actual performance when a test run
-- is linked to a race prediction distance.
alter table test_runs add column if not exists prediction_validation jsonb default null;
