-- Create subscription_plan_prices table for pricing history and versioning
CREATE TABLE IF NOT EXISTS subscription_plan_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  billing_cycle VARCHAR(20) NOT NULL,
  amount NUMERIC(10, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  valid_from TIMESTAMPTZ NOT NULL,
  valid_to TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT plan_prices_billing_cycle_valid CHECK (billing_cycle IN ('monthly', 'yearly')),
  CONSTRAINT plan_prices_amount_positive CHECK (amount >= 0),
  CONSTRAINT plan_prices_valid_dates CHECK (valid_to IS NULL OR valid_from <= valid_to)
);

CREATE INDEX IF NOT EXISTS idx_subscription_plan_prices_plan_id ON subscription_plan_prices(plan_id);
CREATE INDEX IF NOT EXISTS idx_subscription_plan_prices_is_active ON subscription_plan_prices(is_active);
CREATE INDEX IF NOT EXISTS idx_subscription_plan_prices_valid_from ON subscription_plan_prices(valid_from);
CREATE INDEX IF NOT EXISTS idx_subscription_plan_prices_plan_cycle ON subscription_plan_prices(plan_id, billing_cycle, valid_from);

DROP TRIGGER IF EXISTS trg_set_subscription_plan_prices_updated_at ON subscription_plan_prices;
CREATE TRIGGER trg_set_subscription_plan_prices_updated_at
BEFORE UPDATE ON subscription_plan_prices
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Insert default prices for each plan (can be customized per tenant/region)
WITH plans AS (
  SELECT id, code FROM subscription_plans
)
INSERT INTO subscription_plan_prices (plan_id, billing_cycle, amount, currency, valid_from, is_active)
SELECT 
  p.id,
  cycle,
  CASE 
    WHEN p.code = 'basic' AND cycle = 'monthly' THEN 29.00
    WHEN p.code = 'basic' AND cycle = 'yearly' THEN 290.00
    WHEN p.code = 'pro' AND cycle = 'monthly' THEN 99.00
    WHEN p.code = 'pro' AND cycle = 'yearly' THEN 990.00
    WHEN p.code = 'enterprise' AND cycle = 'monthly' THEN 299.00
    WHEN p.code = 'enterprise' AND cycle = 'yearly' THEN 2990.00
  END,
  'USD',
  NOW(),
  true
FROM plans p
CROSS JOIN (VALUES ('monthly'), ('yearly')) AS billing_cycles(cycle)
ON CONFLICT DO NOTHING;
