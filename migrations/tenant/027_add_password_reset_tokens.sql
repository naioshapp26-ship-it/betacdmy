-- Add secure password reset support for tenant users
-- Keep password column for backward compatibility but prefer password_hash

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS reset_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_reset_token_hash
  ON users(reset_token_hash)
  WHERE reset_token_hash IS NOT NULL;
