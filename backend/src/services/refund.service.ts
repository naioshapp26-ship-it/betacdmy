import Stripe from 'stripe';
import { getTenantPool } from './db-manager.js';
import { centralPool, TenantRow } from '../central-db.js';
import { PaymentConfigService } from './payment-config.service.js';
import { AuditLogService } from './audit-log.service.js';

const paymentConfigService = new PaymentConfigService();
const auditLogService = new AuditLogService();

export interface RefundRequest {
  paymentId: string;
  amount?: number; // Optional for partial refund
  reason?: string;
  refundedBy: string; // User ID who initiated the refund
  tenantId: string;
}

export interface RefundResult {
  refundId: string;
  amount: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed';
  receiptNumber?: string;
}

export interface PaymentRefundRecord {
  id: string;
  payment_id: string;
  refund_id: string;
  stripe_refund_id?: string;
  amount: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed';
  reason?: string;
  refunded_by: string;
  refunded_by_name: string;
  refunded_at: Date;
  stripe_receipt_number?: string;
}

/**
 * Service for handling payment refunds
 */
export class RefundService {
  /**
   * Get tenant database pool
   */
  private async getTenantDatabasePool(tenantId: string) {
    // Get tenant details from central database
    const result = await centralPool.query(
      'SELECT * FROM tenants WHERE id = $1',
      [tenantId]
    );

    if (result.rows.length === 0) {
      throw new Error('Tenant not found');
    }

    const tenant: TenantRow = result.rows[0];
    return await getTenantPool(tenant);
  }

  /**
   * Process a refund for a course payment
   */
  async processRefund(request: RefundRequest): Promise<RefundResult> {
    const { paymentId, amount, reason, refundedBy, tenantId } = request;

    // Get tenant database connection
    const tenantPool = await this.getTenantDatabasePool(tenantId);

    // Get payment details
    const paymentResult = await tenantPool.query(
      `SELECT * FROM course_payments WHERE id = $1`,
      [paymentId]
    );

    if (paymentResult.rows.length === 0) {
      throw new Error('Payment not found');
    }

    const payment = paymentResult.rows[0];

    // Check if payment has already been fully refunded
    const existingRefundsResult = await tenantPool.query(
      `SELECT COALESCE(SUM(amount), 0) as total_refunded 
       FROM payment_refunds 
       WHERE payment_id = $1 AND status IN ('succeeded', 'pending')`,
      [paymentId]
    );

    const totalRefunded = parseFloat(existingRefundsResult.rows[0].total_refunded || '0');
    const paymentAmount = parseFloat(payment.amount);
    const refundAmount = amount || paymentAmount;

    if (totalRefunded + refundAmount > paymentAmount) {
      throw new Error('Refund amount exceeds remaining payment balance');
    }

    let stripeRefundResult: Stripe.Refund | null = null;
    
    // Process Stripe refund if payment was made through Stripe
    if (payment.stripe_payment_intent_id) {
      try {
        // Get payment configuration for tenant
        const paymentConfig = await paymentConfigService.getPaymentConfig({ 
          type: 'tenant',
          tenantId
        });

        if (!paymentConfig.stripeEnabled || !paymentConfig.stripeSecretKey) {
          throw new Error('Stripe not configured for this tenant');
        }

        // Initialize Stripe
        const stripe = new Stripe(paymentConfig.stripeSecretKey, {
          apiVersion: '2025-12-15.clover' as any
        });

        // Create refund
        stripeRefundResult = await stripe.refunds.create({
          payment_intent: payment.stripe_payment_intent_id,
          amount: amount ? Math.round(amount * 100) : undefined, // Convert to cents, undefined for full refund
          reason: reason === 'duplicate' ? 'duplicate' : 
                  reason === 'fraudulent' ? 'fraudulent' : 
                  'requested_by_customer',
          metadata: {
            tenant_id: tenantId,
            payment_id: paymentId,
            refunded_by: refundedBy,
            original_course_id: payment.course_id,
            original_student_id: payment.student_id
          }
        });

        console.log(`[RefundService] Stripe refund created: ${stripeRefundResult.id}`);
      } catch (error) {
        console.error('[RefundService] Stripe refund failed:', error);
        throw new Error(`Stripe refund failed: ${(error as Error).message}`);
      }
    }

    // Get refunded by user info
    const userResult = await tenantPool.query(
      `SELECT name FROM users WHERE id = $1`,
      [refundedBy]
    );

    const refundedByName = userResult.rows[0]?.name || 'Unknown User';

    // Record refund in database
    const refundId = crypto.randomUUID();
    await tenantPool.query(
      `INSERT INTO payment_refunds (
        id, payment_id, refund_id, stripe_refund_id, amount, currency,
        status, reason, refunded_by, refunded_by_name, refunded_at,
        stripe_receipt_number
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11)`,
      [
        crypto.randomUUID(),
        paymentId,
        refundId,
        stripeRefundResult?.id || null,
        refundAmount,
        payment.currency || 'USD',
        stripeRefundResult ? 'pending' : 'succeeded', // Stripe refunds start as pending
        reason || null,
        refundedBy,
        refundedByName,
        stripeRefundResult?.receipt_number || null
      ]
    );

    // Update payment status if fully refunded
    if (totalRefunded + refundAmount >= paymentAmount) {
      await tenantPool.query(
        `UPDATE course_payments SET notes = COALESCE(notes || ' | ', '') || 'FULLY REFUNDED'
         WHERE id = $1`,
        [paymentId]
      );
    }

    // Log audit event
    await auditLogService.log({
      tenantId,
      userId: refundedBy,
      action: 'payment.refund',
      resourceType: 'payment',
      resourceId: paymentId,
      metadata: {
        amount: refundAmount,
        reason: reason,
        stripe_refund_id: stripeRefundResult?.id,
        student_id: payment.student_id,
        course_id: payment.course_id
      }
    });

    return {
      refundId,
      amount: refundAmount,
      currency: payment.currency || 'USD',
      status: stripeRefundResult ? 'pending' : 'succeeded',
      receiptNumber: stripeRefundResult?.receipt_number || undefined
    };
  }

  /**
   * Get refunds for a payment
   */
  async getRefundsForPayment(tenantId: string, paymentId: string): Promise<PaymentRefundRecord[]> {
    const tenantPool = await this.getTenantDatabasePool(tenantId);

    const result = await tenantPool.query(
      `SELECT * FROM payment_refunds 
       WHERE payment_id = $1 
       ORDER BY refunded_at DESC`,
      [paymentId]
    );

    return result.rows.map(row => ({
      id: row.id,
      payment_id: row.payment_id,
      refund_id: row.refund_id,
      stripe_refund_id: row.stripe_refund_id,
      amount: parseFloat(row.amount),
      currency: row.currency,
      status: row.status,
      reason: row.reason,
      refunded_by: row.refunded_by,
      refunded_by_name: row.refunded_by_name,
      refunded_at: row.refunded_at,
      stripe_receipt_number: row.stripe_receipt_number
    }));
  }

  /**
   * Get all refunds for a tenant
   */
  async getTenantRefunds(tenantId: string): Promise<PaymentRefundRecord[]> {
    const tenantPool = await this.getTenantDatabasePool(tenantId);

    const result = await tenantPool.query(
      `SELECT * FROM payment_refunds 
       ORDER BY refunded_at DESC`
    );

    return result.rows.map(row => ({
      id: row.id,
      payment_id: row.payment_id,
      refund_id: row.refund_id,
      stripe_refund_id: row.stripe_refund_id,
      amount: parseFloat(row.amount),
      currency: row.currency,
      status: row.status,
      reason: row.reason,
      refunded_by: row.refunded_by,
      refunded_by_name: row.refunded_by_name,
      refunded_at: row.refunded_at,
      stripe_receipt_number: row.stripe_receipt_number
    }));
  }

  /**
   * Update refund status (typically called by webhook)
   */
  async updateRefundStatus(tenantId: string, stripeRefundId: string, status: 'succeeded' | 'failed'): Promise<void> {
    const tenantPool = await this.getTenantDatabasePool(tenantId);

    const result = await tenantPool.query(
      `UPDATE payment_refunds 
       SET status = $2 
       WHERE stripe_refund_id = $1
       RETURNING payment_id, amount`,
      [stripeRefundId, status]
    );

    if (result.rows.length > 0) {
      console.log(`[RefundService] Updated refund ${stripeRefundId} status to ${status}`);
      
      const { payment_id, amount } = result.rows[0];

      // If refund succeeded, check if payment is now fully refunded
      if (status === 'succeeded') {
        const paymentResult = await tenantPool.query(
          `SELECT amount FROM course_payments WHERE id = $1`,
          [payment_id]
        );

        if (paymentResult.rows.length > 0) {
          const paymentAmount = parseFloat(paymentResult.rows[0].amount);
          
          const totalRefundedResult = await tenantPool.query(
            `SELECT COALESCE(SUM(amount), 0) as total_refunded 
             FROM payment_refunds 
             WHERE payment_id = $1 AND status = 'succeeded'`,
            [payment_id]
          );

          const totalRefunded = parseFloat(totalRefundedResult.rows[0].total_refunded);

          if (totalRefunded >= paymentAmount) {
            await tenantPool.query(
              `UPDATE course_payments 
               SET notes = COALESCE(notes || ' | ', '') || 'FULLY REFUNDED'
               WHERE id = $1`,
              [payment_id]
            );
          }
        }
      }
    }
  }

  /**
   * Check if payment can be refunded
   */
  async canRefund(tenantId: string, paymentId: string): Promise<{ canRefund: boolean; reason?: string; remainingAmount: number }> {
    const tenantPool = await this.getTenantDatabasePool(tenantId);

    // Get payment details
    const paymentResult = await tenantPool.query(
      `SELECT * FROM course_payments WHERE id = $1`,
      [paymentId]
    );

    if (paymentResult.rows.length === 0) {
      return { canRefund: false, reason: 'Payment not found', remainingAmount: 0 };
    }

    const payment = paymentResult.rows[0];
    const paymentAmount = parseFloat(payment.amount);

    // Get existing refunds
    const refundsResult = await tenantPool.query(
      `SELECT COALESCE(SUM(amount), 0) as total_refunded 
       FROM payment_refunds 
       WHERE payment_id = $1 AND status IN ('succeeded', 'pending')`,
      [paymentId]
    );

    const totalRefunded = parseFloat(refundsResult.rows[0].total_refunded || '0');
    const remainingAmount = paymentAmount - totalRefunded;

    if (remainingAmount <= 0) {
      return { canRefund: false, reason: 'Payment already fully refunded', remainingAmount: 0 };
    }

    // Check if payment is too old (optional business rule - e.g., 90 days)
    const paymentDate = new Date(payment.received_at);
    const daysSincePayment = Math.floor((Date.now() - paymentDate.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysSincePayment > 365) {
      return { 
        canRefund: false, 
        reason: 'Payment is too old to refund (over 1 year)', 
        remainingAmount 
      };
    }

    return { canRefund: true, remainingAmount };
  }
}