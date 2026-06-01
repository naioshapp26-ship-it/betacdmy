import { centralPool } from '../central-db.js';
/**
 * Encryption password for pgp_sym_encrypt/decrypt
 * In production, this should be a strong secret stored securely
 */
const ENCRYPTION_KEY = process.env.PAYMENT_CONFIG_ENCRYPTION_KEY || 'default-encryption-key-change-in-production';
/**
 * Service for managing payment gateway configurations
 * Supports both central (Super Admin) and tenant-specific configurations
 */
export class PaymentConfigService {
    /**
     * Get payment gateway configuration based on context
     * @param context - Payment context (central or tenant)
     * @returns Decrypted payment gateway configuration
     */
    async getPaymentConfig(context) {
        const pool = context.type === 'central' ? centralPool : context.tenantPool;
        if (!pool) {
            throw new Error('Database pool not available for payment configuration');
        }
        try {
            const result = await pool.query(`
        SELECT * FROM payment_gateway_config WHERE id = 1 LIMIT 1
      `);
            if (result.rows.length === 0) {
                console.warn(`[PaymentConfig] No configuration found for ${context.type}`);
                return this.getEmptyConfig();
            }
            const row = result.rows[0];
            console.log(`[PaymentConfig] Raw row from DB for ${context.type}:`, {
                stripe_enabled: row.stripe_enabled,
                has_stripe_public_key: !!row.stripe_public_key,
                stripe_secret_key_type: row.stripe_secret_key ? typeof row.stripe_secret_key : 'null',
                is_buffer: row.stripe_secret_key ? Buffer.isBuffer(row.stripe_secret_key) : false,
                stripe_secret_key_preview: row.stripe_secret_key ? row.stripe_secret_key.toString().substring(0, 20) : 'null',
                paypal_enabled: row.paypal_enabled,
                has_paypal_client_id: !!row.paypal_client_id,
            });
            // Decrypt Stripe secret key
            if (row.stripe_secret_key) {
                try {
                    // PostgreSQL returns BYTEA columns as Buffer objects
                    const encryptedData = row.stripe_secret_key;
                    if (Buffer.isBuffer(encryptedData)) {
                        const decryptResult = await pool.query('SELECT pgp_sym_decrypt($1, $2) as decrypted', [encryptedData, ENCRYPTION_KEY]);
                        row.stripe_secret_key = decryptResult.rows[0].decrypted.toString();
                        console.log('[PaymentConfig] Successfully decrypted Stripe secret key. Starts with:', row.stripe_secret_key?.substring(0, 7));
                    }
                    else {
                        console.warn('[PaymentConfig] Stripe secret key is not a Buffer. Type:', typeof encryptedData);
                        row.stripe_secret_key = null;
                    }
                }
                catch (err) {
                    console.error('[PaymentConfig] Failed to decrypt Stripe secret key:', err.message);
                    row.stripe_secret_key = null;
                }
            }
            // Decrypt Stripe webhook secret
            if (row.stripe_webhook_secret) {
                try {
                    if (Buffer.isBuffer(row.stripe_webhook_secret)) {
                        const decryptResult = await pool.query('SELECT pgp_sym_decrypt($1, $2) as decrypted', [row.stripe_webhook_secret, ENCRYPTION_KEY]);
                        row.stripe_webhook_secret = decryptResult.rows[0].decrypted.toString();
                        console.log('[PaymentConfig] Successfully decrypted Stripe webhook secret');
                    }
                }
                catch (err) {
                    console.error('[PaymentConfig] Failed to decrypt Stripe webhook secret:', err.message);
                    row.stripe_webhook_secret = null;
                }
            }
            // Decrypt PayPal secret key
            if (row.paypal_secret_key) {
                try {
                    if (Buffer.isBuffer(row.paypal_secret_key)) {
                        const decryptResult = await pool.query('SELECT pgp_sym_decrypt($1, $2) as decrypted', [row.paypal_secret_key, ENCRYPTION_KEY]);
                        row.paypal_secret_key = decryptResult.rows[0].decrypted.toString();
                        console.log('[PaymentConfig] Successfully decrypted PayPal secret key');
                    }
                }
                catch (err) {
                    console.error('[PaymentConfig] Failed to decrypt PayPal secret key:', err.message);
                    row.paypal_secret_key = null;
                }
            }
            // Decrypt Visa secret key
            if (row.visa_secret_key) {
                try {
                    if (Buffer.isBuffer(row.visa_secret_key)) {
                        const decryptResult = await pool.query('SELECT pgp_sym_decrypt($1, $2) as decrypted', [row.visa_secret_key, ENCRYPTION_KEY]);
                        row.visa_secret_key = decryptResult.rows[0].decrypted.toString();
                    }
                }
                catch (err) {
                    console.error('[PaymentConfig] Failed to decrypt Visa secret key:', err.message);
                    row.visa_secret_key = null;
                }
            }
            // Helper to parse numeric values (PostgreSQL NUMERIC returns as string)
            const parseNumeric = (value) => {
                if (value === null || value === undefined)
                    return null;
                const parsed = parseFloat(value);
                return isNaN(parsed) ? null : parsed;
            };
            return {
                stripeEnabled: row.stripe_enabled || false,
                stripePublicKey: row.stripe_public_key || null,
                stripeSecretKey: row.stripe_secret_key || null,
                stripeWebhookSecret: row.stripe_webhook_secret || null,
                stripePriceBasicMonthly: row.stripe_price_basic_monthly || null,
                stripePriceBasicYearly: row.stripe_price_basic_yearly || null,
                stripePriceProMonthly: row.stripe_price_pro_monthly || null,
                stripePriceProYearly: row.stripe_price_pro_yearly || null,
                stripePriceEnterpriseMonthly: row.stripe_price_enterprise_monthly || null,
                stripePriceEnterpriseYearly: row.stripe_price_enterprise_yearly || null,
                planBasicMonthlyAmount: parseNumeric(row.plan_basic_monthly_amount),
                planBasicMonthlyCurrency: row.plan_basic_monthly_currency || null,
                planBasicYearlyAmount: parseNumeric(row.plan_basic_yearly_amount),
                planBasicYearlyCurrency: row.plan_basic_yearly_currency || null,
                planProMonthlyAmount: parseNumeric(row.plan_pro_monthly_amount),
                planProMonthlyCurrency: row.plan_pro_monthly_currency || null,
                planProYearlyAmount: parseNumeric(row.plan_pro_yearly_amount),
                planProYearlyCurrency: row.plan_pro_yearly_currency || null,
                planEnterpriseMonthlyAmount: parseNumeric(row.plan_enterprise_monthly_amount),
                planEnterpriseMonthlyCurrency: row.plan_enterprise_monthly_currency || null,
                planEnterpriseYearlyAmount: parseNumeric(row.plan_enterprise_yearly_amount),
                planEnterpriseYearlyCurrency: row.plan_enterprise_yearly_currency || null,
                paypalEnabled: row.paypal_enabled || false,
                paypalClientId: row.paypal_client_id || null,
                paypalSecretKey: row.paypal_secret_key || null,
                visaEnabled: row.visa_enabled || false,
                visaPublicKey: row.visa_public_key || null,
                visaSecretKey: row.visa_secret_key || null,
            };
        }
        catch (error) {
            console.error(`[PaymentConfig] Error fetching configuration for ${context.type}:`, error.message);
            throw new Error(`Failed to fetch payment configuration: ${error.message}`);
        }
    }
    /**
     * Get payment configuration for central (Super Admin) context
     * Used for tenant signup/provisioning
     */
    async getCentralPaymentConfig() {
        return this.getPaymentConfig({ type: 'central' });
    }
    /**
     * Get payment configuration for tenant context
     * Used for course purchases and tenant-specific payments
     */
    async getTenantPaymentConfig(tenantPool) {
        return this.getPaymentConfig({ type: 'tenant', tenantPool });
    }
    /**
     * Update payment gateway configuration
     * @param context - Payment context (central or tenant)
     * @param config - New configuration values
     * @param updatedBy - User ID who is making the update
     */
    async updatePaymentConfig(context, config, updatedBy) {
        const pool = context.type === 'central' ? centralPool : context.tenantPool;
        if (!pool) {
            throw new Error('Database pool not available for payment configuration');
        }
        const updates = [];
        const values = [ENCRYPTION_KEY];
        let paramIndex = 2;
        // Build dynamic UPDATE query
        if (config.stripeEnabled !== undefined) {
            updates.push(`stripe_enabled = $${paramIndex++}`);
            values.push(config.stripeEnabled);
        }
        if (config.stripePublicKey !== undefined) {
            updates.push(`stripe_public_key = $${paramIndex++}`);
            values.push(config.stripePublicKey || null);
        }
        if (config.stripeSecretKey !== undefined) {
            updates.push(`stripe_secret_key = pgp_sym_encrypt($${paramIndex++}, $1)`);
            values.push(config.stripeSecretKey || null);
        }
        // stripe_webhook_secret for both central and tenant
        if (config.stripeWebhookSecret !== undefined) {
            updates.push(`stripe_webhook_secret = pgp_sym_encrypt($${paramIndex++}, $1)`);
            values.push(config.stripeWebhookSecret || null);
        }
        if (config.paypalEnabled !== undefined) {
            updates.push(`paypal_enabled = $${paramIndex++}`);
            values.push(config.paypalEnabled);
        }
        if (config.paypalClientId !== undefined) {
            updates.push(`paypal_client_id = $${paramIndex++}`);
            values.push(config.paypalClientId || null);
        }
        if (config.paypalSecretKey !== undefined) {
            updates.push(`paypal_secret_key = pgp_sym_encrypt($${paramIndex++}, $1)`);
            values.push(config.paypalSecretKey || null);
        }
        if (config.visaEnabled !== undefined) {
            updates.push(`visa_enabled = $${paramIndex++}`);
            values.push(config.visaEnabled);
        }
        if (config.visaPublicKey !== undefined) {
            updates.push(`visa_public_key = $${paramIndex++}`);
            values.push(config.visaPublicKey || null);
        }
        if (config.visaSecretKey !== undefined) {
            updates.push(`visa_secret_key = pgp_sym_encrypt($${paramIndex++}, $1)`);
            values.push(config.visaSecretKey || null);
        }
        // Stripe price IDs and plan amounts only exist in central table (for tenant signup)
        // Tenant tables only have basic payment gateway config for course purchases
        if (context.type === 'central') {
            if (config.stripePriceBasicMonthly !== undefined) {
                updates.push(`stripe_price_basic_monthly = $${paramIndex++}`);
                values.push(config.stripePriceBasicMonthly || null);
            }
            if (config.stripePriceBasicYearly !== undefined) {
                updates.push(`stripe_price_basic_yearly = $${paramIndex++}`);
                values.push(config.stripePriceBasicYearly || null);
            }
            if (config.stripePriceProMonthly !== undefined) {
                updates.push(`stripe_price_pro_monthly = $${paramIndex++}`);
                values.push(config.stripePriceProMonthly || null);
            }
            if (config.stripePriceProYearly !== undefined) {
                updates.push(`stripe_price_pro_yearly = $${paramIndex++}`);
                values.push(config.stripePriceProYearly || null);
            }
            if (config.stripePriceEnterpriseMonthly !== undefined) {
                updates.push(`stripe_price_enterprise_monthly = $${paramIndex++}`);
                values.push(config.stripePriceEnterpriseMonthly || null);
            }
            if (config.stripePriceEnterpriseYearly !== undefined) {
                updates.push(`stripe_price_enterprise_yearly = $${paramIndex++}`);
                values.push(config.stripePriceEnterpriseYearly || null);
            }
        }
        // Plan amounts only exist in central table
        if (context.type === 'central' && config.planBasicMonthlyAmount !== undefined) {
            updates.push(`plan_basic_monthly_amount = $${paramIndex++}`);
            values.push(config.planBasicMonthlyAmount ?? null);
        }
        if (context.type === 'central' && config.planBasicMonthlyCurrency !== undefined) {
            updates.push(`plan_basic_monthly_currency = $${paramIndex++}`);
            values.push(config.planBasicMonthlyCurrency || null);
        }
        if (context.type === 'central' && config.planBasicYearlyAmount !== undefined) {
            updates.push(`plan_basic_yearly_amount = $${paramIndex++}`);
            values.push(config.planBasicYearlyAmount ?? null);
        }
        if (context.type === 'central' && config.planBasicYearlyCurrency !== undefined) {
            updates.push(`plan_basic_yearly_currency = $${paramIndex++}`);
            values.push(config.planBasicYearlyCurrency || null);
        }
        if (context.type === 'central' && config.planProMonthlyAmount !== undefined) {
            updates.push(`plan_pro_monthly_amount = $${paramIndex++}`);
            values.push(config.planProMonthlyAmount ?? null);
        }
        if (context.type === 'central' && config.planProMonthlyCurrency !== undefined) {
            updates.push(`plan_pro_monthly_currency = $${paramIndex++}`);
            values.push(config.planProMonthlyCurrency || null);
        }
        if (context.type === 'central' && config.planProYearlyAmount !== undefined) {
            updates.push(`plan_pro_yearly_amount = $${paramIndex++}`);
            values.push(config.planProYearlyAmount ?? null);
        }
        if (context.type === 'central' && config.planProYearlyCurrency !== undefined) {
            updates.push(`plan_pro_yearly_currency = $${paramIndex++}`);
            values.push(config.planProYearlyCurrency || null);
        }
        if (context.type === 'central' && config.planEnterpriseMonthlyAmount !== undefined) {
            updates.push(`plan_enterprise_monthly_amount = $${paramIndex++}`);
            values.push(config.planEnterpriseMonthlyAmount ?? null);
        }
        if (context.type === 'central' && config.planEnterpriseMonthlyCurrency !== undefined) {
            updates.push(`plan_enterprise_monthly_currency = $${paramIndex++}`);
            values.push(config.planEnterpriseMonthlyCurrency || null);
        }
        if (context.type === 'central' && config.planEnterpriseYearlyAmount !== undefined) {
            updates.push(`plan_enterprise_yearly_amount = $${paramIndex++}`);
            values.push(config.planEnterpriseYearlyAmount ?? null);
        }
        if (context.type === 'central' && config.planEnterpriseYearlyCurrency !== undefined) {
            updates.push(`plan_enterprise_yearly_currency = $${paramIndex++}`);
            values.push(config.planEnterpriseYearlyCurrency || null);
        }
        // Only set updated_by for central context
        // For tenant context, tenant admin ID references central tenant_admins table,
        // not the tenant's users table, so it would violate foreign key constraint
        let actorId;
        if (context.type === 'central' && updatedBy) {
            const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(updatedBy);
            if (!isUuid) {
                console.warn(`[PaymentConfig] Skipping updated_by; invalid UUID: ${updatedBy}`);
            }
            else {
                try {
                    const actorCheck = await pool.query('SELECT 1 FROM tenant_admins WHERE id = $1 LIMIT 1', [updatedBy]);
                    if (actorCheck.rowCount > 0) {
                        actorId = updatedBy;
                    }
                    else {
                        console.warn(`[PaymentConfig] Skipping updated_by; actor ${updatedBy} not found for central context`);
                    }
                }
                catch (lookupError) {
                    console.warn('[PaymentConfig] Failed to verify updated_by actor:', lookupError.message);
                }
            }
        }
        if (context.type === 'central' && actorId) {
            updates.push(`updated_by = $${paramIndex++}`);
            values.push(actorId);
        }
        if (updates.length === 0) {
            console.warn('[PaymentConfig] No updates provided');
            return;
        }
        updates.push(`updated_at = NOW()`);
        const query = `
      UPDATE payment_gateway_config
      SET ${updates.join(', ')}
      WHERE id = 1
    `;
        try {
            await pool.query(query, values);
            console.log(`[PaymentConfig] Updated ${context.type} payment configuration`);
        }
        catch (error) {
            console.error(`[PaymentConfig] Error updating configuration for ${context.type}:`, error.message);
            throw new Error(`Failed to update payment configuration: ${error.message}`);
        }
    }
    /**
     * Get public payment configuration (safe to expose to frontend)
     * Only includes public keys and enabled flags
     */
    async getPublicPaymentConfig(context) {
        const config = await this.getPaymentConfig(context);
        return {
            stripeEnabled: config.stripeEnabled,
            stripePublicKey: config.stripePublicKey,
            stripePriceBasicMonthly: config.stripePriceBasicMonthly,
            stripePriceBasicYearly: config.stripePriceBasicYearly,
            stripePriceProMonthly: config.stripePriceProMonthly,
            stripePriceProYearly: config.stripePriceProYearly,
            stripePriceEnterpriseMonthly: config.stripePriceEnterpriseMonthly,
            stripePriceEnterpriseYearly: config.stripePriceEnterpriseYearly,
            planBasicMonthlyAmount: config.planBasicMonthlyAmount,
            planBasicMonthlyCurrency: config.planBasicMonthlyCurrency,
            planBasicYearlyAmount: config.planBasicYearlyAmount,
            planBasicYearlyCurrency: config.planBasicYearlyCurrency,
            planProMonthlyAmount: config.planProMonthlyAmount,
            planProMonthlyCurrency: config.planProMonthlyCurrency,
            planProYearlyAmount: config.planProYearlyAmount,
            planProYearlyCurrency: config.planProYearlyCurrency,
            planEnterpriseMonthlyAmount: config.planEnterpriseMonthlyAmount,
            planEnterpriseMonthlyCurrency: config.planEnterpriseMonthlyCurrency,
            planEnterpriseYearlyAmount: config.planEnterpriseYearlyAmount,
            planEnterpriseYearlyCurrency: config.planEnterpriseYearlyCurrency,
            paypalEnabled: config.paypalEnabled,
            paypalClientId: config.paypalClientId,
            visaEnabled: config.visaEnabled,
            visaPublicKey: config.visaPublicKey,
        };
    }
    /**
     * Returns an empty configuration
     */
    getEmptyConfig() {
        return {
            stripeEnabled: false,
            stripePublicKey: null,
            stripeSecretKey: null,
            stripeWebhookSecret: null,
            stripePriceBasicMonthly: null,
            stripePriceBasicYearly: null,
            stripePriceProMonthly: null,
            stripePriceProYearly: null,
            stripePriceEnterpriseMonthly: null,
            stripePriceEnterpriseYearly: null,
            planBasicMonthlyAmount: null,
            planBasicMonthlyCurrency: null,
            planBasicYearlyAmount: null,
            planBasicYearlyCurrency: null,
            planProMonthlyAmount: null,
            planProMonthlyCurrency: null,
            planProYearlyAmount: null,
            planProYearlyCurrency: null,
            planEnterpriseMonthlyAmount: null,
            planEnterpriseMonthlyCurrency: null,
            planEnterpriseYearlyAmount: null,
            planEnterpriseYearlyCurrency: null,
            paypalEnabled: false,
            paypalClientId: null,
            paypalSecretKey: null,
            visaEnabled: false,
            visaPublicKey: null,
            visaSecretKey: null,
        };
    }
}
