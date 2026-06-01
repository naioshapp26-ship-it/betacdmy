-- Add phone_country_code column to users table (tenant databases)
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_country_code TEXT;
