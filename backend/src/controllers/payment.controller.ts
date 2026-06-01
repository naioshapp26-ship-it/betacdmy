import { Router, Request, Response } from 'express';
import { SubscriptionService } from '../services/subscription.service.js';
import { PaymentService } from '../services/payment.service.js';
import { centralPool } from '../central-db.js';
import { getSingleParam } from '../utils/request-params.js';

export const createPaymentRouter = () => {
  const router = Router();
  const subscriptionService = new SubscriptionService();
  const paymentService = new PaymentService();

  /**
   * POST /api/payment/checkout
   * Create a Stripe checkout session for tenant subscription
   */
  router.post('/api/payment/checkout', async (req: Request, res: Response) => {
    try {
      const { tenantId, tenantSlug, plan, billingCycle, customerEmail } = req.body;

      // Validate required fields
      if (!tenantId || !tenantSlug || !plan || !billingCycle || !customerEmail) {
        return res.status(400).json({
          error: 'Missing required fields',
          required: ['tenantId', 'tenantSlug', 'plan', 'billingCycle', 'customerEmail'],
        });
      }

      // Validate plan
      if (!['basic', 'pro', 'enterprise'].includes(plan)) {
        return res.status(400).json({
          error: 'Invalid plan',
          allowedValues: ['basic', 'pro', 'enterprise'],
        });
      }

      // Validate billing cycle
      if (!['monthly', 'yearly'].includes(billingCycle)) {
        return res.status(400).json({
          error: 'Invalid billing cycle',
          allowedValues: ['monthly', 'yearly'],
        });
      }

      // Verify tenant exists
      const tenantResult = await centralPool.query(
        `SELECT id, subdomain FROM tenants WHERE id = $1`,
        [tenantId]
      );

      if (tenantResult.rows.length === 0) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      // Create checkout session
      const result = await subscriptionService.createSubscriptionCheckout({
        tenantId,
        tenantSlug,
        plan,
        billingCycle,
        customerEmail,
      });

      res.json(result);
    } catch (error: any) {
      console.error('[Payment Controller] Checkout creation failed:', error);
      res.status(500).json({ error: error.message || 'Failed to create checkout session' });
    }
  });

  /**
   * GET /api/payment/subscription/:tenantId
   * Get subscription details for a tenant
   */
  router.get('/api/payment/subscription/:tenantId', async (req: Request, res: Response) => {
    try {
      const tenantId = getSingleParam(req.params.tenantId);

      if (!tenantId) {
        return res.status(400).json({ error: 'Missing tenantId parameter' });
      }

      const subscription = await subscriptionService.getSubscriptionByTenantId(tenantId);

      if (!subscription) {
        return res.status(404).json({ error: 'Subscription not found' });
      }

      res.json(subscription);
    } catch (error: any) {
      console.error('[Payment Controller] Get subscription failed:', error);
      res.status(500).json({ error: error.message || 'Failed to get subscription' });
    }
  });

  /**
   * POST /api/payment/subscription/:tenantId/cancel
   * Cancel a subscription
   */
  router.post('/api/payment/subscription/:tenantId/cancel', async (req: Request, res: Response) => {
    try {
      const tenantId = getSingleParam(req.params.tenantId);
      const { cancelAtPeriodEnd = true } = req.body;

      if (!tenantId) {
        return res.status(400).json({ error: 'Missing tenantId parameter' });
      }

      await subscriptionService.cancelSubscription(tenantId, cancelAtPeriodEnd);

      res.json({
        success: true,
        message: cancelAtPeriodEnd
          ? 'Subscription will be cancelled at the end of the billing period'
          : 'Subscription cancelled immediately',
      });
    } catch (error: any) {
      console.error('[Payment Controller] Cancel subscription failed:', error);
      res.status(500).json({ error: error.message || 'Failed to cancel subscription' });
    }
  });

  /**
   * GET /api/payment/transactions/:tenantId
   * Get payment transactions for a tenant
   */
  router.get('/api/payment/transactions/:tenantId', async (req: Request, res: Response) => {
    try {
      const tenantId = getSingleParam(req.params.tenantId);

      if (!tenantId) {
        return res.status(400).json({ error: 'Missing tenantId parameter' });
      }

      const transactions = await paymentService.getTransactionsByTenantId(tenantId);

      res.json({
        transactions,
        total: transactions.length,
      });
    } catch (error: any) {
      console.error('[Payment Controller] Get transactions failed:', error);
      res.status(500).json({ error: error.message || 'Failed to get transactions' });
    }
  });

  /**
   * GET /api/payment/revenue/:tenantId
   * Get total revenue for a tenant
   */
  router.get('/api/payment/revenue/:tenantId', async (req: Request, res: Response) => {
    try {
      const tenantId = getSingleParam(req.params.tenantId);

      if (!tenantId) {
        return res.status(400).json({ error: 'Missing tenantId parameter' });
      }

      const revenue = await paymentService.getTenantRevenue(tenantId);

      res.json(revenue);
    } catch (error: any) {
      console.error('[Payment Controller] Get revenue failed:', error);
      res.status(500).json({ error: error.message || 'Failed to get revenue' });
    }
  });

  /**
   * GET /api/payment/health
   * Health check endpoint
   */
  router.get('/api/payment/health', async (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'payment',
      timestamp: new Date().toISOString(),
    });
  });

  return router;
};
