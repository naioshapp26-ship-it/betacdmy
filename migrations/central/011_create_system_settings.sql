-- Centralized system settings store for global configuration
-- Replaces scattered JSON fields with a proper key-value store

CREATE TABLE IF NOT EXISTS system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(255) UNIQUE NOT NULL, -- Setting key (e.g., 'smtp.host', 'payment.stripe.mode')
  value TEXT, -- Setting value (can be JSON string for complex values)
  value_type VARCHAR(20) NOT NULL DEFAULT 'string', -- 'string', 'number', 'boolean', 'json'
  category VARCHAR(50) NOT NULL, -- e.g., 'email', 'payment', 'security', 'features'
  description TEXT, -- Human-readable description of the setting
  is_encrypted BOOLEAN DEFAULT FALSE, -- Whether the value is encrypted (for secrets)
  is_public BOOLEAN DEFAULT FALSE, -- Whether the setting can be exposed to frontend
  validation_rules JSONB, -- JSON schema or validation rules for the value
  default_value TEXT, -- Default value if not set
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  created_by UUID, -- Admin user who created this setting
  updated_by UUID, -- Admin user who last updated this setting
  CONSTRAINT system_settings_value_type_valid 
    CHECK (value_type IN ('string', 'number', 'boolean', 'json', 'encrypted'))
);

-- Indexes for efficient querying
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_settings_key ON system_settings(key);
CREATE INDEX IF NOT EXISTS idx_system_settings_category ON system_settings(category);
CREATE INDEX IF NOT EXISTS idx_system_settings_is_public ON system_settings(is_public);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS trg_set_system_settings_updated_at ON system_settings;
CREATE TRIGGER trg_set_system_settings_updated_at
BEFORE UPDATE ON system_settings
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Seed some common settings
INSERT INTO system_settings (key, category, description, value_type, is_public, default_value)
VALUES
  ('platform.name', 'general', 'Platform name displayed across the application', 'string', TRUE, 'LMS Platform'),
  ('platform.support_email', 'general', 'Support email address for user inquiries', 'string', TRUE, 'support@example.com'),
  ('features.ai_course_generation', 'features', 'Enable AI-powered course generation', 'boolean', FALSE, 'false'),
  ('features.multi_currency', 'features', 'Enable multi-currency support', 'boolean', FALSE, 'false'),
  ('security.session_timeout_minutes', 'security', 'Session timeout in minutes', 'number', FALSE, '60'),
  ('security.max_login_attempts', 'security', 'Maximum login attempts before account lock', 'number', FALSE, '5'),
  ('email.from_address', 'email', 'Default sender email address', 'string', FALSE, 'noreply@example.com'),
  ('payment.currency', 'payment', 'Default currency for payments', 'string', TRUE, 'USD'),
  ('audit.retention_days', 'audit', 'Number of days to retain audit logs', 'number', FALSE, '365'),
  ('maintenance.mode', 'maintenance', 'Enable maintenance mode', 'boolean', TRUE, 'false'),
  ('maintenance.message', 'maintenance', 'Maintenance mode message', 'string', TRUE, 'We are currently performing maintenance. Please check back soon.')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE system_settings IS 'Centralized key-value store for system-wide configuration';
COMMENT ON COLUMN system_settings.is_encrypted IS 'If true, value should be encrypted at rest (e.g., API keys, secrets)';
COMMENT ON COLUMN system_settings.is_public IS 'If true, setting can be safely exposed to frontend/public API';
COMMENT ON COLUMN system_settings.validation_rules IS 'JSON schema or validation rules to enforce value constraints';
