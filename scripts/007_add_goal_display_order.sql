-- Add display_order column to goals table for drag-and-drop reordering
ALTER TABLE goals ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;

-- Set initial order based on created_at for existing goals
UPDATE goals SET display_order = sub.row_num
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at) as row_num
  FROM goals
) sub
WHERE goals.id = sub.id;
