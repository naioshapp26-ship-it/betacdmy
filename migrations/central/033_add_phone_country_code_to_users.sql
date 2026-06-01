-- Add phone_country_code column to users table (central database)
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_country_code TEXT;
