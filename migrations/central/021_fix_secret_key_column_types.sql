-- Fix secret key columns from TEXT to BYTEA
-- The columns were incorrectly stored as TEXT instead of BYTEA
-- This causes encryption/decryption issues because BYTEA data gets converted to hex strings

-- First, we need to drop and recreate the columns since they contain encrypted data
-- that was corrupted by being stored in TEXT format

-- Backup existing data is not possible because it's already corrupted
-- Admin will need to re-enter the Stripe secret key after this migration

ALTER TABLE payment_gateway_config
  ALTER COLUMN stripe_secret_key TYPE BYTEA USING NULL,
  ALTER COLUMN paypal_secret_key TYPE BYTEA USING NULL,
  ALTER COLUMN visa_secret_key TYPE BYTEA USING NULL;

COMMENT ON COLUMN payment_gateway_config.stripe_secret_key IS 'Encrypted Stripe secret key using pgp_sym_encrypt (BYTEA)';
COMMENT ON COLUMN payment_gateway_config.paypal_secret_key IS 'Encrypted PayPal secret key using pgp_sym_encrypt (BYTEA)';
COMMENT ON COLUMN payment_gateway_config.visa_secret_key IS 'Encrypted Visa secret key using pgp_sym_encrypt (BYTEA)';
