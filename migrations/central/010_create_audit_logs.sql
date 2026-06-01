-- Central audit logging for all privileged/sensitive operations
-- Tracks who did what, when, on which tenant, with before/after state

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  user_id UUID, -- User who performed the action (may be NULL for system actions)
  user_email VARCHAR(255), -- Denormalized for audit trail
  action VARCHAR(100) NOT NULL, -- e.g., 'tenant.create', 'tenant.suspend', 'user.delete'
  resource_type VARCHAR(50) NOT NULL, -- e.g., 'tenant', 'user', 'course', 'subscription'
  resource_id VARCHAR(255), -- ID of the affected resource
  ip_address INET, -- IP address of the requester
  user_agent TEXT, -- User agent string
  status VARCHAR(20) NOT NULL DEFAULT 'success', -- 'success', 'failure', 'error'
  error_message TEXT, -- If status is failure/error
  metadata JSONB DEFAULT '{}'::jsonb, -- Additional context (permissions, reason, etc.)
  state_before JSONB, -- State before the operation
  state_after JSONB, -- State after the operation
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CONSTRAINT audit_logs_status_valid CHECK (status IN ('success', 'failure', 'error'))
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_status ON audit_logs(status);

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_action_created 
ON audit_logs(tenant_id, action, created_at DESC);

COMMENT ON TABLE audit_logs IS 'Central audit trail for all privileged and sensitive operations across the platform';
COMMENT ON COLUMN audit_logs.action IS 'Format: resource.action (e.g., tenant.create, user.delete, subscription.upgrade)';
COMMENT ON COLUMN audit_logs.state_before IS 'JSON snapshot of resource state before the operation';
COMMENT ON COLUMN audit_logs.state_after IS 'JSON snapshot of resource state after the operation';
