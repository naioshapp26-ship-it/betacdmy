-- Create subscription_plans table as the central source of truth for plans
CREATE TABLE IF NOT EXISTS subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_plans_code ON subscription_plans(code);
CREATE INDEX IF NOT EXISTS idx_subscription_plans_is_active ON subscription_plans(is_active);

DROP TRIGGER IF EXISTS trg_set_subscription_plans_updated_at ON subscription_plans;
CREATE TRIGGER trg_set_subscription_plans_updated_at
BEFORE UPDATE ON subscription_plans
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Insert default plans based on existing values
INSERT INTO subscription_plans (code, name, display_name, is_active)
VALUES
  ('basic', 'Basic Plan', 'Basic', true),
  ('pro', 'Professional Plan', 'Pro', true),
  ('enterprise', 'Enterprise Plan', 'Enterprise', true)
ON CONFLICT (code) DO NOTHING;
