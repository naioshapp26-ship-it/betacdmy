import { Router } from 'express';
import { ProvisioningService } from '../services/provisioning.service.js';
import { isValidSubdomain } from '../utils/subdomain-validator.js';
import { createErrorResponse } from '../utils/error-messages.js';
import { provisioningRateLimiter } from '../middleware/rate-limiter.js';
import { requireTenantPool, auditLog } from '../middleware/tenant-isolation-guard.js';
import { quotaService } from '../services/quota.service.js';
import { PaymentConfigService } from '../services/payment-config.service.js';
import { TenantSignupPaymentService } from '../services/tenant-signup-payment.service.js';
import { SubscriptionService } from '../services/subscription.service.js';

export const createTenantRouter = (provisioning = new ProvisioningService()) => {
  const router = Router();
  const paymentConfigService = new PaymentConfigService();
  const tenantSignupPaymentService = new TenantSignupPaymentService();
  const subscriptionService = new SubscriptionService();

  router.get('/api/public/payment-config', async (req, res) => {
    try {
      const publicConfig = await paymentConfigService.getPublicPaymentConfig({ type: 'central' });
      return res.json({ success: true, data: publicConfig });
    } catch (error) {
      console.error('Public payment config fetch failed', error);
      return res
        .status(500)
        .json(createErrorResponse('errors.paymentConfigFetchFailed', req, 'Failed to load payment configuration'));
    }
  });

  /**
   * GET /api/payment/gateways
   * Get available payment gateways for tenant signup
   */
  router.get('/api/payment/gateways', async (req, res) => {
    try {
      console.log('[TenantController] Fetching payment gateways...');
      const gateways = await tenantSignupPaymentService.getAvailableGateways();
      console.log('[TenantController] Gateways fetched:', gateways);
      return res.json({ success: true, gateways });
    } catch (error: any) {
      console.error('[TenantController] Failed to fetch payment gateways:', error);
      return res.status(500).json(createErrorResponse('errors.paymentConfigFetchFailed', req, error.message || 'Failed to load payment gateways'));
    }
  });

  /**
   * POST /api/payment/tenant-signup/checkout
   * Create checkout session for tenant signup payment
   */
  router.post('/api/payment/tenant-signup/checkout', async (req, res) => {
    try {
      const { tenantId, gateway, plan, billingCycle = 'monthly', customerEmail, subdomain } = req.body;

      // Validate required fields
      if (!tenantId || !gateway || !plan || !customerEmail || !subdomain) {
        return res.status(400).json(
          createErrorResponse('errors.validationRequired', req, 'Missing required fields: tenantId, gateway, plan, customerEmail, subdomain')
        );
      }

      // Validate gateway
      if (!['stripe', 'paypal'].includes(gateway)) {
        return res.status(400).json(
          createErrorResponse('errors.invalidGateway', req, 'Invalid payment gateway. Must be stripe or paypal')
        );
      }

      // Validate plan
      if (!['basic', 'pro', 'enterprise'].includes(plan)) {
        return res.status(400).json(
          createErrorResponse('errors.validationRequired', req, 'Invalid plan. Must be basic, pro, or enterprise')
        );
      }

      // Validate billing cycle
      if (!['monthly', 'yearly'].includes(billingCycle)) {
        return res.status(400).json(
          createErrorResponse('errors.validationRequired', req, 'Invalid billing cycle. Must be monthly or yearly')
        );
      }

      // Verify tenant exists and is in pending_payment status
      const tenantResult = await provisioning['central'].query(
        `SELECT id, subdomain, status FROM tenants WHERE id = $1`,
        [tenantId]
      );

      if (tenantResult.rows.length === 0) {
        return res.status(404).json(createErrorResponse('errors.tenantNotFound', req, 'Tenant not found'));
      }

      const tenant = tenantResult.rows[0];
      
      if (tenant.status !== 'pending_payment' && tenant.status !== 'active') {
        return res.status(400).json(
          createErrorResponse('errors.validationRequired', req, `Tenant status must be pending_payment or active, current status: ${tenant.status}`)
        );
      }

      // Create checkout session
      const checkoutResponse = await tenantSignupPaymentService.createCheckoutSession({
        tenantId,
        gateway,
        plan,
        billingCycle,
        customerEmail,
        subdomain,
      });

      return res.json({
        success: true,
        ...checkoutResponse,
      });
    } catch (error: any) {
      console.error('Tenant signup checkout failed', error);
      return res.status(500).json(
        createErrorResponse('errors.paymentFailed', req, error.message || 'Failed to create checkout session')
      );
    }
  });

  /**
   * POST /api/payment/tenant-signup/confirm
   * Confirm Stripe checkout session for tenant signup (fallback)
   */
  router.post('/api/payment/tenant-signup/confirm', async (req, res) => {
    try {
      const { tenantId, sessionId } = req.body || {};

      if (!tenantId || !sessionId) {
        return res.status(400).json(
          createErrorResponse('errors.validationRequired', req, 'Missing required fields: tenantId, sessionId')
        );
      }

      const result = await tenantSignupPaymentService.confirmStripeCheckoutSession({
        tenantId,
        sessionId
      });

      if (result.status !== 'paid') {
        return res.status(400).json(
          createErrorResponse('errors.paymentFailed', req, 'Payment not completed')
        );
      }

      return res.json({
        success: true,
        status: result.status,
        transactionId: result.transactionId
      });
    } catch (error: any) {
      console.error('Tenant signup payment confirmation failed', error);
      return res.status(500).json(
        createErrorResponse('errors.paymentFailed', req, error.message || 'Failed to confirm payment')
      );
    }
  });

  // Activate tenant after successful payment (fallback for webhook)
  router.post('/api/tenants/:tenantId/activate-payment', async (req, res) => {
    try {
      const { tenantId } = req.params;

      // Get tenant status
      const tenantResult = await provisioning['central'].query(
        `SELECT id, subdomain, status FROM tenants WHERE id = $1`,
        [tenantId]
      );

      if (tenantResult.rows.length === 0) {
        return res.status(404).json(createErrorResponse('errors.tenantNotFound', req, 'Tenant not found'));
      }

      const tenant = tenantResult.rows[0];

      // If already active, return success
      if (tenant.status === 'active') {
        console.log(`[Activate] Tenant ${tenantId} already active`);
        return res.json({ success: true, status: 'active', message: 'Tenant already active' });
      }

      // Only activate if currently pending_payment
      if (tenant.status === 'pending_payment') {
        await provisioning['central'].query(
          `UPDATE tenants SET status = 'active', updated_at = NOW() WHERE id = $1`,
          [tenantId]
        );
        console.log(`[Activate] Tenant ${tenantId} (${tenant.subdomain}) activated after payment success`);
        return res.json({ success: true, status: 'active', message: 'Tenant activated successfully' });
      }

      // Invalid status for activation
      return res.status(400).json(
        createErrorResponse('errors.validationRequired', req, `Cannot activate tenant with status: ${tenant.status}`)
      );
    } catch (error: any) {
      console.error('Tenant activation failed', error);
      return res.status(500).json(
        createErrorResponse('errors.apiServerError', req, error.message || 'Failed to activate tenant')
      );
    }
  });

  router.get('/api/subdomains/check', async (req, res) => {
    try {
      const candidate = ((req.query.subdomain || req.query.value || '') as string).trim().toLowerCase();
      if (!candidate) {
        return res.status(400).json(createErrorResponse('errors.tenantSubdomainRequired', req, 'Subdomain required'));
      }
      if (!isValidSubdomain(candidate)) {
        return res.status(400).json(createErrorResponse('errors.tenantInvalidSubdomain', req, 'Invalid subdomain'));
      }
      const available = await provisioning.isSubdomainAvailable(candidate);
      return res.json({ subdomain: candidate, available });
    } catch (error) {
      console.error('Subdomain availability check failed', error);
      return res.status(500).json(createErrorResponse('errors.apiServerError', req, 'Unable to verify subdomain'));
    }
  });

  router.post('/api/provisioning/start', provisioningRateLimiter, auditLog('provisioning_start'), async (req, res) => {
    try {
      const payload = req.body || {};
      const subdomain = (payload.subdomain || '').trim().toLowerCase();
      if (!subdomain || !isValidSubdomain(subdomain)) {
        return res.status(400).json(createErrorResponse('errors.tenantInvalidSubdomain', req, 'Invalid subdomain'));
      }
      if (!payload.companyName) {
        return res.status(400).json(createErrorResponse('errors.validationRequired', req, 'Company name required'));
      }
      if (!payload.admin || !payload.admin.email) {
        return res.status(400).json(createErrorResponse('errors.authEmailRequired', req, 'Admin email required'));
      }
      const tenant = await provisioning.provisioningOrchestrator({
        ...payload,
        subdomain
      });
      res.status(202).json({ tenantId: tenant.id, status: 'provisioning_started' });
    } catch (error) {
      console.error('Provisioning start failed', error);
      res.status(500).json(createErrorResponse('errors.tenantProvisioningFailed', req, 'Provisioning failed'));
    }
  });

  router.get('/api/provisioning/status/:tenantId', async (req, res) => {
    try {
      const { tenantId } = req.params;
      const tenant = await provisioning.getTenantSummary(tenantId);
      if (!tenant) {
        return res.status(404).json(createErrorResponse('errors.tenantNotFound', req, 'Tenant not found'));
      }
      const logs = await provisioning.getProvisioningLogs(tenantId);
      const state = await provisioning.getProvisioningState(tenantId);
      res.json({ tenant, logs, state });
    } catch (error) {
      console.error('Provisioning status failed', error);
      res.status(500).json(createErrorResponse('errors.apiServerError', req, 'Unable to fetch status'));
    }
  });

  router.post('/api/provisioning/resume/:tenantId', async (req, res) => {
    try {
      const { tenantId } = req.params;
      const tenant = await provisioning.resumeProvisioning(tenantId, req.body);
      res.json({ tenantId: tenant.id, status: 'resumed', message: 'Provisioning resumed successfully' });
    } catch (error) {
      console.error('Resume provisioning failed', error);
      res.status(500).json(createErrorResponse('errors.apiServerError', req, (error as Error).message));
    }
  });

  router.post('/api/provisioning/rollback/:tenantId', async (req, res) => {
    try {
      const { tenantId } = req.params;
      const { dropDatabase, reason } = req.body || {};
      await provisioning.rollbackProvisioning(tenantId, { dropDatabase, reason });
      res.json({ tenantId, status: 'rolled_back', message: 'Provisioning rolled back successfully' });
    } catch (error) {
      console.error('Rollback provisioning failed', error);
      res.status(500).json(createErrorResponse('errors.apiServerError', req, (error as Error).message));
    }
  });

  router.post('/api/admin/tenants', async (req, res) => {
    try {
      const tenant = await provisioning.createTenant(req.body || {});
      res.status(201).json(tenant);
    } catch (error) {
      console.error('Create tenant failed', error);
      res.status(500).json(createErrorResponse('errors.tenantProvisioningFailed', req, 'Failed to create tenant'));
    }
  });

  router.patch('/api/admin/tenants/:id/suspend', async (req, res) => {
    try {
      const { id } = req.params;
      await provisioning['central'].query(
        `UPDATE tenants SET status = 'suspended', suspended_at = now() WHERE id = $1`,
        [id]
      );
      res.json({ id, status: 'suspended' });
    } catch (error) {
      console.error('Suspend tenant failed', error);
      res.status(500).json(createErrorResponse('errors.apiServerError', req, 'Failed to suspend tenant'));
    }
  });

  router.patch('/api/admin/tenants/:id/reactivate', async (req, res) => {
    try {
      const { id } = req.params;
      await provisioning['central'].query(
        `UPDATE tenants SET status = 'active', suspended_at = NULL WHERE id = $1`,
        [id]
      );
      res.json({ id, status: 'active' });
    } catch (error) {
      console.error('Reactivate tenant failed', error);
      res.status(500).json(createErrorResponse('errors.apiServerError', req, 'Failed to reactivate tenant'));
    }
  });

  router.delete('/api/admin/tenants/:id', async (req, res) => {
    try {
      const { id } = req.params;
      try {
        await subscriptionService.cancelSubscription(id, false);
      } catch (error) {
        console.warn('Cancel subscription on tenant delete failed', error);
      }
      await provisioning['central'].query(
        `UPDATE tenants SET status = 'deleted', deleted_at = now() WHERE id = $1`,
        [id]
      );
      res.status(204).send();
    } catch (error) {
      console.error('Delete tenant failed', error);
      res.status(500).json(createErrorResponse('errors.apiServerError', req, 'Failed to delete tenant'));
    }
  });

  // Quota endpoints - these require tenant context
  router.get('/api/tenant/quota', requireTenantPool, async (req, res) => {
    try {
      const tenant = (req as any).tenant;
      const tenantPool = (req as any).tenantPool;
      
      if (!tenant || !tenantPool) {
        return res.status(500).json(createErrorResponse('errors.apiServerError', req, 'Tenant context missing'));
      }

      const usage = await quotaService.getQuotaUsage(tenantPool, tenant.subscription_plan);
      res.json(usage);
    } catch (error) {
      console.error('Quota check failed', error);
      res.status(500).json(createErrorResponse('errors.apiServerError', req, 'Failed to retrieve quota information'));
    }
  });

  return router;
};

