-- Configurable SMTP credentials for central domain and tenant subdomains
CREATE TABLE IF NOT EXISTS email_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope VARCHAR(20) NOT NULL,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  smtp_host VARCHAR(255) NOT NULL,
  smtp_port INTEGER NOT NULL DEFAULT 587,
  smtp_user VARCHAR(255) NOT NULL,
  smtp_pass TEXT NOT NULL,
  smtp_from VARCHAR(255) NOT NULL,
  smtp_secure BOOLEAN NOT NULL DEFAULT false,
  created_by VARCHAR(255),
  updated_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT email_settings_scope_valid CHECK (scope IN ('central', 'tenant')),
  CONSTRAINT email_settings_scope_tenant_valid CHECK (
    (scope = 'central' AND tenant_id IS NULL) OR
    (scope = 'tenant' AND tenant_id IS NOT NULL)
  ),
  CONSTRAINT email_settings_port_valid CHECK (smtp_port > 0 AND smtp_port <= 65535)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_settings_central_unique
  ON email_settings(scope)
  WHERE scope = 'central' AND tenant_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_settings_tenant_unique
  ON email_settings(tenant_id)
  WHERE scope = 'tenant';

CREATE INDEX IF NOT EXISTS idx_email_settings_tenant_id
  ON email_settings(tenant_id)
  WHERE tenant_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_set_email_settings_updated_at ON email_settings;
CREATE TRIGGER trg_set_email_settings_updated_at
BEFORE UPDATE ON email_settings
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
