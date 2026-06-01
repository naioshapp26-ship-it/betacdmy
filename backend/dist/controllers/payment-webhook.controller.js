import { Router } from 'express';
import { ProvisioningService } from '../services/provisioning.service.js';
import { WebhookService } from '../services/webhook.service.js';
import { PaymentService } from '../services/payment.service.js';
import { SubscriptionService } from '../services/subscription.service.js';
import { InvoiceService } from '../services/invoice.service.js';
import { RefundService } from '../services/refund.service.js';
import { handleCoursePurchaseSuccess } from '../services/course-payment.service.js';
import { webhookRateLimiter } from '../middleware/rate-limiter.js';
export const createPaymentWebhookRouter = (provisioning = new ProvisioningService()) => {
    const router = Router();
    const webhookService = new WebhookService();
    const paymentService = new PaymentService();
    const subscriptionService = new SubscriptionService();
    const invoiceService = new InvoiceService();
    const refundService = new RefundService();
    /**
     * Stripe webhook endpoint - handles all Stripe events
     * Must use raw body for signature verification
     */
    router.post('/api/webhooks/payment/stripe', webhookRateLimiter, async (req, res) => {
        const signature = req.headers['stripe-signature'];
        if (!signature) {
            console.error('[Stripe Webhook] Missing stripe-signature header');
            return res.status(400).json({ error: 'Missing signature' });
        }
        let event;
        try {
            // Verify webhook signature - critical for security
            const rawBody = req.rawBody || JSON.stringify(req.body);
            event = await webhookService.verifyStripeWebhook(rawBody, signature);
            console.log(`[Stripe Webhook] Verified event: ${event.type} (${event.id})`);
        }
        catch (error) {
            console.error('[Stripe Webhook] Signature verification failed:', error.message);
            return res.status(400).json({ error: 'Invalid signature' });
        }
        try {
            // Store webhook event with idempotency check
            const { eventRecord, isDuplicate } = await webhookService.storeWebhookEvent('stripe', event.id, event.type, event);
            // If duplicate, return success immediately (idempotency)
            if (isDuplicate) {
                console.log(`[Stripe Webhook] Duplicate event ${event.id}, skipping processing`);
                return res.json({ received: true, processed: false, reason: 'duplicate' });
            }
            // Mark as processing
            await webhookService.markEventProcessing(eventRecord.id);
            // Process the webhook based on event type
            await processStripeWebhook(event, eventRecord.id);
            // Mark as completed
            await webhookService.markEventCompleted(eventRecord.id);
            res.json({ received: true, processed: true });
        }
        catch (error) {
            console.error('[Stripe Webhook] Processing failed:', error);
            // Mark as failed for retry
            const eventId = event?.id || 'unknown';
            try {
                const stored = await webhookService.getWebhookEventByExternalId('stripe', eventId);
                if (stored) {
                    await webhookService.markEventFailed(stored.id, error.message || 'Processing failed');
                }
            }
            catch (markError) {
                console.error('[Stripe Webhook] Failed to mark event as failed:', markError);
            }
            // Still return 200 to prevent Stripe from retrying immediately
            // Our retry mechanism will handle it
            res.status(200).json({ received: true, processed: false, error: error.message });
        }
    });
    /**
     * Process individual Stripe webhook events
     */
    async function processStripeWebhook(event, webhookEventId) {
        console.log(`[Stripe Webhook] Processing ${event.type}`);
        switch (event.type) {
            // Checkout session completed - subscription created
            case 'checkout.session.completed': {
                const session = event.data.object;
                await handleCheckoutCompleted(session);
                break;
            }
            // Subscription lifecycle events
            case 'customer.subscription.created':
            case 'customer.subscription.updated': {
                const subscription = event.data.object;
                await subscriptionService.handleSubscriptionUpdated(subscription);
                break;
            }
            case 'customer.subscription.deleted': {
                const subscription = event.data.object;
                await subscriptionService.handleSubscriptionDeleted(subscription);
                break;
            }
            // Invoice events
            case 'invoice.created': {
                const invoice = event.data.object;
                await invoiceService.handleInvoiceCreated(invoice);
                break;
            }
            case 'invoice.paid': {
                const invoice = event.data.object;
                await invoiceService.handleInvoicePaid(invoice);
                break;
            }
            case 'invoice.payment_failed': {
                const invoice = event.data.object;
                await invoiceService.handleInvoicePaymentFailed(invoice);
                break;
            }
            // Payment intent events
            case 'payment_intent.succeeded': {
                const paymentIntent = event.data.object;
                await handlePaymentSucceeded(paymentIntent);
                break;
            }
            case 'payment_intent.payment_failed': {
                const paymentIntent = event.data.object;
                await handlePaymentFailed(paymentIntent);
                break;
            }
            // Refund events
            case 'charge.refunded': {
                const charge = event.data.object;
                await handleChargeRefunded(charge);
                break;
            }
            default:
                console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
        }
    }
    /**
     * Handle checkout session completed
     */
    async function handleCheckoutCompleted(session) {
        const metadata = session.metadata || {};
        const tenantId = metadata.tenantId || metadata.tenant_id;
        const type = metadata.type;
        if (!tenantId) {
            console.error('[Checkout] Missing tenant_id in session metadata');
            return;
        }
        console.log(`[Checkout] Processing completed session for tenant ${tenantId}, type: ${type || 'subscription'}`);
        // Handle tenant signup payment
        if (type === 'tenant_signup') {
            console.log(`[Checkout] Processing tenant signup payment`);
            try {
                if (session.payment_status === 'paid') {
                    // Activate the tenant
                    await provisioning['central'].query(`UPDATE tenants SET status = 'active', updated_at = NOW() WHERE id = $1 AND status = 'pending_payment'`, [tenantId]);
                    console.log(`[Checkout] Tenant ${tenantId} activated successfully after payment`);
                    // Record the payment transaction
                    await paymentService.recordPaymentTransaction({
                        tenantId,
                        amount: session.amount_total ? session.amount_total / 100 : 0,
                        currency: session.currency?.toUpperCase() || 'USD',
                        status: 'succeeded',
                        paymentMethod: 'stripe',
                        stripePaymentIntentId: session.payment_intent,
                        transactionReference: session.id,
                        metadata: metadata
                    });
                }
            }
            catch (error) {
                console.error(`[Checkout] Tenant signup processing failed:`, error);
                throw error;
            }
            return;
        }
        // Handle course purchase
        if (type === 'course_purchase') {
            console.log(`[Checkout] Processing course purchase`);
            try {
                await handleCoursePurchaseSuccess(session);
                console.log(`[Checkout] Course purchase processed successfully`);
            }
            catch (error) {
                console.error(`[Checkout] Course purchase processing failed:`, error);
                throw error;
            }
            return;
        }
        // If subscription mode, the subscription will be created via subscription.created webhook
        if (session.mode === 'subscription') {
            const paymentIntentId = session.payment_intent;
            if (session.payment_status === 'paid' && paymentIntentId) {
                await paymentService.recordPaymentTransaction({
                    tenantId,
                    amount: session.amount_total ? session.amount_total / 100 : 0,
                    currency: session.currency?.toUpperCase() || 'USD',
                    status: 'succeeded',
                    paymentMethod: 'stripe',
                    transactionReference: paymentIntentId,
                    stripePaymentIntentId: paymentIntentId,
                    metadata: {
                        ...metadata,
                        checkout_session_id: session.id
                    }
                });
            }
            console.log(`[Checkout] Subscription mode - will be activated via subscription.created webhook`);
            return;
        }
        // For one-time payments, activate tenant immediately
        if (session.payment_status === 'paid') {
            console.log(`[Checkout] One-time payment successful, activating tenant ${tenantId}`);
            // Activate tenant (handled by subscription service for subscriptions)
        }
    }
    /**
     * Handle payment succeeded
     */
    async function handlePaymentSucceeded(paymentIntent) {
        console.log(`[Payment] Payment succeeded: ${paymentIntent.id}`);
        const tenantId = paymentIntent.metadata?.tenant_id;
        if (!tenantId) {
            console.log('[Payment] No tenant_id in payment metadata, skipping');
            return;
        }
        // Record payment transaction
        await paymentService.recordPaymentTransaction({
            tenantId,
            amount: paymentIntent.amount / 100, // Convert from cents
            currency: paymentIntent.currency.toUpperCase(),
            status: 'succeeded',
            paymentMethod: paymentIntent.payment_method_types[0],
            stripePaymentIntentId: paymentIntent.id,
            transactionReference: paymentIntent.id,
            metadata: paymentIntent.metadata
        });
        console.log(`[Payment] Recorded transaction for tenant ${tenantId}`);
    }
    /**
     * Handle payment failed
     */
    async function handlePaymentFailed(paymentIntent) {
        console.error(`[Payment] Payment failed: ${paymentIntent.id}`);
        const tenantId = paymentIntent.metadata?.tenant_id;
        if (!tenantId) {
            return;
        }
        // Record failed payment
        await paymentService.recordPaymentTransaction({
            tenantId,
            amount: paymentIntent.amount / 100,
            currency: paymentIntent.currency.toUpperCase(),
            status: 'failed',
            stripePaymentIntentId: paymentIntent.id,
            metadata: {
                ...paymentIntent.metadata,
                failure_code: paymentIntent.last_payment_error?.code,
                failure_message: paymentIntent.last_payment_error?.message
            }
        });
    }
    /**
     * Handle charge refunded
     */
    async function handleChargeRefunded(charge) {
        console.log(`[Refund] Charge refunded: ${charge.id}`);
        // Get the refund object from the charge
        const refunds = charge.refunds?.data || [];
        if (refunds.length === 0) {
            console.log(`[Refund] No refunds found in charge ${charge.id}`);
            return;
        }
        // Process each refund (in case of multiple partial refunds)
        for (const refund of refunds) {
            const tenantId = refund.metadata?.tenant_id;
            if (!tenantId) {
                console.log(`[Refund] No tenant_id in refund metadata: ${refund.id}`);
                continue;
            }
            try {
                // Update refund status in the database
                await refundService.updateRefundStatus(tenantId, refund.id, refund.status === 'succeeded' ? 'succeeded' : 'failed');
                console.log(`[Refund] Updated refund ${refund.id} status to ${refund.status}`);
            }
            catch (error) {
                console.error(`[Refund] Failed to update refund ${refund.id} status:`, error);
            }
        }
    }
    /**
     * PayPal webhook endpoint
     */
    router.post('/api/webhooks/payment/paypal', async (req, res) => {
        console.log('[PayPal Webhook] Received webhook');
        try {
            const paymentData = req.body || {};
            const eventType = paymentData.event_type;
            // Store webhook event
            const { eventRecord, isDuplicate } = await webhookService.storeWebhookEvent('paypal', paymentData.id || `paypal-${Date.now()}`, eventType || 'UNKNOWN', paymentData);
            if (isDuplicate) {
                console.log(`[PayPal Webhook] Duplicate event ${paymentData.id}, skipping processing`);
                return res.json({ received: true, processed: false, reason: 'duplicate' });
            }
            // Process based on event type
            if (eventType === 'CHECKOUT.ORDER.APPROVED' || eventType === 'PAYMENT.CAPTURE.COMPLETED') {
                const resource = paymentData.resource || {};
                const customId = resource.custom_id || resource.purchase_units?.[0]?.custom_id;
                if (customId) {
                    // Activate the tenant
                    await provisioning['central'].query(`UPDATE tenants SET status = 'active', activated_at = NOW() WHERE id = $1 AND status = 'pending_payment'`, [customId]);
                    console.log(`[PayPal Webhook] Tenant ${customId} activated successfully after payment`);
                    // Record payment transaction
                    const amount = parseFloat(resource.amount?.value || resource.purchase_units?.[0]?.amount?.value || '0');
                    const currency = resource.amount?.currency_code || resource.purchase_units?.[0]?.amount?.currency_code || 'USD';
                    await paymentService.recordPaymentTransaction({
                        tenantId: customId,
                        amount,
                        currency,
                        status: 'succeeded',
                        paymentMethod: 'paypal',
                        transactionReference: resource.id || paymentData.id,
                        metadata: { paypalEventType: eventType }
                    });
                }
            }
            await webhookService.markEventCompleted(eventRecord.id);
            res.json({ received: true, processed: true });
        }
        catch (error) {
            console.error('[PayPal Webhook] Processing failed:', error);
            res.status(200).json({ received: true, processed: false, error: error.message });
        }
    });
    return router;
};
