-- Add payment refunds tracking table for Stripe refund management
-- This allows admins to refund course payments and track refund status

CREATE TABLE IF NOT EXISTS payment_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES course_payments(id) ON DELETE CASCADE,
  refund_id TEXT NOT NULL UNIQUE, -- Internal refund ID for tracking
  stripe_refund_id TEXT UNIQUE, -- Stripe refund ID (if payment was via Stripe)
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')) DEFAULT 'pending',
  reason TEXT, -- Admin reason for refund
  refunded_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  refunded_by_name TEXT NOT NULL, -- Cached name for audit trail
  refunded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stripe_receipt_number TEXT, -- Stripe receipt number for refund
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_payment_refunds_payment_id 
ON payment_refunds(payment_id);

CREATE INDEX IF NOT EXISTS idx_payment_refunds_stripe_refund_id 
ON payment_refunds(stripe_refund_id) WHERE stripe_refund_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_refunds_status 
ON payment_refunds(status);

CREATE INDEX IF NOT EXISTS idx_payment_refunds_refunded_at 
ON payment_refunds(refunded_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_refunds_refunded_by 
ON payment_refunds(refunded_by);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_payment_refunds_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Make trigger creation idempotent (PostgreSQL has no CREATE TRIGGER IF NOT EXISTS)
DROP TRIGGER IF EXISTS trigger_update_payment_refunds_updated_at ON payment_refunds;
CREATE TRIGGER trigger_update_payment_refunds_updated_at
  BEFORE UPDATE ON payment_refunds
  FOR EACH ROW EXECUTE FUNCTION update_payment_refunds_updated_at();

-- Add comments for documentation
COMMENT ON TABLE payment_refunds IS 'Tracks refunds for course payments, supporting partial and full refunds';
COMMENT ON COLUMN payment_refunds.refund_id IS 'Internal unique refund identifier for tracking';
COMMENT ON COLUMN payment_refunds.stripe_refund_id IS 'Stripe refund ID for online payments';
COMMENT ON COLUMN payment_refunds.amount IS 'Amount refunded in the specified currency';
COMMENT ON COLUMN payment_refunds.status IS 'Refund status: pending (Stripe processing), succeeded (completed), failed (error)';
COMMENT ON COLUMN payment_refunds.reason IS 'Admin-provided reason for the refund';
COMMENT ON COLUMN payment_refunds.refunded_by IS 'User ID of admin who processed the refund';
COMMENT ON COLUMN payment_refunds.refunded_by_name IS 'Cached admin name for audit trail';
COMMENT ON COLUMN payment_refunds.stripe_receipt_number IS 'Stripe-generated receipt number for refund';

-- Example query to get refund summary for a payment:
-- SELECT 
--   p.id as payment_id,
--   p.amount as original_amount,
--   COALESCE(SUM(r.amount) FILTER (WHERE r.status = 'succeeded'), 0) as total_refunded,
--   p.amount - COALESCE(SUM(r.amount) FILTER (WHERE r.status = 'succeeded'), 0) as remaining_balance
-- FROM course_payments p
-- LEFT JOIN payment_refunds r ON p.id = r.payment_id
-- WHERE p.id = $1
-- GROUP BY p.id, p.amount;