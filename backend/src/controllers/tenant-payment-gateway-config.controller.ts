import { Router, Request, Response } from 'express';
import { PaymentConfigService } from '../services/payment-config.service.js';
import { requireTenantPool } from '../middleware/tenant-isolation-guard.js';
import { requireRole } from '../middleware/rbac.middleware.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { createErrorResponse } from '../utils/error-messages.js';
import { getSingleParam } from '../utils/request-params.js';

/**
 * Payment Gateway Configuration Controller for Tenant Admin
 * Manages payment gateways for tenant-specific domains (course purchases)
 */
export const createTenantPaymentGatewayConfigRouter = () => {
  const router = Router();
  const paymentConfigService = new PaymentConfigService();

  /**
   * GET /api/admin/payment-gateway/config
   * Get current payment gateway configuration for this tenant (public keys only)
   */
  router.get(
    '/config',
    requireTenantPool,
    requireAuth,
    requireRole('admin'),
    async (req: Request, res: Response) => {
      try {
        const tenantPool = (req as any).tenantPool;
        
        if (!tenantPool) {
          return res.status(400).json(createErrorResponse('errors.tenantContextRequired', req, 'Tenant context is required'));
        }

        const publicConfig = await paymentConfigService.getPublicPaymentConfig({ 
          type: 'tenant', 
          tenantPool 
        });
        
        res.json({
          success: true,
          data: publicConfig,
        });
      } catch (error: any) {
        console.error('[Tenant Admin] Get payment config failed:', error);
        res.status(500).json(createErrorResponse('errors.paymentConfigFetchFailed', req, error.message));
      }
    }
  );

  /**
   * PUT /api/admin/payment-gateway/config
   * Update payment gateway configuration for this tenant
   * Body: {
   *   stripeEnabled?: boolean,
   *   stripePublicKey?: string,
   *   stripeSecretKey?: string,
   *   stripeWebhookSecret?: string,
   *   paypalEnabled?: boolean,
   *   paypalClientId?: string,
   *   paypalSecretKey?: string,
   *   visaEnabled?: boolean,
   *   visaPublicKey?: string,
   *   visaSecretKey?: string
   * }
   */
  router.put(
    '/config',
    requireTenantPool,
    requireAuth,
    requireRole('admin'),
    async (req: Request, res: Response) => {
      try {
        const tenantPool = (req as any).tenantPool;
        
        if (!tenantPool) {
          return res.status(400).json(createErrorResponse('errors.tenantContextRequired', req, 'Tenant context is required'));
        }

        const {
          stripeEnabled,
          stripePublicKey,
          stripeSecretKey,
          stripeWebhookSecret,
          paypalEnabled,
          paypalClientId,
          paypalSecretKey,
          visaEnabled,
          visaPublicKey,
          visaSecretKey,
        } = req.body;

        // Validate at least one field is provided
        if (
          stripeEnabled === undefined &&
          !stripePublicKey &&
          !stripeSecretKey &&
          !stripeWebhookSecret &&
          paypalEnabled === undefined &&
          !paypalClientId &&
          !paypalSecretKey &&
          visaEnabled === undefined &&
          !visaPublicKey &&
          !visaSecretKey
        ) {
          return res.status(400).json(
            createErrorResponse('errors.noConfigurationProvided', req, 'At least one configuration field must be provided')
          );
        }

        // Validate Stripe configuration
        if (stripeEnabled && (!stripePublicKey && !stripeSecretKey)) {
          return res.status(400).json(
            createErrorResponse('errors.stripeKeysRequired', req, 'Stripe public and secret keys are required when enabling Stripe')
          );
        }

        // Validate PayPal configuration
        if (paypalEnabled && (!paypalClientId && !paypalSecretKey)) {
          return res.status(400).json(
            createErrorResponse('errors.paypalKeysRequired', req, 'PayPal client ID and secret key are required when enabling PayPal')
          );
        }

        const userId = (req as any).user?.id;

        await paymentConfigService.updatePaymentConfig(
          { type: 'tenant', tenantPool },
          {
            stripeEnabled,
            stripePublicKey,
            stripeSecretKey,
            stripeWebhookSecret,
            paypalEnabled,
            paypalClientId,
            paypalSecretKey,
            visaEnabled,
            visaPublicKey,
            visaSecretKey,
          },
          userId
        );

        // Return public config after update
        const publicConfig = await paymentConfigService.getPublicPaymentConfig({ 
          type: 'tenant', 
          tenantPool 
        });

        res.json({
          success: true,
          message: 'Payment gateway configuration updated successfully',
          data: publicConfig,
        });
      } catch (error: any) {
        console.error('[Tenant Admin] Update payment config failed:', error);
        res.status(500).json(createErrorResponse('errors.paymentConfigUpdateFailed', req, error.message));
      }
    }
  );

  /**
   * POST /api/admin/payment-gateway/test-stripe
   * Test Stripe configuration
   * Body: { publicKey: string, secretKey: string }
   */
  router.post(
    '/test-stripe',
    requireTenantPool,
    requireAuth,
    requireRole('admin'),
    async (req: Request, res: Response) => {
      try {
        const { publicKey, secretKey } = req.body;

        if (!publicKey || !secretKey) {
          return res.status(400).json(
            createErrorResponse('errors.stripeKeysRequired', req, 'Both public and secret keys are required')
          );
        }

        // Dynamically import Stripe to test connection
        const Stripe = (await import('stripe')).default;
        const stripe = new Stripe(secretKey, { apiVersion: '2025-12-15.clover' as any });

        // Test by retrieving account details
        const account = await stripe.accounts.retrieve();

        res.json({
          success: true,
          message: 'Stripe configuration is valid',
          data: {
            accountId: account.id,
            email: account.email,
            country: account.country,
          },
        });
      } catch (error: any) {
        console.error('[Tenant Admin] Stripe test failed:', error);
        res.status(400).json(
          createErrorResponse('errors.stripeTestFailed', req, error.message || 'Invalid Stripe credentials')
        );
      }
    }
  );

  /**
   * DELETE /api/admin/payment-gateway/config/:gateway
   * Disable a specific payment gateway for this tenant
   * Params: gateway (stripe, paypal, visa)
   */
  router.delete(
    '/config/:gateway',
    requireTenantPool,
    requireAuth,
    requireRole('admin'),
    async (req: Request, res: Response) => {
      try {
        const tenantPool = (req as any).tenantPool;
        
        if (!tenantPool) {
          return res.status(400).json(createErrorResponse('errors.tenantContextRequired', req, 'Tenant context is required'));
        }

        const gateway = getSingleParam(req.params.gateway);
        const userId = (req as any).user?.id;

        if (!gateway || !['stripe', 'paypal', 'visa'].includes(gateway)) {
          return res.status(400).json(
            createErrorResponse('errors.invalidGateway', req, 'Invalid payment gateway. Must be: stripe, paypal, or visa')
          );
        }

        const updates: any = {};
        
        if (gateway === 'stripe') {
          updates.stripeEnabled = false;
          updates.stripePublicKey = null;
          updates.stripeSecretKey = null;
          updates.stripeWebhookSecret = null;
        } else if (gateway === 'paypal') {
          updates.paypalEnabled = false;
          updates.paypalClientId = null;
          updates.paypalSecretKey = null;
        } else if (gateway === 'visa') {
          updates.visaEnabled = false;
          updates.visaPublicKey = null;
          updates.visaSecretKey = null;
        }

        await paymentConfigService.updatePaymentConfig(
          { type: 'tenant', tenantPool },
          updates,
          userId
        );

        res.json({
          success: true,
          message: `${gateway.charAt(0).toUpperCase() + gateway.slice(1)} payment gateway disabled successfully`,
        });
      } catch (error: any) {
        console.error('[Tenant Admin] Disable payment gateway failed:', error);
        res.status(500).json(createErrorResponse('errors.paymentGatewayDisableFailed', req, error.message));
      }
    }
  );

  return router;
};

