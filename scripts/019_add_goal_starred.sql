-- [STAR] Add is_starred column to goals for pinned home screen cards
ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS is_starred BOOLEAN NOT NULL DEFAULT FALSE;
