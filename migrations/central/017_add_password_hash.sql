-- Add password_hash column for secure password storage in tenant_admins
-- This is an additive migration - we keep the old password column for backward compatibility
ALTER TABLE tenant_admins ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Index for performance (optional)
CREATE INDEX IF NOT EXISTS idx_tenant_admins_password_hash ON tenant_admins(password_hash) WHERE password_hash IS NOT NULL;
