ALTER TABLE payment_gateway_config
ADD COLUMN IF NOT EXISTS stripe_price_basic_monthly TEXT,
ADD COLUMN IF NOT EXISTS stripe_price_basic_yearly TEXT,
ADD COLUMN IF NOT EXISTS stripe_price_pro_monthly TEXT,
ADD COLUMN IF NOT EXISTS stripe_price_pro_yearly TEXT,
ADD COLUMN IF NOT EXISTS stripe_price_enterprise_monthly TEXT,
ADD COLUMN IF NOT EXISTS stripe_price_enterprise_yearly TEXT;

-- Seed default row if missing
INSERT INTO payment_gateway_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;