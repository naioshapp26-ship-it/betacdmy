CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subdomain VARCHAR(63) UNIQUE NOT NULL,
  company_name VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  subscription_plan VARCHAR(50) NOT NULL,
  -- Encrypted connection string blob (pgp_sym_encrypt output)
  database_url_encrypted BYTEA NOT NULL,
  database_name VARCHAR(63) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  suspended_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  max_users INTEGER,
  max_courses INTEGER,
  storage_quota_gb INTEGER,
  custom_domain VARCHAR(255),
  settings JSONB DEFAULT '{}'::jsonb,
  CONSTRAINT tenants_status_valid CHECK (status IN ('active', 'suspended', 'deleted', 'pending_payment')),
  CONSTRAINT tenants_plan_valid CHECK (subscription_plan IN ('basic', 'pro', 'enterprise'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_subdomain ON tenants(subdomain);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);

DROP TRIGGER IF EXISTS trg_set_tenants_updated_at ON tenants;
CREATE TRIGGER trg_set_tenants_updated_at
BEFORE UPDATE ON tenants
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
