-- Add secure password reset support for central users and tenant admins
-- Also ensure central users have password_hash for secure storage

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS reset_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ;

ALTER TABLE tenant_admins
  ADD COLUMN IF NOT EXISTS reset_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_reset_token_hash
  ON users(reset_token_hash)
  WHERE reset_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tenant_admins_reset_token_hash
  ON tenant_admins(reset_token_hash)
  WHERE reset_token_hash IS NOT NULL;
