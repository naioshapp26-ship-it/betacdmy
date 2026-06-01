-- Add stripe_webhook_secret column to tenant payment_gateway_config
-- This allows tenants to configure their own Stripe webhook secrets for course payment webhooks

DO $$ 
BEGIN
  -- Add stripe_webhook_secret column if it doesn't exist
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'payment_gateway_config' 
    AND column_name = 'stripe_webhook_secret'
  ) THEN
    ALTER TABLE payment_gateway_config ADD COLUMN stripe_webhook_secret BYTEA;
    
    COMMENT ON COLUMN payment_gateway_config.stripe_webhook_secret IS 'Encrypted Stripe webhook secret using pgp_sym_encrypt (BYTEA)';
    
    RAISE NOTICE 'Added stripe_webhook_secret column to payment_gateway_config';
  END IF;
END $$;
