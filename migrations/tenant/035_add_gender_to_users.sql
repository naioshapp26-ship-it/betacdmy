-- Add gender column to the tenant users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT;
