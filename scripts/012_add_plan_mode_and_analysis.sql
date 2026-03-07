-- Add plan_mode to goal_preferences for full-cycle vs block planning
alter table goal_preferences
  add column if not exists plan_mode text not null default 'block'
  check (plan_mode in ('block', 'full_cycle'));
