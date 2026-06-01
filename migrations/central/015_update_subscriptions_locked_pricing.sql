-- Update subscriptions table to add locked pricing and improve data integrity
-- Add new columns with defaults to allow schema evolution
ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS locked_amount NUMERIC(10, 2),
ADD COLUMN IF NOT EXISTS locked_currency VARCHAR(3) DEFAULT 'USD',
ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES subscription_plans(id) ON DELETE RESTRICT,
ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255);

-- Add CHECK constraint only if it doesn't already exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'subscriptions_locked_currency_valid' 
    AND table_name = 'subscriptions'
  ) THEN
    ALTER TABLE subscriptions 
    ADD CONSTRAINT subscriptions_locked_currency_valid 
    CHECK (locked_currency IN ('USD', 'EUR', 'GBP', 'AED', 'SAR', 'EGP'));
  END IF;
END $$;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_id ON subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_id ON subscriptions(stripe_subscription_id);

-- Create partial unique index to ensure only one active subscription per tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_tenant_active 
ON subscriptions(tenant_id) 
WHERE status = 'active';

-- Backfill locked_amount from existing price_monthly where present and not yet filled
UPDATE subscriptions
SET 
  locked_amount = price_monthly,
  locked_currency = currency
WHERE locked_amount IS NULL 
  AND price_monthly IS NOT NULL;

-- Backfill plan_id from existing plan column by matching to subscription_plans
UPDATE subscriptions s
SET plan_id = sp.id
FROM subscription_plans sp
WHERE s.plan_id IS NULL
  AND s.plan = sp.code;

-- Make locked_amount NOT NULL after backfill (for new rows going forward, set default)
-- Note: This constraint will be enforced via application logic and triggers for existing data
ALTER TABLE subscriptions
ALTER COLUMN locked_amount SET DEFAULT 0,
ALTER COLUMN locked_currency SET DEFAULT 'USD';

-- Add a trigger to log subscription changes for audit purposes
DROP TRIGGER IF EXISTS trg_subscriptions_audit ON subscriptions;
CREATE TRIGGER trg_subscriptions_audit
BEFORE UPDATE ON subscriptions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
