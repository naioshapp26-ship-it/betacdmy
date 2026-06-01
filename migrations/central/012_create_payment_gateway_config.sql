-- Payment Gateway Configuration for Super Admin (Main Domain)
-- This table stores payment gateway credentials for tenant signup/provisioning
-- These are used ONLY for the main domain (www.betacdmy.com)

-- Check if table exists and add missing columns if needed
DO $$ 
BEGIN
  -- Create table if it doesn't exist
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'payment_gateway_config') THEN
    CREATE TABLE payment_gateway_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      -- Stripe Configuration
      stripe_enabled BOOLEAN NOT NULL DEFAULT false,
      stripe_public_key TEXT,
      stripe_secret_key BYTEA,
      stripe_webhook_secret BYTEA,
      
      -- PayPal Configuration
      paypal_enabled BOOLEAN NOT NULL DEFAULT false,
      paypal_client_id TEXT,
      paypal_secret_key BYTEA,
      
      -- Visa/Credit Card Direct Configuration
      visa_enabled BOOLEAN NOT NULL DEFAULT false,
      visa_public_key TEXT,
      visa_secret_key BYTEA,
      
      -- Metadata
      updated_by UUID REFERENCES tenant_admins(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      
      CONSTRAINT payment_gateway_config_single_row CHECK (id = 1)
    );
  ELSE
    -- Add missing columns if table exists
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'payment_gateway_config' AND column_name = 'stripe_webhook_secret') THEN
      ALTER TABLE payment_gateway_config ADD COLUMN stripe_webhook_secret BYTEA;
    END IF;
    
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'payment_gateway_config' AND column_name = 'created_at') THEN
      ALTER TABLE payment_gateway_config ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
    END IF;
  END IF;
END $$;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS trg_set_payment_gateway_config_updated_at ON payment_gateway_config;
CREATE TRIGGER trg_set_payment_gateway_config_updated_at
BEFORE UPDATE ON payment_gateway_config
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Insert default row (all gateways disabled initially)
INSERT INTO payment_gateway_config (
  id,
  stripe_enabled,
  stripe_public_key,
  stripe_secret_key,
  stripe_webhook_secret,
  paypal_enabled,
  paypal_client_id,
  paypal_secret_key,
  visa_enabled,
  visa_public_key,
  visa_secret_key,
  updated_by
) VALUES (
  1,
  false,
  NULL,
  NULL,
  NULL,
  false,
  NULL,
  NULL,
  false,
  NULL,
  NULL,
  NULL
) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE payment_gateway_config IS 'Payment gateway configuration for Super Admin (main domain only) - used for tenant signup/provisioning';
COMMENT ON COLUMN payment_gateway_config.stripe_secret_key IS 'Encrypted Stripe secret key using pgp_sym_encrypt';
COMMENT ON COLUMN payment_gateway_config.stripe_webhook_secret IS 'Encrypted Stripe webhook secret using pgp_sym_encrypt';
COMMENT ON COLUMN payment_gateway_config.paypal_secret_key IS 'Encrypted PayPal secret key using pgp_sym_encrypt';
COMMENT ON COLUMN payment_gateway_config.visa_secret_key IS 'Encrypted Visa/Card processor secret key using pgp_sym_encrypt';

