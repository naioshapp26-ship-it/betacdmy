CREATE TABLE IF NOT EXISTS tenant_user_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  platform_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_user_id UUID,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  UNIQUE (tenant_id, platform_user_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_user_links_tenant ON tenant_user_links(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_user_links_platform ON tenant_user_links(platform_user_id);

DROP TRIGGER IF EXISTS trg_set_tenant_user_links_updated_at ON tenant_user_links;
CREATE TRIGGER trg_set_tenant_user_links_updated_at
BEFORE UPDATE ON tenant_user_links
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
