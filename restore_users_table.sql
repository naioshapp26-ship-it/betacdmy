-- CRITICAL: Database restoration script
-- This will restore the users table to match the LMS schema
-- RUN THIS AT YOUR OWN RISK - it will drop and recreate the users table!

BEGIN;

-- Step 1: Backup existing users data
CREATE TABLE IF NOT EXISTS users_backup_20260126 AS SELECT * FROM users;

-- Step 2: Drop the incorrect users table
DROP TABLE IF EXISTS users CASCADE;

-- Step 3: Recreate users table with correct LMS schema
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT,
  password_hash TEXT,
  role TEXT NOT NULL,
  avatar TEXT,
  status TEXT,
  phone TEXT,
  join_date DATE,
  last_active TIMESTAMPTZ,
  last_login_date DATE,
  enrolled_courses UUID[] DEFAULT ARRAY[]::UUID[],
  progress INTEGER,
  plan TEXT,
  credits INTEGER DEFAULT 0,
  streak INTEGER DEFAULT 0,
  notes TEXT,
  specialization TEXT,
  bio TEXT,
  years_of_experience INTEGER,
  portfolio_url TEXT,
  social_links JSONB DEFAULT '{}'::jsonb,
  certifications TEXT[] DEFAULT ARRAY[]::TEXT[]
);

-- Step 4: Create indexes
CREATE INDEX IF NOT EXISTS idx_users_password_hash ON users(password_hash) WHERE password_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Step 5: Migrate data from backup if possible
-- This attempts to map old structure to new structure
INSERT INTO users (
  id,
  name,
  email,
  password_hash,
  role,
  phone,
  status,
  join_date,
  last_active
)
SELECT 
  id,
  full_name,  -- Map full_name to name
  email,
  password_hash,
  role,
  phone_number,  -- Map phone_number to phone
  CASE 
    WHEN is_active THEN 'Active'
    ELSE 'Inactive'
  END,  -- Map is_active boolean to status text
  created_at::date,  -- Map created_at to join_date
  updated_at  -- Map updated_at to last_active
FROM users_backup_20260126
ON CONFLICT (email) DO NOTHING;

-- Step 6: Verify the restoration
SELECT 
  'users' as table_name,
  COUNT(*) as row_count,
  COUNT(DISTINCT email) as unique_emails
FROM users;

COMMIT;

-- Display structure
\d users
