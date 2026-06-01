import { centralPool } from '../central-db.js';
import { PaymentConfigService } from './payment-config.service.js';
import { PaymentService } from './payment.service.js';
import { SubscriptionService } from './subscription.service.js';
/**
 * Service for handling tenant signup payments
 * Works with central payment gateway configuration
 */
export class TenantSignupPaymentService {
    paymentConfigService;
    paymentService;
    subscriptionService;
    static TRIAL_PERIOD_DAYS = 14;
    getFrontendBaseUrl() {
        const raw = process.env.FRONTEND_URL || 'https://betacdmy.com.vendoworld.com';
        return raw.replace(/\/+$/, '');
    }
    getMainDomain() {
        const raw = process.env.MAIN_DOMAIN || process.env.VITE_MAIN_DOMAIN || 'betacdmy.com.vendoworld.com';
        return raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '').replace(/^www\./, '');
    }
    getProtocol() {
        const proto = (process.env.PROTOCOL || 'https').trim().toLowerCase();
        return proto === 'http' ? 'http' : 'https';
    }
    constructor() {
        this.paymentConfigService = new PaymentConfigService();
        this.paymentService = new PaymentService();
        this.subscriptionService = new SubscriptionService();
    }
    /**
     * Create a checkout session for tenant signup
     */
    async createCheckoutSession(request) {
        const { gateway, tenantId, plan, billingCycle, customerEmail, subdomain } = request;
        // Get central payment configuration
        const config = await this.paymentConfigService.getCentralPaymentConfig();
        // Validate gateway is enabled
        if (gateway === 'stripe' && !config.stripeEnabled) {
            throw new Error('Stripe payment gateway is not configured');
        }
        if (gateway === 'paypal' && !config.paypalEnabled) {
            throw new Error('PayPal payment gateway is not configured');
        }
        // Get pricing based on plan and billing cycle
        const amount = this.getPlanAmount(config, plan, billingCycle);
        const currency = this.getPlanCurrency(config, plan, billingCycle);
        if (!amount || !currency) {
            throw new Error(`Pricing not configured for plan: ${plan} (${billingCycle})`);
        }
        // Route to appropriate payment gateway
        if (gateway === 'stripe') {
            return await this.createStripeCheckout({
                tenantId,
                plan,
                billingCycle,
                customerEmail,
                amount,
                currency,
                subdomain,
                config,
            });
        }
        else if (gateway === 'paypal') {
            throw new Error('PayPal recurring subscriptions are not configured. Please use Stripe for tenant signup subscriptions.');
        }
        throw new Error(`Unsupported payment gateway: ${gateway}`);
    }
    /**
     * Confirm Stripe checkout session (fallback if webhook did not fire)
     */
    async confirmStripeCheckoutSession(params) {
        const { tenantId, sessionId } = params;
        if (!tenantId || !sessionId) {
            throw new Error('Missing tenantId or sessionId');
        }
        const config = await this.paymentConfigService.getCentralPaymentConfig();
        if (!config.stripeEnabled || !config.stripeSecretKey) {
            throw new Error('Stripe payment gateway is not configured');
        }
        const Stripe = (await import('stripe')).default;
        const stripe = new Stripe(config.stripeSecretKey, { apiVersion: '2025-12-15.clover' });
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (!session) {
            throw new Error('Checkout session not found');
        }
        const sessionTenantId = session.metadata?.tenantId || session.metadata?.tenant_id;
        if (!sessionTenantId || sessionTenantId !== tenantId) {
            throw new Error('Checkout session does not match tenant');
        }
        if (session.mode === 'subscription' && session.subscription) {
            const subscriptionId = typeof session.subscription === 'string'
                ? session.subscription
                : session.subscription.id;
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            await this.subscriptionService.handleSubscriptionUpdated(subscription);
            const isPaid = subscription.status === 'active' || subscription.status === 'trialing';
            return { status: isPaid ? 'paid' : 'unpaid', transactionId: subscription.id };
        }
        if (session.payment_status !== 'paid') {
            return { status: 'unpaid' };
        }
        const amount = session.amount_total ? session.amount_total / 100 : 0;
        const currency = session.currency?.toUpperCase() || 'USD';
        const paymentIntentId = session.payment_intent;
        const transaction = await this.paymentService.recordPaymentTransaction({
            tenantId,
            amount,
            currency,
            status: 'succeeded',
            paymentMethod: 'stripe',
            transactionReference: session.id,
            stripePaymentIntentId: paymentIntentId || undefined,
            metadata: {
                ...(session.metadata || {}),
                checkout_session_id: session.id,
                payment_intent_id: paymentIntentId || undefined
            }
        });
        await centralPool.query(`UPDATE tenants
       SET status = 'active', activated_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'pending_payment'`, [tenantId]);
        return { status: 'paid', transactionId: transaction.id };
    }
    /**
     * Create Stripe checkout session
     */
    async createStripeCheckout(params) {
        const { tenantId, plan, billingCycle, customerEmail, amount, currency, subdomain, config } = params;
        if (!config.stripeSecretKey) {
            throw new Error('Stripe secret key not configured');
        }
        console.log('[TenantSignupPayment] Creating Stripe checkout with key starting with:', config.stripeSecretKey.substring(0, 7));
        // Dynamically import Stripe
        const Stripe = (await import('stripe')).default;
        const stripe = new Stripe(config.stripeSecretKey, { apiVersion: '2025-12-15.clover' });
        const priceId = this.getStripePriceId(config, plan, billingCycle);
        if (!priceId) {
            throw new Error(`Stripe price ID not configured for ${plan} (${billingCycle})`);
        }
        const orderId = `tenant_signup_${tenantId}`;
        const baseMetadata = {
            tenant_id: String(tenantId),
            tenantId: String(tenantId),
            plan: String(plan),
            billing_cycle: String(billingCycle),
            billingCycle: String(billingCycle),
            subdomain: String(subdomain),
            type: 'subscription',
            amount: String(amount),
            currency: String(currency).toUpperCase(),
            customer_email: String(customerEmail),
            product_id: String(plan),
            product_name: `${plan.toUpperCase()} Plan - ${billingCycle === 'monthly' ? 'Monthly' : 'Yearly'}`,
            order_id: orderId,
        };
        const tenantMetadata = await this.buildTenantMetadata(tenantId, customerEmail, subdomain, plan, billingCycle);
        const metadata = {
            ...baseMetadata,
            ...tenantMetadata
        };
        // Create checkout session
        const frontendBaseUrl = this.getFrontendBaseUrl();
        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            payment_method_types: ['card'],
            client_reference_id: orderId,
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            customer_email: customerEmail,
            metadata,
            subscription_data: {
                metadata,
                trial_period_days: TenantSignupPaymentService.TRIAL_PERIOD_DAYS,
            },
            success_url: `${frontendBaseUrl}/saas/signup?payment=success&tenant_id=${tenantId}&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${frontendBaseUrl}/saas/signup?payment=cancelled&tenant_id=${tenantId}`,
        });
        return {
            gateway: 'stripe',
            checkoutUrl: session.url || undefined,
            sessionId: session.id,
        };
    }
    /**
     * Create PayPal checkout order
     */
    async createPayPalCheckout(params) {
        const { tenantId, plan, billingCycle, amount, currency, subdomain, config } = params;
        if (!config.paypalClientId || !config.paypalSecretKey) {
            throw new Error('PayPal credentials not configured');
        }
        // Get PayPal access token
        const auth = Buffer.from(`${config.paypalClientId}:${config.paypalSecretKey}`).toString('base64');
        const tokenResponse = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: 'grant_type=client_credentials',
        });
        if (!tokenResponse.ok) {
            throw new Error('Failed to get PayPal access token');
        }
        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;
        // Create PayPal order
        const frontendBaseUrl = this.getFrontendBaseUrl();
        const orderResponse = await fetch('https://api-m.paypal.com/v2/checkout/orders', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                intent: 'CAPTURE',
                purchase_units: [
                    {
                        amount: {
                            currency_code: currency.toUpperCase(),
                            value: amount.toFixed(2),
                        },
                        description: `${plan.toUpperCase()} Plan - ${billingCycle === 'monthly' ? 'Monthly' : 'Yearly'}`,
                        custom_id: tenantId,
                    },
                ],
                application_context: {
                    brand_name: 'BetaCademy',
                    landing_page: 'NO_PREFERENCE',
                    user_action: 'PAY_NOW',
                    return_url: `${frontendBaseUrl}/saas/signup?payment=success&tenant_id=${tenantId}`,
                    cancel_url: `${frontendBaseUrl}/saas/signup?payment=cancelled`,
                },
            }),
        });
        if (!orderResponse.ok) {
            const errorData = await orderResponse.text();
            console.error('PayPal order creation failed:', errorData);
            throw new Error('Failed to create PayPal order');
        }
        const orderData = await orderResponse.json();
        const approveLink = orderData.links.find((link) => link.rel === 'approve');
        return {
            gateway: 'paypal',
            checkoutUrl: approveLink?.href,
            orderId: orderData.id,
        };
    }
    /**
     * Get plan amount from configuration
     */
    getPlanAmount(config, plan, billingCycle) {
        const key = `plan${this.capitalize(plan)}${this.capitalize(billingCycle)}Amount`;
        return config[key] || null;
    }
    /**
     * Get plan currency from configuration
     */
    getPlanCurrency(config, plan, billingCycle) {
        const key = `plan${this.capitalize(plan)}${this.capitalize(billingCycle)}Currency`;
        return config[key] || null;
    }
    getStripePriceId(config, plan, billingCycle) {
        const key = `stripePrice${this.capitalize(plan)}${this.capitalize(billingCycle)}`;
        return config[key] || null;
    }
    normalizeMetadataValue(value) {
        if (value === null || value === undefined)
            return undefined;
        const text = String(value).trim();
        if (!text)
            return undefined;
        return text.length > 450 ? text.slice(0, 450) : text;
    }
    async buildTenantMetadata(tenantId, customerEmail, subdomain, plan, billingCycle) {
        const metadata = {};
        const appUrl = this.getFrontendBaseUrl();
        const protocol = this.getProtocol();
        const mainDomain = this.getMainDomain();
        try {
            const tenantResult = await centralPool.query(`SELECT id, subdomain, company_name, subscription_plan, status, created_at
         FROM tenants WHERE id = $1`, [tenantId]);
            const tenant = tenantResult.rows[0];
            const adminResult = await centralPool.query(`SELECT email, first_name, last_name, phone
         FROM tenant_admins WHERE tenant_id = $1 AND is_primary = true
         LIMIT 1`, [tenantId]);
            const admin = adminResult.rows[0];
            const adminName = [admin?.first_name, admin?.last_name].filter(Boolean).join(' ').trim();
            const entries = [
                ['tenant_id', tenant?.id || tenantId],
                ['tenant_subdomain', tenant?.subdomain || subdomain],
                ['tenant_company_name', tenant?.company_name],
                ['tenant_subscription_plan', tenant?.subscription_plan || plan],
                ['tenant_status', tenant?.status],
                ['tenant_created_at', tenant?.created_at ? new Date(tenant.created_at).toISOString() : undefined],
                ['tenant_admin_email', admin?.email || customerEmail],
                ['tenant_admin_name', adminName],
                ['tenant_admin_phone', admin?.phone],
                ['signup_email', customerEmail],
                ['billing_cycle', billingCycle],
                ['signup_source', 'saas'],
                ['app_url', appUrl],
                ['tenant_url', `${protocol}://${subdomain}.${mainDomain}`]
            ];
            for (const [key, value] of entries) {
                const normalized = this.normalizeMetadataValue(value);
                if (normalized) {
                    metadata[key] = normalized;
                }
            }
        }
        catch (error) {
            console.warn('[TenantSignupPayment] Failed to build tenant metadata:', error.message);
            const fallbackEntries = [
                ['tenant_id', tenantId],
                ['tenant_subdomain', subdomain],
                ['tenant_admin_email', customerEmail],
                ['signup_email', customerEmail],
                ['billing_cycle', billingCycle],
                ['signup_source', 'saas'],
                ['app_url', appUrl]
            ];
            for (const [key, value] of fallbackEntries) {
                const normalized = this.normalizeMetadataValue(value);
                if (normalized) {
                    metadata[key] = normalized;
                }
            }
        }
        return metadata;
    }
    /**
     * Capitalize first letter
     */
    capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
    /**
     * Get available payment gateways
     */
    async getAvailableGateways() {
        try {
            const config = await this.paymentConfigService.getCentralPaymentConfig();
            const gateways = [];
            console.log('[TenantSignupPayment] Payment config check:', {
                stripeEnabled: config.stripeEnabled,
                hasStripePublicKey: !!config.stripePublicKey,
                hasStripeSecretKey: !!config.stripeSecretKey,
                paypalEnabled: config.paypalEnabled,
                hasPaypalClientId: !!config.paypalClientId,
                hasPaypalSecretKey: !!config.paypalSecretKey,
            });
            // Check if Stripe is enabled and has required keys
            if (config.stripeEnabled && config.stripePublicKey && config.stripeSecretKey) {
                gateways.push({ gateway: 'stripe', label: 'Credit Card (Stripe)' });
            }
            // PayPal subscriptions are not configured for tenant signup
            console.log('[TenantSignupPayment] Available gateways:', gateways);
            return gateways;
        }
        catch (error) {
            console.error('[TenantSignupPayment] Error fetching gateways:', error);
            throw error;
        }
    }
}
