import Stripe from 'stripe';
import { centralPool } from '../central-db.js';
import { PaymentService } from './payment.service.js';
import { PaymentConfigService } from './payment-config.service.js';
import { emailService } from './email.service.js';
const paymentConfigService = new PaymentConfigService();
/**
 * Service for handling Stripe invoice events
 * Manages invoice lifecycle and payment tracking
 */
export class InvoiceService {
    paymentService;
    constructor() {
        this.paymentService = new PaymentService();
    }
    /**
     * Handle invoice created event
     */
    async handleInvoiceCreated(invoice) {
        // Get tenant ID from invoice or subscription metadata
        let tenantId = invoice.metadata?.tenant_id;
        if (!tenantId && invoice.subscription) {
            // Get payment config to initialize Stripe
            const paymentConfig = await paymentConfigService.getCentralPaymentConfig();
            if (!paymentConfig.stripeSecretKey) {
                throw new Error('Stripe not configured');
            }
            const stripe = new Stripe(paymentConfig.stripeSecretKey, {
                apiVersion: '2025-12-15.clover',
            });
            const subscriptionId = typeof invoice.subscription === 'string'
                ? invoice.subscription
                : invoice.subscription.id;
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            tenantId = subscription.metadata?.tenant_id;
        }
        if (!tenantId) {
            console.log('[InvoiceService] No tenant_id in invoice metadata, skipping');
            return;
        }
        console.log(`[InvoiceService] Invoice created for tenant ${tenantId}: ${invoice.id}`);
        // Get subscription ID from database
        const subscriptionId = await this.getSubscriptionId(tenantId);
        // Record pending transaction
        await this.paymentService.recordPaymentTransaction({
            tenantId,
            subscriptionId,
            amount: (invoice.amount_due || 0) / 100,
            currency: invoice.currency?.toUpperCase() || 'USD',
            status: 'pending',
            transactionReference: invoice.id,
            metadata: {
                invoice_id: invoice.id,
                invoice_number: invoice.number,
                invoice_url: invoice.hosted_invoice_url,
                due_date: invoice.due_date ? new Date(invoice.due_date * 1000).toISOString() : null,
            },
        });
    }
    /**
     * Handle invoice paid event
     */
    async handleInvoicePaid(invoice) {
        // Get tenant ID from invoice or subscription metadata
        let tenantId = invoice.metadata?.tenant_id;
        if (!tenantId && invoice.subscription) {
            // Get payment config to initialize Stripe
            const paymentConfig = await paymentConfigService.getCentralPaymentConfig();
            if (!paymentConfig.stripeSecretKey) {
                throw new Error('Stripe not configured');
            }
            const stripe = new Stripe(paymentConfig.stripeSecretKey, {
                apiVersion: '2025-12-15.clover',
            });
            const subscriptionId = typeof invoice.subscription === 'string'
                ? invoice.subscription
                : invoice.subscription.id;
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            tenantId = subscription.metadata?.tenant_id;
        }
        if (!tenantId) {
            console.log('[InvoiceService] No tenant_id in invoice metadata, skipping');
            return;
        }
        console.log(`[InvoiceService] Invoice paid for tenant ${tenantId}: ${invoice.id}`);
        // Get subscription ID from database
        const subscriptionId = await this.getSubscriptionId(tenantId);
        const paymentIntentId = typeof invoice.payment_intent === 'string'
            ? invoice.payment_intent
            : invoice.payment_intent?.id;
        if (paymentIntentId) {
            try {
                const paymentConfig = await paymentConfigService.getCentralPaymentConfig();
                if (paymentConfig.stripeSecretKey) {
                    const stripe = new Stripe(paymentConfig.stripeSecretKey, {
                        apiVersion: '2025-12-15.clover',
                    });
                    const subscriptionId = typeof invoice.subscription === 'string'
                        ? invoice.subscription
                        : invoice.subscription?.id;
                    let subscriptionMetadata = {};
                    if (subscriptionId) {
                        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
                        subscriptionMetadata = (subscription.metadata || {});
                    }
                    const mergedMetadata = {
                        ...subscriptionMetadata,
                        ...(invoice.metadata || {}),
                        ...(tenantId ? { tenant_id: tenantId } : {})
                    };
                    if (Object.keys(mergedMetadata).length) {
                        await stripe.paymentIntents.update(paymentIntentId, { metadata: mergedMetadata });
                    }
                }
            }
            catch (error) {
                console.warn('[InvoiceService] Failed to update payment intent metadata:', error.message);
            }
        }
        const transactionReference = paymentIntentId || invoice.id;
        // Record successful payment
        await this.paymentService.recordPaymentTransaction({
            tenantId,
            subscriptionId,
            amount: (invoice.amount_paid || 0) / 100,
            currency: invoice.currency?.toUpperCase() || 'USD',
            status: 'succeeded',
            paymentMethod: paymentIntentId ? 'stripe' : 'other',
            transactionReference,
            stripePaymentIntentId: paymentIntentId,
            metadata: {
                invoice_id: invoice.id,
                invoice_number: invoice.number,
                invoice_pdf: invoice.invoice_pdf,
                receipt_url: invoice.hosted_invoice_url,
                paid_at: invoice.status_transitions.paid_at ? new Date(invoice.status_transitions.paid_at * 1000).toISOString() : null,
            },
        });
        // Ensure tenant is active
        await this.activateTenant(tenantId);
    }
    /**
     * Handle invoice payment failed event
     */
    async handleInvoicePaymentFailed(invoice) {
        // Get tenant ID from invoice or subscription metadata
        let tenantId = invoice.metadata?.tenant_id;
        if (!tenantId && invoice.subscription) {
            // Get payment config to initialize Stripe
            const paymentConfig = await paymentConfigService.getCentralPaymentConfig();
            if (!paymentConfig.stripeSecretKey) {
                throw new Error('Stripe not configured');
            }
            const stripe = new Stripe(paymentConfig.stripeSecretKey, {
                apiVersion: '2025-12-15.clover',
            });
            const subscriptionId = typeof invoice.subscription === 'string'
                ? invoice.subscription
                : invoice.subscription.id;
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            tenantId = subscription.metadata?.tenant_id;
        }
        if (!tenantId) {
            console.log('[InvoiceService] No tenant_id in invoice metadata, skipping');
            return;
        }
        console.error(`[InvoiceService] Invoice payment failed for tenant ${tenantId}: ${invoice.id}`);
        // Get subscription ID from database
        const subscriptionId = await this.getSubscriptionId(tenantId);
        // Record failed payment
        await this.paymentService.recordPaymentTransaction({
            tenantId,
            subscriptionId,
            amount: (invoice.amount_due || 0) / 100,
            currency: invoice.currency?.toUpperCase() || 'USD',
            status: 'failed',
            transactionReference: invoice.id,
            metadata: {
                invoice_id: invoice.id,
                invoice_number: invoice.number,
                attempt_count: invoice.attempt_count,
                next_payment_attempt: invoice.next_payment_attempt
                    ? new Date(invoice.next_payment_attempt * 1000).toISOString()
                    : null,
            },
        });
        // Mark tenant as past due
        await this.markTenantPastDue(tenantId);
        // Send payment failure notification email
        await this.sendPaymentFailureEmail(tenantId, invoice);
    }
    /**
     * Send payment failure notification email
     */
    async sendPaymentFailureEmail(tenantId, invoice) {
        try {
            // Get tenant and admin email
            const tenantResult = await centralPool.query(`SELECT t.company_name, ta.email 
         FROM tenants t
         LEFT JOIN tenant_admins ta ON t.id = ta.tenant_id AND ta.is_primary = true
         WHERE t.id = $1
         LIMIT 1`, [tenantId]);
            if (!tenantResult.rows[0]) {
                console.warn(`[InvoiceService] No tenant or admin found for tenant ${tenantId}`);
                return;
            }
            const { company_name, email } = tenantResult.rows[0];
            if (!email) {
                console.warn(`[InvoiceService] No admin email found for tenant ${tenantId}`);
                return;
            }
            const result = await emailService.sendPaymentFailure({
                to: email,
                tenantName: company_name,
                amount: (invoice.amount_due || 0) / 100,
                currency: invoice.currency || 'usd',
                invoiceNumber: invoice.number || undefined,
                invoiceUrl: invoice.hosted_invoice_url || undefined,
                nextAttemptDate: invoice.next_payment_attempt
                    ? new Date(invoice.next_payment_attempt * 1000).toISOString()
                    : undefined,
                attemptCount: invoice.attempt_count || undefined,
            });
            if (result.sent) {
                console.log(`[InvoiceService] Payment failure email sent to ${email} (messageId: ${result.messageId})`);
            }
            else {
                console.warn(`[InvoiceService] Payment failure email not sent to ${email}: ${result.reason || result.error}`);
            }
        }
        catch (error) {
            console.error(`[InvoiceService] Error sending payment failure email:`, error);
            // Don't throw - email failure should not break invoice processing
        }
    }
    /**
     * Get subscription ID for a tenant
     */
    async getSubscriptionId(tenantId) {
        const result = await centralPool.query(`SELECT id FROM subscriptions WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
        return result.rows[0]?.id;
    }
    /**
     * Activate tenant
     */
    async activateTenant(tenantId) {
        await centralPool.query(`UPDATE tenants SET status = 'active' WHERE id = $1`, [tenantId]);
        console.log(`[InvoiceService] Activated tenant ${tenantId}`);
    }
    /**
     * Mark tenant as past due
     */
    async markTenantPastDue(tenantId) {
        await centralPool.query(`UPDATE tenants SET status = 'past_due' WHERE id = $1`, [tenantId]);
        console.log(`[InvoiceService] Marked tenant ${tenantId} as past_due`);
        // Update subscription status
        await centralPool.query(`UPDATE subscriptions SET status = 'past_due', updated_at = NOW() WHERE tenant_id = $1`, [tenantId]);
    }
}
