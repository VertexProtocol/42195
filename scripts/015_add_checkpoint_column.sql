-- Add mid-block checkpoint storage to ai_training_plans
-- The checkpoint records adherence analysis at the halfway point of a 4+ week
-- training block and stores any plan adjustments made to remaining weeks.
alter table ai_training_plans
  add column if not exists mid_block_checkpoint jsonb default null;
