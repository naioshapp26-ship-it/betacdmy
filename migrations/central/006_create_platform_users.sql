-- Platform users table (stored in the central/platform database).
--
-- Why this exists:
-- - The code uses a shared "platform users" table via db/pool.js (DATABASE_URL)
-- - central.tenant_user_links.platform_user_id references users(id)
--
-- On fresh installs (like cPanel), central migrations failed because the central scope
-- referenced users(id) but no central migration created the users table.

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT,
  role TEXT NOT NULL DEFAULT 'STUDENT',
  avatar TEXT,
  status TEXT DEFAULT 'active',
  phone TEXT,
  join_date DATE,
  last_active TIMESTAMPTZ,
  plan TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);
CREATE INDEX IF NOT EXISTS idx_users_last_active ON users (last_active DESC);

DROP TRIGGER IF EXISTS trg_set_users_updated_at ON users;
CREATE TRIGGER trg_set_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
