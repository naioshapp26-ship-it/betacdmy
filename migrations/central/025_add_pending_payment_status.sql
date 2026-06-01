-- Migration 025: Add pending_payment status and activated_at field
-- This migration adds support for pending_payment status during tenant provisioning
-- and adds activated_at timestamp to track when a tenant was activated after payment

-- Drop existing constraint and recreate with pending_payment status
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_status_valid;
ALTER TABLE tenants ADD CONSTRAINT tenants_status_valid
  CHECK (status IN ('active', 'suspended', 'deleted', 'pending_payment'));

-- Add activated_at field to track when tenant was activated
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

-- Create index for better query performance on activated_at
CREATE INDEX IF NOT EXISTS idx_tenants_activated_at ON tenants(activated_at) WHERE activated_at IS NOT NULL;
