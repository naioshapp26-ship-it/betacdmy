-- =====================================================
-- Migration: Fix updated_at trigger for legacy tables
-- Description:
-- 1) Makes set_updated_at() safe when updated_at column is missing (legacy schemas)
-- 2) Ensures updated_at exists on central tables that attach set_updated_at()
-- Date: 2026-02-18
-- =====================================================

-- 1) Safer trigger function (doesn't crash if updated_at is missing)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  IF to_jsonb(NEW) ? 'updated_at' THEN
    NEW := jsonb_populate_record(NEW, jsonb_build_object('updated_at', NOW()));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2) Ensure updated_at exists for all central tables that use set_updated_at()
-- (Older installs may have pre-existing tables created without updated_at.
--  Triggers are still created and would fail on UPDATE.)

ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE IF EXISTS tenants ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE IF EXISTS tenant_admins ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE IF EXISTS tenant_admins ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE IF EXISTS subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE IF EXISTS subscriptions ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE IF EXISTS payment_transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE IF EXISTS payment_transactions ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE IF EXISTS users ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE IF EXISTS tenant_user_links ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE IF EXISTS tenant_user_links ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE IF EXISTS media_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE IF EXISTS media_settings ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE IF EXISTS provisioning_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE IF EXISTS provisioning_logs ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE IF EXISTS system_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE IF EXISTS system_settings ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE IF EXISTS payment_gateway_config ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE IF EXISTS payment_gateway_config ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE IF EXISTS subscription_plans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE IF EXISTS subscription_plans ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE IF EXISTS subscription_plan_prices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE IF EXISTS subscription_plan_prices ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE IF EXISTS ai_config ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE IF EXISTS ai_config ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE IF EXISTS subscription_refunds ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE IF EXISTS subscription_refunds ALTER COLUMN updated_at SET DEFAULT NOW();
