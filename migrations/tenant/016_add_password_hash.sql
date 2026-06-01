-- Add password_hash column for secure password storage
-- This is an additive migration - we keep the old password column for backward compatibility
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Index for performance (optional)
CREATE INDEX IF NOT EXISTS idx_users_password_hash ON users(password_hash) WHERE password_hash IS NOT NULL;
