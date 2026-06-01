-- Data migration: Create subscription records for tenants that don't have one
-- This ensures every active tenant has a corresponding subscription record
INSERT INTO subscriptions (
  tenant_id,
  plan,
  plan_id,
  status,
  price_monthly,
  locked_amount,
  locked_currency,
  currency,
  billing_cycle,
  current_period_start,
  current_period_end
)
SELECT
  t.id,
  t.subscription_plan,
  sp.id,
  'active',
  spp.amount,
  spp.amount,
  spp.currency,
  spp.currency,
  'monthly',
  t.created_at,
  t.created_at + INTERVAL '1 month'
FROM tenants t
LEFT JOIN subscriptions s ON s.tenant_id = t.id
LEFT JOIN subscription_plans sp ON sp.code = t.subscription_plan
LEFT JOIN subscription_plan_prices spp ON spp.plan_id = sp.id 
  AND spp.billing_cycle = 'monthly'
  AND spp.is_active = true
  AND spp.valid_from <= NOW()
  AND (spp.valid_to IS NULL OR spp.valid_to > NOW())
WHERE s.id IS NULL
  AND t.status = 'active'
  AND t.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- Update existing subscriptions to ensure they have current_period_start and current_period_end
UPDATE subscriptions
SET 
  current_period_start = COALESCE(current_period_start, created_at),
  current_period_end = COALESCE(current_period_end, created_at + INTERVAL '1 month')
WHERE current_period_start IS NULL
  OR current_period_end IS NULL;
