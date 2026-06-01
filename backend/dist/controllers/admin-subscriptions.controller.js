/**
 * Admin Subscription Management Controller
 *
 * Provides administrative endpoints for managing subscriptions,
 * including backfilling missing subscriptions and validating pricing.
 *
 * These endpoints require SUPER_ADMIN role.
 */
import { Router } from 'express';
import { requireRole } from '../middleware/rbac.middleware.js';
import { getSingleParam } from '../utils/request-params.js';
import { backfillSubscriptions, validateSubscriptionPricing, getSubscriptionPricingSummary, } from '../utils/subscription-pricing-backfill.utils.js';
const router = Router();
/**
 * POST /api/admin/subscriptions/backfill
 *
 * Backfill subscriptions for tenants without subscription records.
 * Safe and idempotent - only creates missing records.
 *
 * Requires: SUPER_ADMIN role
 */
router.post('/backfill', requireRole('super_admin'), async (req, res) => {
    try {
        console.log('[Admin] Starting subscription backfill...');
        const result = await backfillSubscriptions();
        res.json({
            success: true,
            message: 'Subscription backfill completed',
            result: {
                created: result.created,
                skipped: result.skipped,
                errors: result.errors,
            },
        });
    }
    catch (error) {
        console.error('[Admin] Subscription backfill failed:', error);
        res.status(500).json({
            success: false,
            message: 'Subscription backfill failed',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
/**
 * GET /api/admin/subscriptions/validate
 *
 * Validate that all active subscriptions have locked pricing.
 * Returns a report of any issues found.
 *
 * Requires: SUPER_ADMIN role
 */
router.get('/validate', requireRole('super_admin'), async (req, res) => {
    try {
        console.log('[Admin] Validating subscription pricing...');
        const result = await validateSubscriptionPricing();
        res.json({
            success: true,
            message: 'Subscription validation completed',
            result: {
                total: result.total,
                withLockedPricing: result.withLockedPricing,
                withoutLockedPricing: result.withoutLockedPricing,
                issues: result.issues,
            },
        });
    }
    catch (error) {
        console.error('[Admin] Subscription validation failed:', error);
        res.status(500).json({
            success: false,
            message: 'Subscription validation failed',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
/**
 * GET /api/admin/subscriptions/:tenantId/pricing-summary
 *
 * Get detailed pricing summary for a specific tenant.
 * Shows subscription details, plan info, and pricing source.
 *
 * Requires: SUPER_ADMIN role
 */
router.get('/:tenantId/pricing-summary', requireRole('super_admin'), async (req, res) => {
    try {
        const tenantId = getSingleParam(req.params.tenantId);
        if (!tenantId) {
            return res.status(400).json({
                success: false,
                message: 'Missing tenantId parameter',
            });
        }
        console.log(`[Admin] Getting pricing summary for tenant ${tenantId}...`);
        const summary = await getSubscriptionPricingSummary(tenantId);
        res.json({
            success: true,
            message: 'Pricing summary retrieved',
            summary: {
                tenant: {
                    id: summary.tenant.id,
                    subdomain: summary.tenant.subdomain,
                    subscription_plan: summary.tenant.subscription_plan,
                    status: summary.tenant.status,
                },
                subscription: summary.subscription
                    ? {
                        id: summary.subscription.id,
                        plan_id: summary.subscription.plan_id,
                        status: summary.subscription.status,
                        locked_amount: summary.subscription.locked_amount,
                        locked_currency: summary.subscription.locked_currency,
                        billing_cycle: summary.subscription.billing_cycle,
                        price_monthly: summary.subscription.price_monthly,
                        created_at: summary.subscription.created_at,
                    }
                    : null,
                plan: summary.plan
                    ? {
                        id: summary.plan.id,
                        code: summary.plan.code,
                        name: summary.plan.name,
                    }
                    : null,
                currentMarketPrice: summary.currentPrice
                    ? {
                        amount: summary.currentPrice.amount,
                        currency: summary.currentPrice.currency,
                        billing_cycle: summary.currentPrice.billing_cycle,
                    }
                    : null,
                analysis: {
                    isLocked: summary.isLocked,
                    pricingSource: summary.pricingSource,
                    hasSubscription: !!summary.subscription,
                    priceDifference: summary.subscription && summary.currentPrice
                        ? Number(summary.currentPrice.amount) - Number(summary.subscription.locked_amount)
                        : null,
                },
            },
        });
    }
    catch (error) {
        console.error('[Admin] Failed to get pricing summary:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get pricing summary',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
export default router;
