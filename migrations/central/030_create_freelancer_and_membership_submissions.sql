CREATE TABLE IF NOT EXISTS freelancer_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  country TEXT NOT NULL,
  field_of_expertise TEXT NOT NULL,
  years_of_experience INTEGER NOT NULL DEFAULT 0,
  short_bio TEXT NOT NULL,
  cv_url TEXT,
  status TEXT NOT NULL DEFAULT 'NEW',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS membership_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  country TEXT NOT NULL,
  membership_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  payment_gateway TEXT,
  payment_reference TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_freelancer_submissions_created_at ON freelancer_submissions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_freelancer_submissions_email ON freelancer_submissions (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_freelancer_submissions_status ON freelancer_submissions (status);

CREATE INDEX IF NOT EXISTS idx_membership_submissions_created_at ON membership_submissions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_membership_submissions_email ON membership_submissions (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_membership_submissions_type_status ON membership_submissions (membership_type, status);