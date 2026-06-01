-- Subscription Refunds Table (Central Database)
-- Stores refund records for tenant subscription payments (payment_transactions)
-- Used by Super Admin to refund tenant subscription payments

CREATE TABLE IF NOT EXISTS subscription_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_transaction_id UUID NOT NULL REFERENCES payment_transactions(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  refund_id VARCHAR(100) NOT NULL UNIQUE,
  stripe_refund_id VARCHAR(100),
  amount DECIMAL(12,4) NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
  reason VARCHAR(255),
  refunded_by UUID REFERENCES tenant_admins(id) ON DELETE SET NULL,
  refunded_by_name VARCHAR(255),
  refunded_by_email VARCHAR(255),
  stripe_receipt_number VARCHAR(100),
  metadata JSONB,
  refunded_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_subscription_refunds_payment ON subscription_refunds(payment_transaction_id);
CREATE INDEX IF NOT EXISTS idx_subscription_refunds_tenant ON subscription_refunds(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscription_refunds_status ON subscription_refunds(status);
CREATE INDEX IF NOT EXISTS idx_subscription_refunds_stripe_id ON subscription_refunds(stripe_refund_id) WHERE stripe_refund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subscription_refunds_refunded_at ON subscription_refunds(refunded_at DESC);

-- Add trigger for updated_at
DROP TRIGGER IF EXISTS trg_set_subscription_refunds_updated_at ON subscription_refunds;
CREATE TRIGGER trg_set_subscription_refunds_updated_at
BEFORE UPDATE ON subscription_refunds
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Add refund tracking columns to payment_transactions if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payment_transactions' AND column_name = 'refunded_amount') THEN
    ALTER TABLE payment_transactions ADD COLUMN refunded_amount DECIMAL(12,4) DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payment_transactions' AND column_name = 'refund_status') THEN
    ALTER TABLE payment_transactions ADD COLUMN refund_status VARCHAR(20) CHECK (refund_status IN ('none', 'partial', 'full'));
  END IF;
END $$;

-- Set default value for existing rows
UPDATE payment_transactions 
SET refunded_amount = 0, refund_status = 'none' 
WHERE refunded_amount IS NULL;

COMMENT ON TABLE subscription_refunds IS 'Stores refund records for tenant subscription payments processed by super admin';
COMMENT ON COLUMN subscription_refunds.payment_transaction_id IS 'Reference to the original payment transaction being refunded';
COMMENT ON COLUMN subscription_refunds.stripe_refund_id IS 'Stripe refund ID if processed through Stripe';
COMMENT ON COLUMN subscription_refunds.refunded_by IS 'Super admin who processed the refund';
