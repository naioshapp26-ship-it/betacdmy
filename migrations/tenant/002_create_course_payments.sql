-- Payment tracking table to capture actual cash flow per student enrollment
CREATE TABLE IF NOT EXISTS course_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id TEXT UNIQUE NOT NULL,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_name TEXT NOT NULL,
    student_email TEXT,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    course_title TEXT NOT NULL,
    instructor_name TEXT NOT NULL,
    instructor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    course_price NUMERIC(10,2) NOT NULL DEFAULT 0,
    amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
    payment_method TEXT NOT NULL,
    collected_by TEXT,
    collected_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_course_payments_student ON course_payments(student_id, course_id);
CREATE INDEX IF NOT EXISTS idx_course_payments_course ON course_payments(course_id);
CREATE INDEX IF NOT EXISTS idx_course_payments_instructor ON course_payments(instructor_id);
CREATE INDEX IF NOT EXISTS idx_course_payments_received_at ON course_payments(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_course_payments_method ON course_payments(payment_method);

-- Backfill any legacy transactions into the new receipts table for continuity
INSERT INTO course_payments (
    id,
    receipt_id,
    student_id,
    student_name,
    student_email,
    course_id,
    course_title,
    instructor_name,
    instructor_id,
    course_price,
    amount,
    payment_method,
    collected_by,
    collected_by_id,
    notes,
    received_at,
    created_at,
    updated_at
)
SELECT
    t.id,
    CONCAT('LEGACY-', LEFT(REPLACE(t.id::text, '-', ''), 12)),
    t.user_id,
    COALESCE(u.name, 'Student'),
    u.email,
    t.course_id,
    COALESCE(c.title, 'Course'),
    COALESCE(c.instructor, 'Instructor'),
    inst.id,
    COALESCE(c.price, t.amount, 0),
    t.amount,
    UPPER(COALESCE(NULLIF(t.method, ''), 'MANUAL')),
    NULL,
    NULL,
    NULL,
    COALESCE(t.transacted_on::timestamptz, now()),
    COALESCE(t.transacted_on::timestamptz, now()),
    COALESCE(t.transacted_on::timestamptz, now())
FROM transactions t
LEFT JOIN users u ON u.id = t.user_id
LEFT JOIN courses c ON c.id = t.course_id
LEFT JOIN users inst ON inst.role = 'INSTRUCTOR' AND LOWER(inst.name) = LOWER(c.instructor)
ON CONFLICT (id) DO NOTHING;
