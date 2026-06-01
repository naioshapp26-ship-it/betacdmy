CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  plan VARCHAR(50) NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  price_monthly DECIMAL(10,2),
  currency VARCHAR(3) DEFAULT 'USD',
  billing_cycle VARCHAR(20) DEFAULT 'monthly',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT subscriptions_status_valid CHECK (status IN ('active', 'cancelled', 'expired', 'past_due')),
  CONSTRAINT subscriptions_plan_valid CHECK (plan IN ('basic', 'pro', 'enterprise')),
  CONSTRAINT subscriptions_billing_cycle_valid CHECK (billing_cycle IN ('monthly', 'yearly'))
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

DROP TRIGGER IF EXISTS trg_set_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER trg_set_subscriptions_updated_at
BEFORE UPDATE ON subscriptions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
