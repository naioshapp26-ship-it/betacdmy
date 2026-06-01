-- Add follow_up_status column to users table (central database)
ALTER TABLE users ADD COLUMN IF NOT EXISTS follow_up_status TEXT;
