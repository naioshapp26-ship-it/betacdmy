import Stripe from 'stripe';
import { centralPool } from '../central-db.js';
import { PaymentConfigService } from './payment-config.service.js';
import crypto from 'crypto';

const paymentConfigService = new PaymentConfigService();

export interface SubscriptionRefundRequest {
  paymentTransactionId: string;
  amount?: number; // Optional for partial refund
  reason?: string;
  refundedBy: string; // Super admin ID
  refundedByName: string;
  refundedByEmail: string;
  tenantId: string;
}

export interface SubscriptionRefundResult {
  refundId: string;
  amount: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed';
  receiptNumber?: string;
  stripeRefundId?: string;
}

export interface SubscriptionRefundRecord {
  id: string;
  payment_transaction_id: string;
  tenant_id: string;
  refund_id: string;
  stripe_refund_id?: string;
  amount: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed';
  reason?: string;
  refunded_by: string;
  refunded_by_name: string;
  refunded_by_email: string;
  refunded_at: Date;
  stripe_receipt_number?: string;
  metadata?: Record<string, any>;
}

export interface PaymentTransactionDetail {
  id: string;
  tenant_id: string;
  subscription_id: string | null;
  amount: number;
  currency: string;
  status: string;
  payment_method: string | null;
  transaction_reference: string | null;
  metadata: Record<string, any> | null;
  created_at: Date;
  refunded_amount: number;
  refund_status: 'none' | 'partial' | 'full' | null;
}

/**
 * Service for handling super admin subscription payment refunds
 * Works with the central database payment_transactions table
 */
export class SuperAdminRefundService {
  /**
   * Get payment transaction details
   */
  async getPaymentTransaction(paymentId: string): Promise<PaymentTransactionDetail | null> {
    const result = await centralPool.query(
      `SELECT id, tenant_id, subscription_id, amount, currency, status, 
              payment_method, transaction_reference, metadata, created_at,
              COALESCE(refunded_amount, 0) as refunded_amount,
              COALESCE(refund_status, 'none') as refund_status
       FROM payment_transactions 
       WHERE id = $1`,
      [paymentId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      ...row,
      amount: parseFloat(row.amount),
      refunded_amount: parseFloat(row.refunded_amount)
    };
  }

  /**
   * Check if a payment can be refunded
   */
  async canRefund(paymentId: string): Promise<{
    canRefund: boolean;
    reason?: string;
    maxRefundAmount?: number;
    paymentDetails?: PaymentTransactionDetail;
  }> {
    const payment = await this.getPaymentTransaction(paymentId);

    if (!payment) {
      return { canRefund: false, reason: 'Payment not found' };
    }

    // Check if payment was successful
    if (payment.status !== 'succeeded' && payment.status !== 'completed') {
      return { canRefund: false, reason: 'Only successful payments can be refunded', paymentDetails: payment };
    }

    // Check if already fully refunded
    if (payment.refund_status === 'full') {
      return { canRefund: false, reason: 'Payment has already been fully refunded', paymentDetails: payment };
    }

    const maxRefundAmount = payment.amount - payment.refunded_amount;
    
    if (maxRefundAmount <= 0) {
      return { canRefund: false, reason: 'No remaining amount to refund', paymentDetails: payment };
    }

    // Check if Stripe payment (has transaction_reference starting with pi_ or cs_)
    const isStripePayment = payment.transaction_reference?.startsWith('pi_') || 
                           payment.transaction_reference?.startsWith('cs_') ||
                           payment.payment_method?.toLowerCase().includes('stripe');

    if (!isStripePayment) {
      return { 
        canRefund: false, 
        reason: 'Only Stripe payments can be refunded through this system',
        paymentDetails: payment 
      };
    }

    // Check payment age (Stripe allows refunds up to 90 days)
    const paymentAge = Date.now() - new Date(payment.created_at).getTime();
    const maxAge = 90 * 24 * 60 * 60 * 1000; // 90 days in milliseconds

    if (paymentAge > maxAge) {
      return { 
        canRefund: false, 
        reason: 'Payment is older than 90 days and cannot be refunded through Stripe',
        paymentDetails: payment 
      };
    }

    return {
      canRefund: true,
      maxRefundAmount,
      paymentDetails: payment
    };
  }

  /**
   * Process a refund for a subscription payment
   */
  async processRefund(request: SubscriptionRefundRequest): Promise<SubscriptionRefundResult> {
    const { 
      paymentTransactionId, 
      amount, 
      reason, 
      refundedBy, 
      refundedByName,
      refundedByEmail,
      tenantId 
    } = request;

    // Verify payment can be refunded
    const eligibility = await this.canRefund(paymentTransactionId);
    
    if (!eligibility.canRefund) {
      throw new Error(eligibility.reason || 'Payment cannot be refunded');
    }

    const payment = eligibility.paymentDetails!;
    const refundAmount = amount || eligibility.maxRefundAmount!;

    // Validate refund amount
    if (refundAmount > eligibility.maxRefundAmount!) {
      throw new Error(`Refund amount ($${refundAmount}) exceeds maximum refundable amount ($${eligibility.maxRefundAmount})`);
    }

    if (refundAmount <= 0) {
      throw new Error('Refund amount must be greater than 0');
    }

    let stripeRefundResult: Stripe.Refund | null = null;
    
    // Process Stripe refund
    try {
      // Get central payment configuration
      const paymentConfig = await paymentConfigService.getPaymentConfig({ type: 'central' });

      if (!paymentConfig.stripeEnabled || !paymentConfig.stripeSecretKey) {
        throw new Error('Stripe not configured for super admin payments');
      }

      // Initialize Stripe
      const stripe = new Stripe(paymentConfig.stripeSecretKey, {
        apiVersion: '2025-12-15.clover' as any
      });

      // Get payment intent ID from transaction reference or metadata
      let paymentIntentId = payment.transaction_reference || payment.metadata?.stripe_payment_intent_id;
      
      // If it's a checkout session, retrieve the payment intent
      if (paymentIntentId?.startsWith('cs_')) {
        try {
          const session = await stripe.checkout.sessions.retrieve(paymentIntentId);
          paymentIntentId = session.payment_intent as string;
        } catch (err) {
          console.error('[SuperAdminRefundService] Failed to retrieve checkout session:', err);
          throw new Error('Could not retrieve payment details from Stripe');
        }
      }

      if (!paymentIntentId || !paymentIntentId.startsWith('pi_')) {
        throw new Error('Invalid payment reference - cannot process Stripe refund');
      }

      // Create refund
      stripeRefundResult = await stripe.refunds.create({
        payment_intent: paymentIntentId,
        amount: Math.round(refundAmount * 100), // Convert to cents
        reason: reason === 'duplicate' ? 'duplicate' : 
                reason === 'fraudulent' ? 'fraudulent' : 
                'requested_by_customer',
        metadata: {
          tenant_id: tenantId,
          payment_transaction_id: paymentTransactionId,
          refunded_by: refundedBy,
          refunded_by_email: refundedByEmail,
          subscription_id: payment.subscription_id || undefined
        }
      });

      console.log(`[SuperAdminRefundService] Stripe refund created: ${stripeRefundResult.id}`);
    } catch (error) {
      console.error('[SuperAdminRefundService] Stripe refund failed:', error);
      throw new Error(`Stripe refund failed: ${(error as Error).message}`);
    }

    // Generate refund ID
    const refundId = `sr_${crypto.randomUUID().replace(/-/g, '')}`;

    // Record refund in database
    await centralPool.query(
      `INSERT INTO subscription_refunds (
        id, payment_transaction_id, tenant_id, refund_id, stripe_refund_id, 
        amount, currency, status, reason, refunded_by, refunded_by_name, 
        refunded_by_email, stripe_receipt_number, metadata, refunded_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())`,
      [
        crypto.randomUUID(),
        paymentTransactionId,
        tenantId,
        refundId,
        stripeRefundResult?.id || null,
        refundAmount,
        payment.currency || 'USD',
        stripeRefundResult?.status === 'succeeded' ? 'succeeded' : 'pending',
        reason || null,
        refundedBy,
        refundedByName,
        refundedByEmail,
        stripeRefundResult?.receipt_number || null,
        JSON.stringify({
          original_amount: payment.amount,
          subscription_id: payment.subscription_id,
          payment_method: payment.payment_method
        })
      ]
    );

    // Update payment_transactions with refund info
    const newRefundedAmount = payment.refunded_amount + refundAmount;
    const newRefundStatus = newRefundedAmount >= payment.amount ? 'full' : 'partial';

    await centralPool.query(
      `UPDATE payment_transactions 
       SET refunded_amount = $1, refund_status = $2
       WHERE id = $3`,
      [newRefundedAmount, newRefundStatus, paymentTransactionId]
    );

    // Log to central audit logs
    await centralPool.query(
      `INSERT INTO audit_logs (
        id, tenant_id, user_id, action, resource_type, resource_id, 
        metadata, ip_address, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        crypto.randomUUID(),
        tenantId,
        refundedBy,
        'subscription.refund',
        'payment_transaction',
        paymentTransactionId,
        JSON.stringify({
          amount: refundAmount,
          currency: payment.currency,
          reason: reason,
          stripe_refund_id: stripeRefundResult?.id,
          refunded_by_name: refundedByName,
          refunded_by_email: refundedByEmail
        }),
        null
      ]
    );

    return {
      refundId,
      amount: refundAmount,
      currency: payment.currency || 'USD',
      status: stripeRefundResult?.status === 'succeeded' ? 'succeeded' : 'pending',
      receiptNumber: stripeRefundResult?.receipt_number || undefined,
      stripeRefundId: stripeRefundResult?.id
    };
  }

  /**
   * Get refunds for a specific payment transaction
   */
  async getRefundsForPayment(paymentId: string): Promise<SubscriptionRefundRecord[]> {
    const result = await centralPool.query(
      `SELECT * FROM subscription_refunds 
       WHERE payment_transaction_id = $1 
       ORDER BY refunded_at DESC`,
      [paymentId]
    );

    return result.rows.map(row => ({
      id: row.id,
      payment_transaction_id: row.payment_transaction_id,
      tenant_id: row.tenant_id,
      refund_id: row.refund_id,
      stripe_refund_id: row.stripe_refund_id,
      amount: parseFloat(row.amount),
      currency: row.currency,
      status: row.status,
      reason: row.reason,
      refunded_by: row.refunded_by,
      refunded_by_name: row.refunded_by_name,
      refunded_by_email: row.refunded_by_email,
      refunded_at: row.refunded_at,
      stripe_receipt_number: row.stripe_receipt_number,
      metadata: row.metadata
    }));
  }

  /**
   * Get all refunds for a tenant
   */
  async getTenantRefunds(tenantId: string): Promise<SubscriptionRefundRecord[]> {
    const result = await centralPool.query(
      `SELECT sr.*, pt.amount as original_amount
       FROM subscription_refunds sr
       JOIN payment_transactions pt ON sr.payment_transaction_id = pt.id
       WHERE sr.tenant_id = $1 
       ORDER BY sr.refunded_at DESC`,
      [tenantId]
    );

    return result.rows.map(row => ({
      id: row.id,
      payment_transaction_id: row.payment_transaction_id,
      tenant_id: row.tenant_id,
      refund_id: row.refund_id,
      stripe_refund_id: row.stripe_refund_id,
      amount: parseFloat(row.amount),
      currency: row.currency,
      status: row.status,
      reason: row.reason,
      refunded_by: row.refunded_by,
      refunded_by_name: row.refunded_by_name,
      refunded_by_email: row.refunded_by_email,
      refunded_at: row.refunded_at,
      stripe_receipt_number: row.stripe_receipt_number,
      metadata: row.metadata
    }));
  }

  /**
   * Get all subscription refunds with optional filters
   */
  async getAllRefunds(options?: {
    status?: 'pending' | 'succeeded' | 'failed';
    limit?: number;
    offset?: number;
  }): Promise<{ refunds: SubscriptionRefundRecord[]; total: number }> {
    const filters: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (options?.status) {
      filters.push(`sr.status = $${paramIndex}`);
      values.push(options.status);
      paramIndex++;
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    // Get total count
    const countResult = await centralPool.query(
      `SELECT COUNT(*) as total FROM subscription_refunds sr ${whereClause}`,
      values
    );

    // Get refunds with tenant info
    const result = await centralPool.query(
      `SELECT sr.*, t.subdomain, t.company_name, pt.amount as original_amount
       FROM subscription_refunds sr
       JOIN tenants t ON sr.tenant_id = t.id
       JOIN payment_transactions pt ON sr.payment_transaction_id = pt.id
       ${whereClause}
       ORDER BY sr.refunded_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...values, limit, offset]
    );

    return {
      refunds: result.rows.map(row => ({
        id: row.id,
        payment_transaction_id: row.payment_transaction_id,
        tenant_id: row.tenant_id,
        refund_id: row.refund_id,
        stripe_refund_id: row.stripe_refund_id,
        amount: parseFloat(row.amount),
        currency: row.currency,
        status: row.status,
        reason: row.reason,
        refunded_by: row.refunded_by,
        refunded_by_name: row.refunded_by_name,
        refunded_by_email: row.refunded_by_email,
        refunded_at: row.refunded_at,
        stripe_receipt_number: row.stripe_receipt_number,
        metadata: {
          ...row.metadata,
          tenant_subdomain: row.subdomain,
          tenant_name: row.company_name,
          original_amount: parseFloat(row.original_amount)
        }
      })),
      total: parseInt(countResult.rows[0].total)
    };
  }

  /**
   * Update refund status (typically called by webhook)
   */
  async updateRefundStatus(
    stripeRefundId: string, 
    status: 'succeeded' | 'failed'
  ): Promise<void> {
    // Update subscription_refunds table
    const result = await centralPool.query(
      `UPDATE subscription_refunds 
       SET status = $1, updated_at = NOW()
       WHERE stripe_refund_id = $2
       RETURNING payment_transaction_id, amount, tenant_id`,
      [status, stripeRefundId]
    );

    if (result.rows.length === 0) {
      console.warn(`[SuperAdminRefundService] Refund not found for stripe_refund_id: ${stripeRefundId}`);
      return;
    }

    const refund = result.rows[0];

    // If refund failed, revert the refunded_amount on payment_transaction
    if (status === 'failed') {
      await centralPool.query(
        `UPDATE payment_transactions 
         SET refunded_amount = refunded_amount - $1,
             refund_status = CASE 
               WHEN refunded_amount - $1 <= 0 THEN 'none'
               ELSE 'partial'
             END
         WHERE id = $2`,
        [parseFloat(refund.amount), refund.payment_transaction_id]
      );
    }

    console.log(`[SuperAdminRefundService] Refund status updated: ${stripeRefundId} -> ${status}`);
  }
}
