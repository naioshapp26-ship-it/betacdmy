-- =====================================================
-- Migration: Standardize Audit Columns Across Central Tables
-- Description: Adds missing updated_at columns and standardizes timestamp types
-- Date: 2026-01-14
-- =====================================================

-- 1. Add updated_at to tenant_admins
ALTER TABLE tenant_admins 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Create trigger for tenant_admins
DROP TRIGGER IF EXISTS trg_set_tenant_admins_updated_at ON tenant_admins;
CREATE TRIGGER trg_set_tenant_admins_updated_at
BEFORE UPDATE ON tenant_admins
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- 2. Add updated_at to payment_transactions
ALTER TABLE payment_transactions 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Create trigger for payment_transactions
DROP TRIGGER IF EXISTS trg_set_payment_transactions_updated_at ON payment_transactions;
CREATE TRIGGER trg_set_payment_transactions_updated_at
BEFORE UPDATE ON payment_transactions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- 3. Standardize media_settings timestamps from TIMESTAMP to TIMESTAMPTZ
-- First, create new columns with correct type
ALTER TABLE media_settings 
ADD COLUMN IF NOT EXISTS created_at_new TIMESTAMPTZ;

ALTER TABLE media_settings 
ADD COLUMN IF NOT EXISTS updated_at_new TIMESTAMPTZ;

-- Copy data from old columns to new ones (converting to TIMESTAMPTZ)
UPDATE media_settings 
SET created_at_new = created_at AT TIME ZONE 'UTC',
    updated_at_new = updated_at AT TIME ZONE 'UTC'
WHERE created_at_new IS NULL OR updated_at_new IS NULL;

-- Drop old columns
ALTER TABLE media_settings DROP COLUMN IF EXISTS created_at;
ALTER TABLE media_settings DROP COLUMN IF EXISTS updated_at;

-- Rename new columns to standard names
ALTER TABLE media_settings RENAME COLUMN created_at_new TO created_at;
ALTER TABLE media_settings RENAME COLUMN updated_at_new TO updated_at;

-- Set defaults for media_settings
ALTER TABLE media_settings ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE media_settings ALTER COLUMN updated_at SET DEFAULT NOW();

-- Create trigger for media_settings
DROP TRIGGER IF EXISTS trg_set_media_settings_updated_at ON media_settings;
CREATE TRIGGER trg_set_media_settings_updated_at
BEFORE UPDATE ON media_settings
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- 4. Add standard audit columns to provisioning_logs
ALTER TABLE provisioning_logs 
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill created_at from started_at where created_at is null
UPDATE provisioning_logs 
SET created_at = started_at 
WHERE created_at IS NULL AND started_at IS NOT NULL;

-- Create trigger for provisioning_logs
DROP TRIGGER IF EXISTS trg_set_provisioning_logs_updated_at ON provisioning_logs;
CREATE TRIGGER trg_set_provisioning_logs_updated_at
BEFORE UPDATE ON provisioning_logs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Add comments for clarity
COMMENT ON COLUMN tenant_admins.updated_at IS 'Timestamp of last update (auto-managed by trigger)';
COMMENT ON COLUMN payment_transactions.updated_at IS 'Timestamp of last update (auto-managed by trigger)';
COMMENT ON COLUMN provisioning_logs.created_at IS 'Timestamp when record was created';
COMMENT ON COLUMN provisioning_logs.updated_at IS 'Timestamp of last update (auto-managed by trigger)';

-- Create indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_tenant_admins_updated_at ON tenant_admins(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_updated_at ON payment_transactions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_provisioning_logs_created_at ON provisioning_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provisioning_logs_updated_at ON provisioning_logs(updated_at DESC);

-- =====================================================
-- Verification Queries (for testing)
-- =====================================================

-- Run these queries to verify the migration:
-- SELECT table_name, column_name, data_type, column_default 
-- FROM information_schema.columns 
-- WHERE table_schema = 'public' 
--   AND column_name IN ('created_at', 'updated_at')
--   AND table_name IN ('tenant_admins', 'payment_transactions', 'subscriptions', 
--                      'tenants', 'tenant_user_links', 'media_settings', 'provisioning_logs')
-- ORDER BY table_name, column_name;
