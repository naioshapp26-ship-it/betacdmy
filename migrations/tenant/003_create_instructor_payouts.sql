-- Instructor payout tracking table to capture payments made to instructors
CREATE TABLE IF NOT EXISTS instructor_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instructor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    instructor_name TEXT NOT NULL,
    amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
    payment_method TEXT NOT NULL,
    course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    course_title TEXT,
    reference TEXT,
    notes TEXT,
    recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    recorded_by_name TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_instructor_payouts_instructor ON instructor_payouts (instructor_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_instructor_payouts_recorded_at ON instructor_payouts (recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_instructor_payouts_course ON instructor_payouts (course_id);
CREATE INDEX IF NOT EXISTS idx_instructor_payouts_method ON instructor_payouts (payment_method);
