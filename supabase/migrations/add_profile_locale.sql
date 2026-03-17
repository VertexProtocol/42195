-- Add locale column to profiles table for persisting language preference
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS locale varchar(2);
