ALTER TABLE payment_gateway_config
ADD COLUMN IF NOT EXISTS plan_basic_monthly_amount INTEGER,
ADD COLUMN IF NOT EXISTS plan_basic_monthly_currency VARCHAR(10),
ADD COLUMN IF NOT EXISTS plan_basic_yearly_amount INTEGER,
ADD COLUMN IF NOT EXISTS plan_basic_yearly_currency VARCHAR(10),
ADD COLUMN IF NOT EXISTS plan_pro_monthly_amount INTEGER,
ADD COLUMN IF NOT EXISTS plan_pro_monthly_currency VARCHAR(10),
ADD COLUMN IF NOT EXISTS plan_pro_yearly_amount INTEGER,
ADD COLUMN IF NOT EXISTS plan_pro_yearly_currency VARCHAR(10),
ADD COLUMN IF NOT EXISTS plan_enterprise_monthly_amount INTEGER,
ADD COLUMN IF NOT EXISTS plan_enterprise_monthly_currency VARCHAR(10),
ADD COLUMN IF NOT EXISTS plan_enterprise_yearly_amount INTEGER,
ADD COLUMN IF NOT EXISTS plan_enterprise_yearly_currency VARCHAR(10);

-- Seed default row if missing
INSERT INTO payment_gateway_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;