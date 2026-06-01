-- Core LMS schema for each tenant database
-- This mirrors the existing single-tenant tables so each tenant is fully isolated.

-- Rewards configuration
CREATE TABLE IF NOT EXISTS rewards_config (
  id SERIAL PRIMARY KEY,
  daily_login INTEGER NOT NULL,
  lesson_completion INTEGER NOT NULL,
  quiz_pass INTEGER NOT NULL,
  assignment_submission INTEGER NOT NULL,
  credits_per_currency_unit NUMERIC(12,2) NOT NULL DEFAULT 3000,
  currency_code TEXT NOT NULL DEFAULT 'USD',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Course catalog
CREATE TABLE IF NOT EXISTS courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  instructor TEXT NOT NULL,
  level TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  thumbnail TEXT NOT NULL,
  modules JSONB NOT NULL DEFAULT '[]'::jsonb,
  sync_sessions TEXT[] DEFAULT ARRAY[]::TEXT[],
  duration NUMERIC(10,1),
  pre_course_test JSONB,
  post_course_test JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS blog_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  content TEXT NOT NULL,
  author TEXT NOT NULL,
  image TEXT NOT NULL,
  published_on DATE NOT NULL,
  is_featured BOOLEAN DEFAULT false,
  status TEXT NOT NULL DEFAULT 'PUBLISHED'
);

-- Users and learning progress
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT,
  role TEXT NOT NULL,
  avatar TEXT,
  status TEXT,
  phone TEXT,
  join_date DATE,
  last_active TIMESTAMPTZ,
  last_login_date DATE,
  enrolled_courses UUID[] DEFAULT ARRAY[]::UUID[],
  progress INTEGER,
  plan TEXT,
  credits INTEGER DEFAULT 0,
  streak INTEGER DEFAULT 0,
  notes TEXT,
  specialization TEXT,
  bio TEXT,
  years_of_experience INTEGER,
  portfolio_url TEXT,
  social_links JSONB DEFAULT '{}'::jsonb,
  certifications TEXT[] DEFAULT ARRAY[]::TEXT[]
);

CREATE TABLE IF NOT EXISTS enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, course_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  type TEXT NOT NULL,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS course_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
  completed_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_items INTEGER NOT NULL DEFAULT 0,
  completed_count INTEGER NOT NULL DEFAULT 0,
  progress_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  last_activity TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, course_id)
);

-- Credits and gamification
CREATE TABLE IF NOT EXISTS credit_redemption_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  required_credits INTEGER NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL,
  action_type TEXT NOT NULL,
  source TEXT NOT NULL,
  reason TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  option_id UUID REFERENCES credit_redemption_options(id) ON DELETE SET NULL,
  credits_spent INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'COMPLETED',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON credit_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_redemptions_user_id ON credit_redemptions(user_id, created_at DESC);

-- Commerce and attendance
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL,
  transacted_on DATE NOT NULL,
  status TEXT NOT NULL,
  method TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  status TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  items_completed INTEGER NOT NULL DEFAULT 0,
  milestone_events INTEGER NOT NULL DEFAULT 0,
  last_active TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT attendance_records_unique UNIQUE (user_id, course_id, session_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance_records (user_id, session_date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_last_active ON attendance_records (last_active DESC);

CREATE TABLE IF NOT EXISTS certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
  issue_date DATE NOT NULL,
  certification_number TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL,
  course_level TEXT,
  url TEXT
);

CREATE TABLE IF NOT EXISTS discounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  percentage INTEGER NOT NULL,
  course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
  created_by TEXT NOT NULL,
  expiry_date DATE NOT NULL,
  usage_count INTEGER DEFAULT 0
);

-- Live class features
CREATE TABLE IF NOT EXISTS live_classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id UUID REFERENCES users(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  agenda TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  platform TEXT NOT NULL,
  provider_meeting_id TEXT,
  host_url TEXT NOT NULL,
  join_url TEXT NOT NULL,
  passcode TEXT,
  invite_type TEXT NOT NULL DEFAULT 'all',
  duration_minutes INTEGER DEFAULT 60,
  status TEXT NOT NULL DEFAULT 'SCHEDULED',
  recording_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS live_class_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  live_class_id UUID REFERENCES live_classes(id) ON DELETE CASCADE,
  student_id UUID REFERENCES users(id) ON DELETE CASCADE,
  email TEXT,
  invite_token TEXT,
  status TEXT DEFAULT 'INVITED',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Static content and career applications
CREATE TABLE IF NOT EXISTS static_pages (
  slug TEXT PRIMARY KEY,
  title TEXT,
  content TEXT,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS career_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id TEXT NOT NULL,
  job_title TEXT NOT NULL,
  applicant_name TEXT NOT NULL,
  applicant_email TEXT NOT NULL,
  applicant_phone TEXT,
  resume_url TEXT,
  cover_letter TEXT,
  job_snapshot JSONB,
  status TEXT NOT NULL DEFAULT 'SUBMITTED',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_career_applications_job ON career_applications (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_career_applications_email ON career_applications (applicant_email);

-- Config tables to support per-tenant live and payment settings
CREATE TABLE IF NOT EXISTS live_platform_config (
  id INTEGER PRIMARY KEY,
  smrrtx_enabled BOOLEAN NOT NULL DEFAULT true,
  smrrtx_permanent_room_link TEXT,
  zoom_enabled BOOLEAN NOT NULL DEFAULT false,
  zoom_config_link TEXT,
  zoom_client_id TEXT,
  zoom_client_secret TEXT,
  zoom_account_id TEXT,
  zoom_user_id TEXT,
  meet_enabled BOOLEAN NOT NULL DEFAULT false,
  meet_config_link TEXT,
  google_sa_email TEXT,
  google_sa_key TEXT,
  google_calendar_id TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO live_platform_config (
  id,
  smrrtx_enabled,
  smrrtx_permanent_room_link,
  zoom_enabled,
  zoom_config_link,
  meet_enabled,
  meet_config_link
) VALUES (1, true, NULL, false, NULL, false, NULL)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS payment_gateway_config (
  id INTEGER PRIMARY KEY,
  visa_enabled BOOLEAN NOT NULL DEFAULT false,
  visa_public_key TEXT,
  -- secret keys should be stored encrypted (pgp_sym_encrypt output)
  visa_secret_key BYTEA,
  paypal_enabled BOOLEAN NOT NULL DEFAULT false,
  paypal_client_id TEXT,
  paypal_secret_key BYTEA,
  stripe_enabled BOOLEAN NOT NULL DEFAULT false,
  stripe_public_key TEXT,
  stripe_secret_key BYTEA,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO payment_gateway_config (
  id,
  visa_enabled,
  visa_public_key,
  visa_secret_key,
  paypal_enabled,
  paypal_client_id,
  paypal_secret_key,
  stripe_enabled,
  stripe_public_key,
  stripe_secret_key,
  updated_by
) VALUES (1, false, NULL, NULL, false, NULL, NULL, false, NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- Messaging tables
CREATE TABLE IF NOT EXISTS message_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  title TEXT,
  is_muted BOOLEAN DEFAULT false,
  muted_until TIMESTAMPTZ,
  muted_reason TEXT,
  muted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES message_conversations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  can_post BOOLEAN DEFAULT true,
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES message_conversations(id) ON DELETE CASCADE,
  course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
  sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS message_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES message_conversations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  last_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  last_read_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS message_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  blocked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT,
  expires_at TIMESTAMPTZ,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  target_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES message_conversations(id) ON DELETE SET NULL,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at ON messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_receipts_conv_user ON message_receipts (conversation_id, user_id);
CREATE INDEX IF NOT EXISTS idx_message_blocks_active ON message_blocks (user_id) WHERE active = true;
