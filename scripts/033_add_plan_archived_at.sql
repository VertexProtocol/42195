-- One active block at a time.
--
-- Nothing stopped two goals each holding a live block, and both ramped their
-- weekly volume from the same training history — so a runner on 40 km/week got
-- two plans each asking for ~44, and one Strava run ticked off a session in
-- both. A plan that has been superseded stays on its goal's row, readable as
-- history, but is no longer the training.
--
-- Nullable rather than a boolean: the timestamp answers "when did this stop
-- being the plan", which is what the goal screen needs to say so.
alter table ai_training_plans
  add column if not exists archived_at timestamptz default null;

-- Every read that asks "what is this runner training on" filters on this, so
-- it is worth an index alongside the existing user/generated_at one.
create index if not exists idx_ai_training_plans_user_active
  on ai_training_plans(user_id)
  where archived_at is null;
