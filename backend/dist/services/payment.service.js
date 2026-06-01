import { centralPool } from '../central-db.js';
/**
 * Service for managing payment transactions
 * Handles recording and tracking of all payment-related transactions
 */
export class PaymentService {
    /**
     * Record a payment transaction
     */
    async recordPaymentTransaction(data) {
        const { tenantId, subscriptionId, amount, currency, status, paymentMethod, transactionReference, stripePaymentIntentId, metadata, } = data;
        const mergedMetadata = {
            ...(metadata || {}),
            ...(stripePaymentIntentId ? { stripe_payment_intent_id: stripePaymentIntentId } : {})
        };
        if (stripePaymentIntentId) {
            const existingByIntent = await centralPool.query(`SELECT id FROM payment_transactions WHERE metadata->>'stripe_payment_intent_id' = $1 LIMIT 1`, [stripePaymentIntentId]);
            if (existingByIntent.rows.length > 0) {
                console.log(`[PaymentService] Transaction for payment intent ${stripePaymentIntentId} already recorded`);
                return this.getTransactionById(existingByIntent.rows[0].id);
            }
        }
        // Check for duplicate transaction reference
        if (transactionReference) {
            const existing = await centralPool.query(`SELECT id FROM payment_transactions WHERE transaction_reference = $1`, [transactionReference]);
            if (existing.rows.length > 0) {
                console.log(`[PaymentService] Transaction ${transactionReference} already recorded`);
                return this.getTransactionById(existing.rows[0].id);
            }
        }
        const result = await centralPool.query(`INSERT INTO payment_transactions 
        (tenant_id, subscription_id, amount, currency, status, payment_method, 
         transaction_reference, metadata, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING *`, [
            tenantId,
            subscriptionId || null,
            amount,
            currency.toUpperCase(),
            status,
            paymentMethod || null,
            transactionReference || null,
            Object.keys(mergedMetadata).length ? JSON.stringify(mergedMetadata) : null,
        ]);
        console.log(`[PaymentService] Recorded transaction for tenant ${tenantId}: ${amount} ${currency} (${status})`);
        return this.mapRowToTransaction(result.rows[0]);
    }
    /**
     * Get transaction by ID
     */
    async getTransactionById(id) {
        const result = await centralPool.query(`SELECT * FROM payment_transactions WHERE id = $1`, [id]);
        if (result.rows.length === 0) {
            throw new Error(`Transaction ${id} not found`);
        }
        return this.mapRowToTransaction(result.rows[0]);
    }
    /**
     * Get transactions by tenant ID
     */
    async getTransactionsByTenantId(tenantId) {
        const result = await centralPool.query(`SELECT * FROM payment_transactions 
       WHERE tenant_id = $1 
       ORDER BY created_at DESC`, [tenantId]);
        return result.rows.map((row) => this.mapRowToTransaction(row));
    }
    /**
     * Get transactions by subscription ID
     */
    async getTransactionsBySubscriptionId(subscriptionId) {
        const result = await centralPool.query(`SELECT * FROM payment_transactions 
       WHERE subscription_id = $1 
       ORDER BY created_at DESC`, [subscriptionId]);
        return result.rows.map((row) => this.mapRowToTransaction(row));
    }
    /**
     * Get transaction by Stripe payment intent ID
     */
    async getTransactionByStripePaymentIntent(paymentIntentId) {
        const result = await centralPool.query(`SELECT * FROM payment_transactions 
       WHERE metadata->>'stripe_payment_intent_id' = $1`, [paymentIntentId]);
        if (result.rows.length === 0) {
            return null;
        }
        return this.mapRowToTransaction(result.rows[0]);
    }
    /**
     * Update transaction status
     */
    async updateTransactionStatus(id, status, metadata) {
        if (metadata) {
            await centralPool.query(`UPDATE payment_transactions 
         SET status = $2, metadata = $3
         WHERE id = $1`, [id, status, JSON.stringify(metadata)]);
        }
        else {
            await centralPool.query(`UPDATE payment_transactions 
         SET status = $2
         WHERE id = $1`, [id, status]);
        }
        console.log(`[PaymentService] Updated transaction ${id} status to ${status}`);
    }
    /**
     * Get total revenue by tenant
     */
    async getTenantRevenue(tenantId) {
        const result = await centralPool.query(`SELECT 
        SUM(amount) as total,
        currency
       FROM payment_transactions 
       WHERE tenant_id = $1 AND status = 'succeeded'
       GROUP BY currency
       LIMIT 1`, [tenantId]);
        if (result.rows.length === 0) {
            return { total: 0, currency: 'USD' };
        }
        return {
            total: parseFloat(result.rows[0].total) || 0,
            currency: result.rows[0].currency,
        };
    }
    /**
     * Map database row to PaymentTransaction
     */
    mapRowToTransaction(row) {
        return {
            id: row.id,
            tenant_id: row.tenant_id,
            subscription_id: row.subscription_id,
            amount: parseFloat(row.amount),
            currency: row.currency,
            status: row.status,
            payment_method: row.payment_method,
            transaction_reference: row.transaction_reference,
            stripe_payment_intent_id: row.metadata?.stripe_payment_intent_id,
            metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
            created_at: row.created_at,
        };
    }
}
