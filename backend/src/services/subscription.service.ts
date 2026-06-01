import Stripe from 'stripe';
import { centralPool } from '../central-db.js';
import { PaymentConfigService, PaymentGatewayConfig } from './payment-config.service.js';
import { PaymentService } from './payment.service.js';

const paymentConfigService = new PaymentConfigService();

export type Subscription = {
  id: string;
  tenant_id: string;
  plan: string;
  plan_id?: string;
  status: string;
  price_monthly: number;
  locked_amount: number;
  locked_currency: string;
  currency: string;
  billing_cycle: string;
  current_period_start?: Date;
  current_period_end?: Date;
  cancel_at_period_end: boolean;
  stripe_subscription_id?: string;
  stripe_customer_id?: string;
  created_at: Date;
  updated_at: Date;
};

/**
 * Service for managing tenant subscriptions
 * Handles subscription lifecycle, billing, and Stripe integration
 */
export class SubscriptionService {
  private paymentService: PaymentService;

  constructor() {
    this.paymentService = new PaymentService();
  }

  private getFrontendBaseUrl(): string {
    const raw = process.env.FRONTEND_URL || 'http://localhost:3000';
    return raw.replace(/\/+$/, '');
  }
  /**
   * Create a Stripe checkout session for subscription
   */
  async createSubscriptionCheckout(data: {
    tenantId: string;
    tenantSlug: string;
    plan: 'basic' | 'pro' | 'enterprise';
    billingCycle: 'monthly' | 'yearly';
    customerEmail: string;
  }): Promise<{ sessionId: string; checkoutUrl: string }> {
    const { tenantId, tenantSlug, plan, billingCycle, customerEmail } = data;

    // Get central payment configuration (for tenant signup/provisioning)
    const paymentConfig = await paymentConfigService.getCentralPaymentConfig();

    if (!paymentConfig.stripeEnabled || !paymentConfig.stripeSecretKey) {
      throw new Error('Stripe payment gateway is not configured. Please contact the system administrator.');
    }

    // Initialize Stripe with central secret key
    const stripe = new Stripe(paymentConfig.stripeSecretKey, {
      apiVersion: '2025-12-15.clover' as any,
    });

    // Resolve plan amount/currency from DB config
    const planPricing = this.getPlanPricing(paymentConfig, plan, billingCycle);

    const amount = planPricing.amountCents / 100;
    const orderId = `subscription_${tenantId}_${plan}_${billingCycle}`;
    const metadata: Record<string, string> = {
      tenant_id: String(tenantId),
      tenant_slug: String(tenantSlug),
      plan: String(plan),
      billing_cycle: String(billingCycle),
      amount: String(amount),
      currency: String(planPricing.currency).toUpperCase(),
      product_id: String(plan),
      product_name: `${plan.toUpperCase()} plan`,
      order_id: orderId,
      type: 'subscription',
    };

    // Create checkout session using inline price_data (no Stripe dashboard setup needed)
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      client_reference_id: orderId,
      line_items: [
        {
          price_data: {
            currency: planPricing.currency.toLowerCase(),
            unit_amount: planPricing.amountCents,
            product_data: {
              name: `${plan.toUpperCase()} plan`,
              description: `${plan} plan (${billingCycle}) subscription`,
            },
            recurring: {
              interval: billingCycle === 'yearly' ? 'year' : 'month',
            },
          },
          quantity: 1,
        },
      ],
      customer_email: customerEmail,
      metadata,
      subscription_data: {
        metadata,
      },
      success_url: `${this.getFrontendBaseUrl()}/admin/subscription-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.getFrontendBaseUrl()}/admin/subscription`,
    });

    return {
      sessionId: session.id,
      checkoutUrl: session.url || '',
    };
  }

  /**
   * Handle subscription created/updated from Stripe webhook
   */
  async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    const tenantId = subscription.metadata?.tenant_id;
    const plan = subscription.metadata?.plan as 'basic' | 'pro' | 'enterprise';

    if (!tenantId || !plan) {
      console.error('[SubscriptionService] Missing metadata in subscription:', subscription.id);
      return;
    }

    // Get plan_id from subscription_plans table
    const planResult = await centralPool.query(
      `SELECT id FROM subscription_plans WHERE code = $1`,
      [plan]
    );

    const planId = planResult.rows[0]?.id;

    const priceId = subscription.items.data[0]?.price?.id;
    const price = subscription.items.data[0]?.price;
    const amount = price?.unit_amount ? price.unit_amount / 100 : 0;
    const currency = price?.currency?.toUpperCase() || 'USD';
    const billingCycle = price?.recurring?.interval === 'year' ? 'yearly' : 'monthly';

    // Access period times safely
    const periodStart = (subscription as any).current_period_start;
    const periodEnd = (subscription as any).current_period_end;

    // Check if subscription already exists
    const existing = await centralPool.query(
      `SELECT id FROM subscriptions WHERE tenant_id = $1`,
      [tenantId]
    );

    // VALIDATION: Ensure we have pricing information
    if (amount === 0 || amount === null) {
      console.error(`[SubscriptionService] Invalid subscription amount: ${amount} for tenant ${tenantId}`);
      throw new Error('Cannot create/update subscription without valid price information');
    }

    if (!currency) {
      console.error(`[SubscriptionService] Missing currency for tenant ${tenantId}`);
      throw new Error('Cannot create/update subscription without currency information');
    }

    if (existing.rows.length > 0) {
      // Update existing subscription
      // NOTE: locked_amount should NOT change on updates (it's the price customer agreed to at signup)
      // Only update status, billing period, and stripe metadata
      await centralPool.query(
        `UPDATE subscriptions 
         SET plan = $2, 
             plan_id = $3,
             status = $4, 
             price_monthly = $5,
             currency = $6,
             billing_cycle = $7,
             current_period_start = $8,
             current_period_end = $9,
             cancel_at_period_end = $10,
             stripe_subscription_id = $11,
             updated_at = NOW()
         WHERE tenant_id = $1`,
        [
          tenantId,
          plan,
          planId,
          subscription.status,
          amount,
          currency,
          billingCycle,
          periodStart ? new Date(periodStart * 1000) : null,
          periodEnd ? new Date(periodEnd * 1000) : null,
          subscription.cancel_at_period_end,
          subscription.id,
        ]
      );

      console.log(`[SubscriptionService] Updated subscription for tenant ${tenantId} (locked pricing preserved)`);
    } else {
      // Create new subscription with locked pricing
      // CRITICAL: locked_amount = price customer agreed to at signup (source of truth for billing)
      await centralPool.query(
        `INSERT INTO subscriptions 
          (tenant_id, plan, plan_id, status, price_monthly, locked_amount, locked_currency, currency, billing_cycle,
           current_period_start, current_period_end, cancel_at_period_end, stripe_subscription_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5, $6, $6, $7, $8, $9, $10, $11, NOW(), NOW())`,
        [
          tenantId,
          plan,
          planId,
          subscription.status,
          amount,
          currency,
          billingCycle,
          periodStart ? new Date(periodStart * 1000) : null,
          periodEnd ? new Date(periodEnd * 1000) : null,
          subscription.cancel_at_period_end,
          subscription.id,
        ]
      );

      console.log(`[SubscriptionService] Created subscription for tenant ${tenantId} with locked pricing: ${amount} ${currency}`);
    }

    if (subscription.status === 'active' || subscription.status === 'trialing') {
      await this.recordInitialPaymentIfMissing(subscription, tenantId, plan, billingCycle);
    }

    // Update tenant status based on subscription status
    if (subscription.status === 'active' || subscription.status === 'trialing') {
      await this.activateTenant(tenantId);
    } else if (subscription.status === 'past_due') {
      await this.markTenantPastDue(tenantId);
    }
  }

  private async recordInitialPaymentIfMissing(
    subscription: Stripe.Subscription,
    tenantId: string,
    plan: 'basic' | 'pro' | 'enterprise',
    billingCycle: string
  ): Promise<void> {
    const latestInvoiceId = typeof subscription.latest_invoice === 'string'
      ? subscription.latest_invoice
      : subscription.latest_invoice?.id;

    if (!latestInvoiceId) {
      return;
    }

    const paymentConfig = await paymentConfigService.getCentralPaymentConfig();
    if (!paymentConfig.stripeSecretKey) {
      return;
    }

    const stripe = new Stripe(paymentConfig.stripeSecretKey, {
      apiVersion: '2025-12-15.clover' as any,
    });

    const invoice = await stripe.invoices.retrieve(latestInvoiceId);
    const paymentIntentId = typeof (invoice as any).payment_intent === 'string'
      ? (invoice as any).payment_intent
      : (invoice as any).payment_intent?.id;

    const amountPaid = (invoice.amount_paid || invoice.amount_due || 0) / 100;
    const currency = invoice.currency?.toUpperCase() || 'USD';

    const subscriptionRecordId = await this.getSubscriptionRecordId(tenantId);

    await this.paymentService.recordPaymentTransaction({
      tenantId,
      subscriptionId: subscriptionRecordId || undefined,
      amount: amountPaid,
      currency,
      status: invoice.status === 'paid' ? 'succeeded' : invoice.status || 'pending',
      paymentMethod: paymentIntentId ? 'stripe' : 'other',
      transactionReference: paymentIntentId || invoice.id,
      stripePaymentIntentId: paymentIntentId || undefined,
      metadata: {
        ...(subscription.metadata || {}),
        invoice_id: invoice.id,
        invoice_number: invoice.number,
        plan,
        billing_cycle: billingCycle
      }
    });
  }

  private async getSubscriptionRecordId(tenantId: string): Promise<string | null> {
    const result = await centralPool.query(
      `SELECT id FROM subscriptions WHERE tenant_id = $1 LIMIT 1`,
      [tenantId]
    );
    return result.rows[0]?.id || null;
  }

  /**
   * Handle subscription deleted from Stripe webhook
   */
  async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const tenantId = subscription.metadata?.tenant_id;

    if (!tenantId) {
      console.error('[SubscriptionService] Missing tenant_id in subscription:', subscription.id);
      return;
    }

    // Update subscription status
    await centralPool.query(
      `UPDATE subscriptions 
       SET status = 'cancelled', updated_at = NOW() 
       WHERE tenant_id = $1`,
      [tenantId]
    );

    // Suspend tenant
    await this.suspendTenant(tenantId);

    console.log(`[SubscriptionService] Subscription cancelled for tenant ${tenantId}`);
  }

  /**
   * Get subscription by tenant ID
   */
  async getSubscriptionByTenantId(tenantId: string): Promise<Subscription | null> {
    const result = await centralPool.query(
      `SELECT * FROM subscriptions WHERE tenant_id = $1`,
      [tenantId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToSubscription(result.rows[0]);
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(tenantId: string, cancelAtPeriodEnd: boolean = true): Promise<void> {
    const subscription = await this.getSubscriptionByTenantId(tenantId);

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    if (subscription.stripe_subscription_id) {
      // Get central payment configuration
      const paymentConfig = await paymentConfigService.getCentralPaymentConfig();

      if (!paymentConfig.stripeSecretKey) {
        throw new Error('Stripe not configured');
      }

      // Initialize Stripe with central secret key
      const stripe = new Stripe(paymentConfig.stripeSecretKey, {
        apiVersion: '2025-12-15.clover' as any,
      });

      if (cancelAtPeriodEnd) {
        await stripe.subscriptions.update(subscription.stripe_subscription_id, {
          cancel_at_period_end: true,
        });
      } else {
        await stripe.subscriptions.cancel(subscription.stripe_subscription_id);
      }
    }

    // Update in database
    if (cancelAtPeriodEnd) {
      await centralPool.query(
        `UPDATE subscriptions 
         SET cancel_at_period_end = $2, updated_at = NOW() 
         WHERE tenant_id = $1`,
        [tenantId, true]
      );
    } else {
      await centralPool.query(
        `UPDATE subscriptions 
         SET cancel_at_period_end = false, status = 'cancelled', updated_at = NOW() 
         WHERE tenant_id = $1`,
        [tenantId]
      );
    }

    console.log(`[SubscriptionService] Subscription ${cancelAtPeriodEnd ? 'cancellation scheduled' : 'cancelled'} for tenant ${tenantId}`);
  }

  /**
   * Activate tenant
   */
  private async activateTenant(tenantId: string): Promise<void> {
    await centralPool.query(
      `UPDATE tenants SET status = 'active' WHERE id = $1`,
      [tenantId]
    );
    console.log(`[SubscriptionService] Activated tenant ${tenantId}`);
  }

  /**
   * Mark tenant as past due
   */
  private async markTenantPastDue(tenantId: string): Promise<void> {
    await centralPool.query(
      `UPDATE tenants SET status = 'past_due' WHERE id = $1`,
      [tenantId]
    );
    console.log(`[SubscriptionService] Marked tenant ${tenantId} as past_due`);
  }

  /**
   * Suspend tenant
   */
  private async suspendTenant(tenantId: string): Promise<void> {
    await centralPool.query(
      `UPDATE tenants SET status = 'suspended' WHERE id = $1`,
      [tenantId]
    );
    console.log(`[SubscriptionService] Suspended tenant ${tenantId}`);
  }

  /**
   * Get Stripe price ID for plan and billing cycle
   */
  private getPlanPricing(
    paymentConfig: PaymentGatewayConfig,
    plan: 'basic' | 'pro' | 'enterprise',
    billingCycle: 'monthly' | 'yearly'
  ): { amountCents: number; currency: string } {
    const map: Record<string, Record<string, { amount: number | null; currency: string | null }>> = {
      basic: {
        monthly: { amount: paymentConfig.planBasicMonthlyAmount, currency: paymentConfig.planBasicMonthlyCurrency },
        yearly: { amount: paymentConfig.planBasicYearlyAmount, currency: paymentConfig.planBasicYearlyCurrency },
      },
      pro: {
        monthly: { amount: paymentConfig.planProMonthlyAmount, currency: paymentConfig.planProMonthlyCurrency },
        yearly: { amount: paymentConfig.planProYearlyAmount, currency: paymentConfig.planProYearlyCurrency },
      },
      enterprise: {
        monthly: { amount: paymentConfig.planEnterpriseMonthlyAmount, currency: paymentConfig.planEnterpriseMonthlyCurrency },
        yearly: { amount: paymentConfig.planEnterpriseYearlyAmount, currency: paymentConfig.planEnterpriseYearlyCurrency },
      },
    };

    const pricing = map[plan]?.[billingCycle];
    const amount = pricing?.amount ?? null;
    const currency = pricing?.currency ?? null;

    if (amount === null || amount <= 0 || !currency) {
      throw new Error(`Plan pricing not configured for ${plan} (${billingCycle}). Please set amount and currency in super admin payment settings.`);
    }

    // Stripe expects integer cents
    const amountCents = Math.round(amount * 100);

    return { amountCents, currency };
  }

  /**
   * Map database row to Subscription
   */
  private mapRowToSubscription(row: any): Subscription {
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      plan: row.plan,
      plan_id: row.plan_id,
      status: row.status,
      price_monthly: parseFloat(row.price_monthly) || 0,
      locked_amount: parseFloat(row.locked_amount) || 0,
      locked_currency: row.locked_currency || 'USD',
      currency: row.currency,
      billing_cycle: row.billing_cycle,
      current_period_start: row.current_period_start,
      current_period_end: row.current_period_end,
      cancel_at_period_end: row.cancel_at_period_end,
      stripe_subscription_id: row.stripe_subscription_id,
      stripe_customer_id: row.stripe_customer_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
