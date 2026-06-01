-- Add Stripe integration fields to course_payments table
-- This allows tracking Stripe checkout sessions and payment intents for online course purchases

ALTER TABLE course_payments 
ADD COLUMN IF NOT EXISTS stripe_session_id TEXT,
ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT,
ADD COLUMN IF NOT EXISTS receipt_url TEXT;

-- Create indexes for Stripe lookup
CREATE INDEX IF NOT EXISTS idx_course_payments_stripe_session 
ON course_payments(stripe_session_id) WHERE stripe_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_course_payments_stripe_payment_intent 
ON course_payments(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

-- Update the receipt_id to be optional (it was previously required, but Stripe sessions generate their own IDs)
ALTER TABLE course_payments 
ALTER COLUMN receipt_id DROP NOT NULL;

-- Update existing NULL receipt_ids with generated values
UPDATE course_payments 
SET receipt_id = 'LEGACY-' || id::text 
WHERE receipt_id IS NULL;

-- Add back the NOT NULL constraint after filling nulls
ALTER TABLE course_payments 
ALTER COLUMN receipt_id SET NOT NULL;

-- Make student_name and course_title optional since Stripe sessions may not have this info initially
ALTER TABLE course_payments 
ALTER COLUMN student_name DROP NOT NULL,
ALTER COLUMN course_title DROP NOT NULL,
ALTER COLUMN instructor_name DROP NOT NULL;

COMMENT ON COLUMN course_payments.stripe_session_id IS 'Stripe checkout session ID for online payments';
COMMENT ON COLUMN course_payments.stripe_payment_intent_id IS 'Stripe payment intent ID for tracking payment status';
COMMENT ON COLUMN course_payments.receipt_url IS 'Stripe-generated receipt URL for customer download';
