-- Add missing columns to central users table for course enrollment and payment support
-- These columns exist in tenant databases but were missing from the central platform_users migration

ALTER TABLE users ADD COLUMN IF NOT EXISTS enrolled_courses UUID[] DEFAULT ARRAY[]::UUID[];
ALTER TABLE users ADD COLUMN IF NOT EXISTS credits INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS streak INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS progress JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS specialization TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS years_of_experience INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS portfolio_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS social_links JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS certifications JSONB;

-- Create course_payments table for central domain course purchases
CREATE TABLE IF NOT EXISTS course_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id TEXT UNIQUE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_name TEXT,
    student_email TEXT,
    course_id UUID NOT NULL,
    course_title TEXT,
    instructor_name TEXT,
    instructor_id UUID,
    course_price NUMERIC(10,2) NOT NULL DEFAULT 0,
    amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
    payment_method TEXT NOT NULL,
    collected_by TEXT,
    collected_by_id UUID,
    notes TEXT,
    stripe_session_id TEXT,
    stripe_payment_intent_id TEXT,
    receipt_url TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_course_payments_student ON course_payments(student_id, course_id);
CREATE INDEX IF NOT EXISTS idx_course_payments_course ON course_payments(course_id);
CREATE INDEX IF NOT EXISTS idx_course_payments_stripe_session ON course_payments(stripe_session_id) WHERE stripe_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_course_payments_stripe_payment_intent ON course_payments(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

-- Update subscriptions status constraint to allow 'trialing' status from Stripe
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_valid;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_valid
  CHECK (status IN ('active', 'cancelled', 'expired', 'past_due', 'trialing', 'pending'));
