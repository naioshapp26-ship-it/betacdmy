import Stripe from 'stripe';
import { centralPool } from '../central-db.js';
import { PaymentConfigService } from './payment-config.service.js';
import { getTenantPool } from './db-manager.js';
const paymentConfigService = new PaymentConfigService();
/**
 * Service for handling payment provider webhooks
 * Provides webhook verification, storage, and processing status tracking
 */
export class WebhookService {
    /**
     * Verify Stripe webhook signature
     * Intelligently handles both central and tenant webhooks by detecting the tenant from metadata
     */
    async verifyStripeWebhook(rawBody, signature) {
        // Parse the raw body to extract tenant information (safe to parse, but we validate via signature)
        let tenantId = null;
        let eventType = null;
        try {
            const bodyString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
            const parsedBody = JSON.parse(bodyString);
            eventType = parsedBody?.type || null;
            // Extract tenant_id from metadata (if present in the event data)
            const eventData = parsedBody?.data?.object;
            if (eventData?.metadata?.tenant_id) {
                tenantId = eventData.metadata.tenant_id;
            }
        }
        catch (parseError) {
            console.warn('[WebhookService] Failed to pre-parse webhook body for tenant detection');
        }
        console.log(`[WebhookService] Webhook received: type=${eventType}, tenant_id=${tenantId || 'central'}`);
        // Determine which Stripe configuration to use
        // For tenant course purchases, use tenant config; otherwise use central config
        const isTenantEvent = tenantId && tenantId !== 'central';
        if (isTenantEvent) {
            // Try to verify with tenant configuration
            try {
                console.log(`[WebhookService] Attempting tenant verification for tenant: ${tenantId}`);
                // Get tenant info
                const tenantResult = await centralPool.query(`SELECT * FROM tenants WHERE id = $1 AND status = 'active'`, [tenantId]);
                if (tenantResult.rows.length === 0) {
                    console.warn(`[WebhookService] Tenant ${tenantId} not found or inactive, falling back to central verification`);
                    // Fall through to central verification
                }
                else {
                    const tenant = tenantResult.rows[0];
                    const tenantPool = await getTenantPool(tenant);
                    const tenantPaymentConfig = await paymentConfigService.getTenantPaymentConfig(tenantPool);
                    if (tenantPaymentConfig.stripeEnabled && tenantPaymentConfig.stripeSecretKey && tenantPaymentConfig.stripeWebhookSecret) {
                        console.log(`[WebhookService] Using tenant Stripe config for verification`);
                        const tenantStripe = new Stripe(tenantPaymentConfig.stripeSecretKey, {
                            apiVersion: '2025-12-15.clover',
                        });
                        const event = tenantStripe.webhooks.constructEvent(rawBody, signature, tenantPaymentConfig.stripeWebhookSecret);
                        console.log(`[WebhookService] Tenant webhook verified successfully: ${event.id}`);
                        return event;
                    }
                    else {
                        console.warn(`[WebhookService] Tenant ${tenantId} Stripe not configured, falling back to central verification`);
                    }
                }
            }
            catch (tenantError) {
                console.warn(`[WebhookService] Tenant verification failed: ${tenantError.message}, falling back to central verification`);
            }
        }
        // Use central payment configuration (default for tenant signups and central domain)
        console.log(`[WebhookService] Using central Stripe config for verification`);
        const paymentConfig = await paymentConfigService.getCentralPaymentConfig();
        if (!paymentConfig.stripeSecretKey || !paymentConfig.stripeWebhookSecret) {
            throw new Error('Stripe is not configured');
        }
        // Initialize Stripe with central secret key
        const stripe = new Stripe(paymentConfig.stripeSecretKey, {
            apiVersion: '2025-12-15.clover',
        });
        try {
            const event = stripe.webhooks.constructEvent(rawBody, signature, paymentConfig.stripeWebhookSecret);
            console.log(`[WebhookService] Central webhook verified successfully: ${event.id}`);
            return event;
        }
        catch (error) {
            console.error('[WebhookService] Central signature verification failed:', error.message);
            throw new Error(`Webhook signature verification failed: ${error.message}`);
        }
    }
    /**
     * Store webhook event with idempotency check
     * Returns the stored event and whether it was a duplicate
     */
    async storeWebhookEvent(provider, eventId, eventType, payload) {
        // Ensure webhook_events table exists
        await this.ensureWebhookEventsTable();
        // Check if event already exists (idempotency)
        const existingResult = await centralPool.query(`SELECT * FROM webhook_events WHERE provider = $1 AND event_id = $2`, [provider, eventId]);
        if (existingResult.rows.length > 0) {
            return {
                eventRecord: this.mapRowToWebhookEvent(existingResult.rows[0]),
                isDuplicate: true,
            };
        }
        // Store new event
        const result = await centralPool.query(`INSERT INTO webhook_events 
        (provider, event_id, event_type, payload, status, retry_count, created_at)
      VALUES ($1, $2, $3, $4, 'pending', 0, NOW())
      RETURNING *`, [provider, eventId, eventType, JSON.stringify(payload)]);
        return {
            eventRecord: this.mapRowToWebhookEvent(result.rows[0]),
            isDuplicate: false,
        };
    }
    /**
     * Mark webhook event as processing
     */
    async markEventProcessing(id) {
        await centralPool.query(`UPDATE webhook_events 
       SET status = 'processing', updated_at = NOW() 
       WHERE id = $1`, [id]);
    }
    /**
     * Mark webhook event as completed
     */
    async markEventCompleted(id) {
        await centralPool.query(`UPDATE webhook_events 
       SET status = 'completed', processed_at = NOW(), updated_at = NOW() 
       WHERE id = $1`, [id]);
    }
    /**
     * Mark webhook event as failed
     */
    async markEventFailed(id, errorMessage) {
        await centralPool.query(`UPDATE webhook_events 
       SET status = 'failed', 
           error_message = $2, 
           retry_count = retry_count + 1,
           updated_at = NOW() 
       WHERE id = $1`, [id, errorMessage]);
    }
    /**
     * Get webhook event by external event ID
     */
    async getWebhookEventByExternalId(provider, eventId) {
        const result = await centralPool.query(`SELECT * FROM webhook_events WHERE provider = $1 AND event_id = $2`, [provider, eventId]);
        if (result.rows.length === 0) {
            return null;
        }
        return this.mapRowToWebhookEvent(result.rows[0]);
    }
    /**
     * Get failed webhook events for retry
     */
    async getFailedEvents(maxRetries = 5) {
        const result = await centralPool.query(`SELECT * FROM webhook_events 
       WHERE status = 'failed' AND retry_count < $1 
       ORDER BY created_at ASC 
       LIMIT 100`, [maxRetries]);
        return result.rows.map((row) => this.mapRowToWebhookEvent(row));
    }
    /**
     * Retry failed webhook event
     */
    async retryFailedEvent(id) {
        await centralPool.query(`UPDATE webhook_events 
       SET status = 'pending', error_message = NULL, updated_at = NOW() 
       WHERE id = $1`, [id]);
    }
    /**
     * Ensure webhook_events table exists
     */
    async ensureWebhookEventsTable() {
        await centralPool.query(`
      CREATE TABLE IF NOT EXISTS webhook_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        provider VARCHAR(50) NOT NULL,
        event_id VARCHAR(255) NOT NULL,
        event_type VARCHAR(100) NOT NULL,
        payload JSONB NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        retry_count INTEGER DEFAULT 0,
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        processed_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT webhook_events_status_check CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_provider_event 
        ON webhook_events(provider, event_id);
      
      CREATE INDEX IF NOT EXISTS idx_webhook_events_status 
        ON webhook_events(status);
      
      CREATE INDEX IF NOT EXISTS idx_webhook_events_created 
        ON webhook_events(created_at);
    `);
    }
    /**
     * Map database row to WebhookEvent
     */
    mapRowToWebhookEvent(row) {
        return {
            id: row.id,
            provider: row.provider,
            event_id: row.event_id,
            event_type: row.event_type,
            payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
            status: row.status,
            retry_count: row.retry_count || 0,
            error_message: row.error_message,
            created_at: row.created_at,
            processed_at: row.processed_at,
        };
    }
}
