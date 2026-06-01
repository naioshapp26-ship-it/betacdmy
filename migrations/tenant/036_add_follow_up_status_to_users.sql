-- Add follow_up_status column to users table (tenant databases)
ALTER TABLE users ADD COLUMN IF NOT EXISTS follow_up_status TEXT;
