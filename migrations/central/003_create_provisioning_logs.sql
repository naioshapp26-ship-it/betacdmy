-- Provisioning logs to track onboarding progress
CREATE TABLE IF NOT EXISTS provisioning_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  subdomain VARCHAR(63),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  step VARCHAR(100),
  message TEXT,
  error_details JSONB,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT provisioning_logs_status_valid CHECK (status IN ('pending', 'running', 'success', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_provisioning_logs_tenant ON provisioning_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_provisioning_logs_status ON provisioning_logs(status);
CREATE INDEX IF NOT EXISTS idx_provisioning_logs_started ON provisioning_logs(started_at DESC);

