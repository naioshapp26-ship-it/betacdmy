/**
 * Subscription Pricing Backfill Utility
 * 
 * This utility ensures all active tenants have subscription records with locked pricing.
 * It's designed to be safe, idempotent, and non-destructive.
 * 
 * Usage:
 *   import { backfillSubscriptions, validateSubscriptionPricing } from './utils/subscription-pricing-backfill.utils';
 *   await backfillSubscriptions();
 *   await validateSubscriptionPricing();
 */

import { centralPool } from '../central-db.js';

interface TenantWithoutSubscription {
  id: string;
  subdomain: string;
  subscription_plan: string;
  status: string;
}

interface SubscriptionValidationResult {
  total: number;
  withLockedPricing: number;
  withoutLockedPricing: number;
  issues: Array<{
    tenant_id: string;
    issue: string;
  }>;
}

/**
 * Backfill subscriptions for tenants that don't have subscription records
 * This is safe and idempotent - it only creates missing records, never updates existing ones
 */
export async function backfillSubscriptions(): Promise<{
  created: number;
  skipped: number;
  errors: number;
}> {
  const result = {
    created: 0,
    skipped: 0,
    errors: 0,
  };

  try {
    console.log('[Backfill] Starting subscription backfill...');

    // Find tenants without subscription records
    const tenantsWithoutSubs = await centralPool.query<TenantWithoutSubscription>(
      `SELECT t.id, t.subdomain, t.subscription_plan, t.status
       FROM tenants t
       LEFT JOIN subscriptions s ON t.id = s.tenant_id
       WHERE s.id IS NULL
         AND t.status IN ('active', 'trial', 'past_due')
       ORDER BY t.created_at ASC`
    );

    console.log(`[Backfill] Found ${tenantsWithoutSubs.rows.length} tenants without subscription records`);

    for (const tenant of tenantsWithoutSubs.rows) {
      try {
        // Get plan_id from subscription_plans
        const planResult = await centralPool.query(
          `SELECT id FROM subscription_plans WHERE code = $1`,
          [tenant.subscription_plan]
        );

        if (planResult.rows.length === 0) {
          console.warn(`[Backfill] No plan found for code: ${tenant.subscription_plan} (tenant: ${tenant.subdomain})`);
          result.skipped++;
          continue;
        }

        const planId = planResult.rows[0].id;

        // Get current price for the plan
        const priceResult = await centralPool.query(
          `SELECT amount, currency 
           FROM subscription_plan_prices 
           WHERE plan_id = $1 
             AND billing_cycle = 'monthly'
             AND is_active = true
             AND valid_from <= NOW()
             AND (valid_to IS NULL OR valid_to > NOW())
           ORDER BY valid_from DESC
           LIMIT 1`,
          [planId]
        );

        if (priceResult.rows.length === 0) {
          console.warn(`[Backfill] No price found for plan: ${tenant.subscription_plan} (tenant: ${tenant.subdomain})`);
          result.skipped++;
          continue;
        }

        const lockedAmount = priceResult.rows[0].amount;
        const lockedCurrency = priceResult.rows[0].currency;

        // Validate pricing
        if (!lockedAmount || lockedAmount === 0) {
          console.error(`[Backfill] Invalid price (${lockedAmount}) for tenant ${tenant.subdomain}`);
          result.errors++;
          continue;
        }

        // Create subscription record
        await centralPool.query(
          `INSERT INTO subscriptions 
            (tenant_id, plan, plan_id, status, price_monthly, locked_amount, locked_currency, 
             currency, billing_cycle, current_period_start, current_period_end, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $5, $6, $6, 'monthly', NOW(), NOW() + INTERVAL '1 month', NOW(), NOW())`,
          [tenant.id, tenant.subscription_plan, planId, tenant.status, lockedAmount, lockedCurrency]
        );

        console.log(`[Backfill] Created subscription for ${tenant.subdomain}: ${lockedAmount} ${lockedCurrency}`);
        result.created++;
      } catch (error) {
        console.error(`[Backfill] Error creating subscription for ${tenant.subdomain}:`, error);
        result.errors++;
      }
    }

    console.log(`[Backfill] Complete. Created: ${result.created}, Skipped: ${result.skipped}, Errors: ${result.errors}`);
    return result;
  } catch (error) {
    console.error('[Backfill] Fatal error during subscription backfill:', error);
    throw error;
  }
}

/**
 * Validate that all active subscriptions have locked pricing
 */
export async function validateSubscriptionPricing(): Promise<SubscriptionValidationResult> {
  const result: SubscriptionValidationResult = {
    total: 0,
    withLockedPricing: 0,
    withoutLockedPricing: 0,
    issues: [],
  };

  try {
    console.log('[Validation] Checking subscription pricing...');

    // Get all active subscriptions
    const subs = await centralPool.query(
      `SELECT 
         s.id,
         s.tenant_id,
         s.status,
         s.locked_amount,
         s.locked_currency,
         s.plan_id,
         t.subdomain
       FROM subscriptions s
       JOIN tenants t ON s.tenant_id = t.id
       WHERE s.status IN ('active', 'trialing', 'past_due')`
    );

    result.total = subs.rows.length;

    for (const sub of subs.rows) {
      // Check for locked pricing
      if (sub.locked_amount && sub.locked_currency) {
        result.withLockedPricing++;
      } else {
        result.withoutLockedPricing++;
        result.issues.push({
          tenant_id: sub.tenant_id,
          issue: `Missing locked pricing (tenant: ${sub.subdomain})`,
        });
      }

      // Check for plan_id
      if (!sub.plan_id) {
        result.issues.push({
          tenant_id: sub.tenant_id,
          issue: `Missing plan_id (tenant: ${sub.subdomain})`,
        });
      }

      // Check for zero pricing
      if (sub.locked_amount === 0) {
        result.issues.push({
          tenant_id: sub.tenant_id,
          issue: `Zero locked_amount (tenant: ${sub.subdomain})`,
        });
      }
    }

    console.log(`[Validation] Results:
      Total subscriptions: ${result.total}
      With locked pricing: ${result.withLockedPricing}
      Without locked pricing: ${result.withoutLockedPricing}
      Issues found: ${result.issues.length}`);

    if (result.issues.length > 0) {
      console.warn('[Validation] Issues found:');
      result.issues.forEach((issue) => {
        console.warn(`  - ${issue.issue}`);
      });
    }

    return result;
  } catch (error) {
    console.error('[Validation] Error during validation:', error);
    throw error;
  }
}

/**
 * Get subscription pricing summary for a tenant
 */
export async function getSubscriptionPricingSummary(tenantId: string): Promise<{
  tenant: any;
  subscription: any;
  plan: any;
  currentPrice: any;
  isLocked: boolean;
  pricingSource: 'locked' | 'legacy' | 'missing';
}> {
  try {
    // Get tenant info
    const tenantResult = await centralPool.query(
      `SELECT id, subdomain, subscription_plan, status FROM tenants WHERE id = $1`,
      [tenantId]
    );

    if (tenantResult.rows.length === 0) {
      throw new Error(`Tenant ${tenantId} not found`);
    }

    const tenant = tenantResult.rows[0];

    // Get subscription
    const subResult = await centralPool.query(
      `SELECT * FROM subscriptions WHERE tenant_id = $1`,
      [tenantId]
    );

    const subscription = subResult.rows[0] || null;

    // Get plan
    const planResult = await centralPool.query(
      `SELECT * FROM subscription_plans WHERE code = $1`,
      [tenant.subscription_plan]
    );

    const plan = planResult.rows[0] || null;

    // Get current price
    const priceResult = plan
      ? await centralPool.query(
          `SELECT * 
           FROM subscription_plan_prices 
           WHERE plan_id = $1 
             AND billing_cycle = 'monthly'
             AND is_active = true
             AND valid_from <= NOW()
             AND (valid_to IS NULL OR valid_to > NOW())
           ORDER BY valid_from DESC
           LIMIT 1`,
          [plan.id]
        )
      : { rows: [] };

    const currentPrice = priceResult.rows[0] || null;

    // Determine pricing source
    let pricingSource: 'locked' | 'legacy' | 'missing' = 'missing';
    let isLocked = false;

    if (subscription?.locked_amount && subscription?.locked_currency) {
      pricingSource = 'locked';
      isLocked = true;
    } else if (subscription?.price_monthly) {
      pricingSource = 'legacy';
      isLocked = false;
    }

    return {
      tenant,
      subscription,
      plan,
      currentPrice,
      isLocked,
      pricingSource,
    };
  } catch (error) {
    console.error(`[Summary] Error getting pricing summary for tenant ${tenantId}:`, error);
    throw error;
  }
}
