import { Router } from 'express';
import { PaymentConfigService } from '../services/payment-config.service.js';
import { requireRole } from '../middleware/rbac.middleware.js';
import { createErrorResponse } from '../utils/error-messages.js';
import { getSingleParam } from '../utils/request-params.js';
/**
 * Payment Gateway Configuration Controller for Super Admin
 * Manages payment gateways for the main domain (tenant signup/provisioning)
 */
export const createPaymentGatewayConfigRouter = () => {
    const router = Router();
    const paymentConfigService = new PaymentConfigService();
    /**
     * GET /api/super-admin/payment-gateway/config
     * Get current payment gateway configuration (public keys only)
     */
    router.get('/api/super-admin/payment-gateway/config', requireRole('super_admin'), async (req, res) => {
        try {
            const publicConfig = await paymentConfigService.getPublicPaymentConfig({ type: 'central' });
            res.json({
                success: true,
                data: publicConfig,
            });
        }
        catch (error) {
            console.error('[Super Admin] Get payment config failed:', error);
            res.status(500).json(createErrorResponse('errors.paymentConfigFetchFailed', req, error.message));
        }
    });
    /**
     * PUT /api/super-admin/payment-gateway/config
     * Update payment gateway configuration
     * Body: {
     *   stripeEnabled?: boolean,
     *   stripePublicKey?: string,
     *   stripeSecretKey?: string,
     *   stripeWebhookSecret?: string,
    *   stripePriceBasicMonthly?: string,
    *   stripePriceBasicYearly?: string,
    *   stripePriceProMonthly?: string,
    *   stripePriceProYearly?: string,
    *   stripePriceEnterpriseMonthly?: string,
    *   stripePriceEnterpriseYearly?: string,
    *   planBasicMonthlyAmount?: number,
    *   planBasicMonthlyCurrency?: string,
    *   planBasicYearlyAmount?: number,
    *   planBasicYearlyCurrency?: string,
    *   planProMonthlyAmount?: number,
    *   planProMonthlyCurrency?: string,
    *   planProYearlyAmount?: number,
    *   planProYearlyCurrency?: string,
    *   planEnterpriseMonthlyAmount?: number,
    *   planEnterpriseMonthlyCurrency?: string,
    *   planEnterpriseYearlyAmount?: number,
    *   planEnterpriseYearlyCurrency?: string,
     *   paypalEnabled?: boolean,
     *   paypalClientId?: string,
     *   paypalSecretKey?: string,
     *   visaEnabled?: boolean,
     *   visaPublicKey?: string,
     *   visaSecretKey?: string
     * }
     */
    router.put('/api/super-admin/payment-gateway/config', requireRole('super_admin'), async (req, res) => {
        try {
            const { stripeEnabled, stripePublicKey, stripeSecretKey, stripeWebhookSecret, stripePriceBasicMonthly, stripePriceBasicYearly, stripePriceProMonthly, stripePriceProYearly, stripePriceEnterpriseMonthly, stripePriceEnterpriseYearly, planBasicMonthlyAmount, planBasicMonthlyCurrency, planBasicYearlyAmount, planBasicYearlyCurrency, planProMonthlyAmount, planProMonthlyCurrency, planProYearlyAmount, planProYearlyCurrency, planEnterpriseMonthlyAmount, planEnterpriseMonthlyCurrency, planEnterpriseYearlyAmount, planEnterpriseYearlyCurrency, paypalEnabled, paypalClientId, paypalSecretKey, visaEnabled, visaPublicKey, visaSecretKey, } = req.body;
            // Validate at least one field is provided
            if (stripeEnabled === undefined &&
                !stripePublicKey &&
                !stripeSecretKey &&
                !stripeWebhookSecret &&
                paypalEnabled === undefined &&
                !paypalClientId &&
                !paypalSecretKey &&
                visaEnabled === undefined &&
                !visaPublicKey &&
                !visaSecretKey) {
                return res.status(400).json(createErrorResponse('errors.noConfigurationProvided', req, 'At least one configuration field must be provided'));
            }
            // Validate Stripe configuration
            if (stripeEnabled && (!stripePublicKey && !stripeSecretKey)) {
                return res.status(400).json(createErrorResponse('errors.stripeKeysRequired', req, 'Stripe public and secret keys are required when enabling Stripe'));
            }
            // Validate PayPal configuration
            if (paypalEnabled && (!paypalClientId && !paypalSecretKey)) {
                return res.status(400).json(createErrorResponse('errors.paypalKeysRequired', req, 'PayPal client ID and secret key are required when enabling PayPal'));
            }
            const userId = req.user?.id;
            await paymentConfigService.updatePaymentConfig({ type: 'central' }, {
                stripeEnabled,
                stripePublicKey,
                stripeSecretKey,
                stripeWebhookSecret,
                stripePriceBasicMonthly,
                stripePriceBasicYearly,
                stripePriceProMonthly,
                stripePriceProYearly,
                stripePriceEnterpriseMonthly,
                stripePriceEnterpriseYearly,
                planBasicMonthlyAmount,
                planBasicMonthlyCurrency,
                planBasicYearlyAmount,
                planBasicYearlyCurrency,
                planProMonthlyAmount,
                planProMonthlyCurrency,
                planProYearlyAmount,
                planProYearlyCurrency,
                planEnterpriseMonthlyAmount,
                planEnterpriseMonthlyCurrency,
                planEnterpriseYearlyAmount,
                planEnterpriseYearlyCurrency,
                paypalEnabled,
                paypalClientId,
                paypalSecretKey,
                visaEnabled,
                visaPublicKey,
                visaSecretKey,
            }, userId);
            // Return public config after update
            const publicConfig = await paymentConfigService.getPublicPaymentConfig({ type: 'central' });
            res.json({
                success: true,
                message: 'Payment gateway configuration updated successfully',
                data: publicConfig,
            });
        }
        catch (error) {
            console.error('[Super Admin] Update payment config failed:', error);
            res.status(500).json(createErrorResponse('errors.paymentConfigUpdateFailed', req, error.message));
        }
    });
    /**
     * POST /api/super-admin/payment-gateway/test-stripe
     * Test Stripe configuration
     * Body: { publicKey: string, secretKey: string }
     */
    router.post('/api/super-admin/payment-gateway/test-stripe', requireRole('super_admin'), async (req, res) => {
        try {
            const { publicKey, secretKey } = req.body;
            if (!publicKey || !secretKey) {
                return res.status(400).json(createErrorResponse('errors.stripeKeysRequired', req, 'Both public and secret keys are required'));
            }
            // Dynamically import Stripe to test connection
            const Stripe = (await import('stripe')).default;
            const stripe = new Stripe(secretKey, { apiVersion: '2025-12-15.clover' });
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
        }
        catch (error) {
            console.error('[Super Admin] Stripe test failed:', error);
            res.status(400).json(createErrorResponse('errors.stripeTestFailed', req, error.message || 'Invalid Stripe credentials'));
        }
    });
    /**
     * DELETE /api/super-admin/payment-gateway/config/:gateway
     * Disable a specific payment gateway
     * Params: gateway (stripe, paypal, visa)
     */
    router.delete('/api/super-admin/payment-gateway/config/:gateway', requireRole('super_admin'), async (req, res) => {
        try {
            const gateway = getSingleParam(req.params.gateway);
            const userId = req.user?.id;
            if (!gateway || !['stripe', 'paypal', 'visa'].includes(gateway)) {
                return res.status(400).json(createErrorResponse('errors.invalidGateway', req, 'Invalid payment gateway. Must be: stripe, paypal, or visa'));
            }
            const updates = {};
            if (gateway === 'stripe') {
                updates.stripeEnabled = false;
                updates.stripePublicKey = null;
                updates.stripeSecretKey = null;
                updates.stripeWebhookSecret = null;
            }
            else if (gateway === 'paypal') {
                updates.paypalEnabled = false;
                updates.paypalClientId = null;
                updates.paypalSecretKey = null;
            }
            else if (gateway === 'visa') {
                updates.visaEnabled = false;
                updates.visaPublicKey = null;
                updates.visaSecretKey = null;
            }
            await paymentConfigService.updatePaymentConfig({ type: 'central' }, updates, userId);
            res.json({
                success: true,
                message: `${gateway.charAt(0).toUpperCase() + gateway.slice(1)} payment gateway disabled successfully`,
            });
        }
        catch (error) {
            console.error('[Super Admin] Disable payment gateway failed:', error);
            res.status(500).json(createErrorResponse('errors.paymentGatewayDisableFailed', req, error.message));
        }
    });
    return router;
};
