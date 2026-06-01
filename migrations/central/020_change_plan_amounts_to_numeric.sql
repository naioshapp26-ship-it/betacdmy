-- Change plan amount columns from INTEGER to NUMERIC to support decimal values
-- This allows storing prices like $29.99, $0.50, etc.

ALTER TABLE payment_gateway_config
  ALTER COLUMN plan_basic_monthly_amount TYPE NUMERIC(10,2),
  ALTER COLUMN plan_basic_yearly_amount TYPE NUMERIC(10,2),
  ALTER COLUMN plan_pro_monthly_amount TYPE NUMERIC(10,2),
  ALTER COLUMN plan_pro_yearly_amount TYPE NUMERIC(10,2),
  ALTER COLUMN plan_enterprise_monthly_amount TYPE NUMERIC(10,2),
  ALTER COLUMN plan_enterprise_yearly_amount TYPE NUMERIC(10,2);

COMMENT ON COLUMN payment_gateway_config.plan_basic_monthly_amount IS 'Basic plan monthly amount in dollars (e.g., 29.99)';
COMMENT ON COLUMN payment_gateway_config.plan_basic_yearly_amount IS 'Basic plan yearly amount in dollars (e.g., 299.99)';
COMMENT ON COLUMN payment_gateway_config.plan_pro_monthly_amount IS 'Pro plan monthly amount in dollars (e.g., 49.99)';
COMMENT ON COLUMN payment_gateway_config.plan_pro_yearly_amount IS 'Pro plan yearly amount in dollars (e.g., 499.99)';
COMMENT ON COLUMN payment_gateway_config.plan_enterprise_monthly_amount IS 'Enterprise plan monthly amount in dollars (e.g., 99.99)';
COMMENT ON COLUMN payment_gateway_config.plan_enterprise_yearly_amount IS 'Enterprise plan yearly amount in dollars (e.g., 999.99)';
