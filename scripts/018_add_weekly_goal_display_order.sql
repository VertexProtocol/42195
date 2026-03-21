-- Add display_order column to weekly_goals for drag-and-drop reordering
ALTER TABLE weekly_goals ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;

-- Set initial order based on created_at for existing weekly goals
UPDATE weekly_goals SET display_order = sub.row_num
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at) as row_num
  FROM weekly_goals
) sub
WHERE weekly_goals.id = sub.id;
