-- seed default monthly pricing for SaaS plans (idempotent)
UPDATE payment_gateway_config
SET
  plan_basic_monthly_amount = COALESCE(plan_basic_monthly_amount, 49),
  plan_basic_monthly_currency = COALESCE(plan_basic_monthly_currency, 'USD'),
  plan_pro_monthly_amount = COALESCE(plan_pro_monthly_amount, 149),
  plan_pro_monthly_currency = COALESCE(plan_pro_monthly_currency, 'USD'),
  plan_enterprise_monthly_amount = COALESCE(plan_enterprise_monthly_amount, 499),
  plan_enterprise_monthly_currency = COALESCE(plan_enterprise_monthly_currency, 'USD')
WHERE id = 1;
