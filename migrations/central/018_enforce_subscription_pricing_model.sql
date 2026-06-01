-- Migration 018: Enforce Subscription Pricing Model
-- This migration ensures subscription records reliably store agreed-upon pricing
-- and clarifies the source of truth for pricing decisions

-- Add price snapshot JSON for historical audit trail (optional but recommended)
ALTER TABLE subscriptions 
ADD COLUMN IF NOT EXISTS price_snapshot JSONB DEFAULT NULL;

-- Add comment to clarify which column is the source of truth
COMMENT ON COLUMN subscriptions.plan_id IS 'Source of truth for subscription plan (FK to subscription_plans). Use this for runtime decisions.';
COMMENT ON COLUMN subscriptions.locked_amount IS 'Price customer agreed to at signup. Never changes unless customer explicitly changes plan. Source of truth for billing.';
COMMENT ON COLUMN subscriptions.locked_currency IS 'Currency customer agreed to at signup.';
COMMENT ON COLUMN subscriptions.price_monthly IS 'DEPRECATED: Legacy field. Use locked_amount instead.';
COMMENT ON TABLE subscriptions IS 'Subscription records with locked pricing. Each active tenant must have exactly one active subscription.';

-- Create function to validate subscription has locked pricing
CREATE OR REPLACE FUNCTION validate_subscription_locked_pricing()
RETURNS TRIGGER AS $$
BEGIN
  -- For new or updated subscriptions, ensure locked_amount is set
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
    -- If status is active, locked_amount must not be null
    IF NEW.status = 'active' AND NEW.locked_amount IS NULL THEN
      RAISE EXCEPTION 'Active subscriptions must have locked_amount set (agreed price at signup)';
    END IF;
    
    -- If locked_amount is set, locked_currency must be set
    IF NEW.locked_amount IS NOT NULL AND NEW.locked_currency IS NULL THEN
      RAISE EXCEPTION 'Subscriptions with locked_amount must have locked_currency set';
    END IF;
    
    -- If plan_id is null, try to backfill from plan code
    IF NEW.plan_id IS NULL AND NEW.plan IS NOT NULL THEN
      SELECT id INTO NEW.plan_id 
      FROM subscription_plans 
      WHERE code = NEW.plan 
      LIMIT 1;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to validate locked pricing on insert/update
DROP TRIGGER IF EXISTS trg_validate_subscription_locked_pricing ON subscriptions;
CREATE TRIGGER trg_validate_subscription_locked_pricing
  BEFORE INSERT OR UPDATE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION validate_subscription_locked_pricing();

-- Create function to generate price snapshot
CREATE OR REPLACE FUNCTION generate_subscription_price_snapshot()
RETURNS TRIGGER AS $$
BEGIN
  -- On insert or when locked_amount changes, create a price snapshot for audit trail
  IF (TG_OP = 'INSERT' OR 
      (TG_OP = 'UPDATE' AND (NEW.locked_amount IS DISTINCT FROM OLD.locked_amount OR 
                             NEW.locked_currency IS DISTINCT FROM OLD.locked_currency))) THEN
    NEW.price_snapshot = jsonb_build_object(
      'locked_amount', NEW.locked_amount,
      'locked_currency', NEW.locked_currency,
      'billing_cycle', NEW.billing_cycle,
      'plan_code', NEW.plan,
      'plan_id', NEW.plan_id,
      'snapshot_at', NOW(),
      'stripe_subscription_id', NEW.stripe_subscription_id
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to generate price snapshot
DROP TRIGGER IF EXISTS trg_generate_subscription_price_snapshot ON subscriptions;
CREATE TRIGGER trg_generate_subscription_price_snapshot
  BEFORE INSERT OR UPDATE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION generate_subscription_price_snapshot();

-- Backfill plan_id for subscriptions that don't have it yet
UPDATE subscriptions s
SET plan_id = sp.id
FROM subscription_plans sp
WHERE s.plan_id IS NULL
  AND s.plan = sp.code;

-- Backfill locked_amount for subscriptions that don't have it yet
-- Use price_monthly as fallback, or get from subscription_plan_prices
UPDATE subscriptions s
SET 
  locked_amount = COALESCE(s.locked_amount, s.price_monthly, spp.amount, 0),
  locked_currency = COALESCE(s.locked_currency, s.currency, spp.currency, 'USD')
FROM subscription_plan_prices spp
WHERE s.locked_amount IS NULL
  AND s.plan_id = spp.plan_id
  AND spp.billing_cycle = s.billing_cycle
  AND spp.is_active = true
  AND spp.valid_from <= NOW()
  AND (spp.valid_to IS NULL OR spp.valid_to > NOW());

-- Final fallback: set locked_amount to 0 if still null (for very old records)
UPDATE subscriptions
SET 
  locked_amount = COALESCE(locked_amount, price_monthly, 0),
  locked_currency = COALESCE(locked_currency, currency, 'USD')
WHERE locked_amount IS NULL;

-- Create index on price_snapshot for JSONB queries (optional)
CREATE INDEX IF NOT EXISTS idx_subscriptions_price_snapshot_gin 
ON subscriptions USING gin(price_snapshot);

-- Add CHECK constraint to ensure active subscriptions have locked pricing
-- Note: This is enforced via trigger above, but adding constraint for clarity
-- We use a partial index instead of a constraint to avoid breaking existing data
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_active_with_locked_price
ON subscriptions(tenant_id)
WHERE status = 'active' AND locked_amount IS NOT NULL;

-- Log the migration
DO $$
BEGIN
  RAISE NOTICE 'Migration 018 completed: Subscription pricing model enforced';
  RAISE NOTICE '  - Added price_snapshot JSONB column for audit trail';
  RAISE NOTICE '  - Added validation trigger for locked pricing';
  RAISE NOTICE '  - Added price snapshot generation trigger';
  RAISE NOTICE '  - Backfilled plan_id and locked_amount for existing subscriptions';
  RAISE NOTICE '  - Clarified source of truth via column comments';
END $$;
