-- Rollback script for scripts/007_add_goal_display_order.sql
--
-- Run this if you want to remove drag-and-drop ordering from goals:
--   psql $DATABASE_URL -f supabase/migrations/rollback_007_goal_display_order.sql
--
-- After running this, also revert the code changes on the branch:
--   git revert <dnd-commit-hash>

ALTER TABLE goals DROP COLUMN IF EXISTS display_order;
