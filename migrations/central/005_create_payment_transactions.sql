-- Payment transactions (placeholder for gateway integrations)
CREATE TABLE IF NOT EXISTS payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  subscription_id UUID REFERENCES subscriptions(id),
  amount DECIMAL(12,4) NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  status VARCHAR(20),
  payment_method VARCHAR(50),
  transaction_reference VARCHAR(255),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_tenant ON payment_transactions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_subscription ON payment_transactions(subscription_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_status ON payment_transactions(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_transactions_reference
  ON payment_transactions(transaction_reference)
  WHERE transaction_reference IS NOT NULL;
