import { centralPool } from '../central-db.js';
import dotenv from 'dotenv';
import { normalizeAIProvider } from '../utils/ai-provider.js';
dotenv.config();
/**
 * Encryption password for pgp_sym_encrypt/decrypt
 * In production, this should be a strong secret stored securely
 */
const getEncryptionKey = () => process.env.AI_CONFIG_ENCRYPTION_KEY ||
    process.env.PAYMENT_CONFIG_ENCRYPTION_KEY ||
    process.env.TENANT_DB_ENCRYPTION_KEY ||
    'default-encryption-key-change-in-production';
/**
 * Service for managing AI provider configurations
 * Supports both central (Super Admin / Platform) and tenant-specific configurations
 */
export class AIConfigService {
    /**
     * Get AI configuration based on context
     * @param context - AI context (central or tenant)
     * @returns Decrypted AI configuration
     */
    async getAIConfig(context) {
        const pool = context.type === 'central' ? centralPool : context.tenantPool;
        if (!pool) {
            throw new Error('Database pool not available for AI configuration');
        }
        try {
            const result = await pool.query(`
        SELECT 
          ai_enabled,
          ai_provider,
          ai_model,
          CASE 
            WHEN api_key IS NULL THEN NULL 
            ELSE pgp_sym_decrypt(api_key, $1) 
          END AS api_key,
          CASE 
            WHEN api_secret IS NULL THEN NULL 
            ELSE pgp_sym_decrypt(api_secret, $1) 
          END AS api_secret,
          max_tokens,
          temperature,
          custom_config
        FROM ai_config
        WHERE id = 1
      `, [getEncryptionKey()]);
            if (result.rows.length === 0) {
                console.warn(`[AIConfig] No configuration found for ${context.type}`);
                return this.getEmptyConfig();
            }
            const row = result.rows[0];
            console.log(`[AIConfig] Loaded config for ${context.type}:`, {
                ai_enabled: row.ai_enabled,
                ai_provider: row.ai_provider,
                has_api_key: !!row.api_key
            });
            return {
                aiEnabled: row.ai_enabled || false,
                aiProvider: normalizeAIProvider(row.ai_provider),
                aiModel: row.ai_model || 'gemini-2.5-flash',
                apiKey: row.api_key ? Buffer.from(row.api_key).toString('utf-8') : null,
                apiSecret: row.api_secret ? Buffer.from(row.api_secret).toString('utf-8') : null,
                maxTokens: row.max_tokens || 4096,
                temperature: parseFloat(row.temperature) || 0.7,
                customConfig: row.custom_config || {},
            };
        }
        catch (error) {
            console.error(`[AIConfig] Error fetching configuration for ${context.type}:`, error.message);
            throw new Error(`Failed to fetch AI configuration: ${error.message}`);
        }
    }
    /**
     * Get AI configuration for central (Super Admin / Platform) context
     * Used for platform-level AI features on main domain
     */
    async getCentralAIConfig() {
        return this.getAIConfig({ type: 'central' });
    }
    /**
     * Get AI configuration for tenant context
     * Used for tenant-specific AI features
     */
    async getTenantAIConfig(tenantPool) {
        return this.getAIConfig({ type: 'tenant', tenantPool });
    }
    /**
     * Update AI configuration
     * @param context - AI context (central or tenant)
     * @param config - New configuration values
     * @param updatedBy - User ID who is making the update
     */
    async updateAIConfig(context, config, updatedBy) {
        const pool = context.type === 'central' ? centralPool : context.tenantPool;
        if (!pool) {
            throw new Error('Database pool not available for AI configuration');
        }
        // Ensure singleton row exists so updates always target a record
        await pool.query(`INSERT INTO ai_config (
        id,
        ai_enabled,
        ai_provider,
        ai_model,
        max_tokens,
        temperature,
        custom_config
      ) VALUES (
        1,
        false,
        'gemini',
        'gemini-2.5-flash',
        4096,
        0.7,
        '{}'::jsonb
      ) ON CONFLICT (id) DO NOTHING`);
        // Only set updated_by when the actor exists in the current scope to avoid FK violations
        let actorId;
        if (updatedBy) {
            const actorQuery = context.type === 'tenant'
                ? 'SELECT 1 FROM users WHERE id = $1 LIMIT 1'
                : 'SELECT 1 FROM tenant_admins WHERE id = $1 LIMIT 1';
            try {
                const actorCheck = await pool.query(actorQuery, [updatedBy]);
                if (actorCheck.rowCount > 0) {
                    actorId = updatedBy;
                }
                else {
                    console.warn(`[AIConfig] Skipping updated_by; actor ${updatedBy} not found for ${context.type} context`);
                }
            }
            catch (lookupError) {
                console.warn('[AIConfig] Failed to verify updated_by actor:', lookupError.message);
            }
        }
        const updates = [];
        const values = [getEncryptionKey()];
        let paramIndex = 2;
        // Build dynamic UPDATE query
        if (config.aiEnabled !== undefined) {
            updates.push(`ai_enabled = $${paramIndex++}`);
            values.push(config.aiEnabled);
        }
        if (config.aiProvider !== undefined) {
            updates.push(`ai_provider = $${paramIndex++}`);
            values.push(normalizeAIProvider(config.aiProvider));
        }
        if (config.aiModel !== undefined) {
            updates.push(`ai_model = $${paramIndex++}`);
            values.push(config.aiModel);
        }
        if (config.apiKey !== undefined) {
            if (config.apiKey === null || config.apiKey === '') {
                updates.push(`api_key = NULL`);
            }
            else {
                updates.push(`api_key = pgp_sym_encrypt($${paramIndex++}, $1)`);
                values.push(config.apiKey);
            }
        }
        if (config.apiSecret !== undefined) {
            if (config.apiSecret === null || config.apiSecret === '') {
                updates.push(`api_secret = NULL`);
            }
            else {
                updates.push(`api_secret = pgp_sym_encrypt($${paramIndex++}, $1)`);
                values.push(config.apiSecret);
            }
        }
        if (config.maxTokens !== undefined) {
            updates.push(`max_tokens = $${paramIndex++}`);
            values.push(config.maxTokens);
        }
        if (config.temperature !== undefined) {
            updates.push(`temperature = $${paramIndex++}`);
            values.push(config.temperature);
        }
        if (config.customConfig !== undefined) {
            updates.push(`custom_config = $${paramIndex++}`);
            values.push(JSON.stringify(config.customConfig));
        }
        if (actorId) {
            updates.push(`updated_by = $${paramIndex++}`);
            values.push(actorId);
        }
        if (updates.length === 0) {
            console.warn('[AIConfig] No updates provided');
            return;
        }
        updates.push(`updated_at = NOW()`);
        const query = `
      UPDATE ai_config
      SET ${updates.join(', ')}
      WHERE id = 1
    `;
        try {
            await pool.query(query, values);
            console.log(`[AIConfig] Updated AI configuration for ${context.type}`);
        }
        catch (error) {
            console.error(`[AIConfig] Error updating configuration for ${context.type}:`, error.message);
            throw new Error(`Failed to update AI configuration: ${error.message}`);
        }
    }
    /**
     * Get public AI configuration (safe to expose to frontend)
     * Does not include API keys or secrets
     */
    async getPublicAIConfig(context) {
        const pool = context.type === 'central' ? centralPool : context.tenantPool;
        if (!pool) {
            throw new Error('Database pool not available for AI configuration');
        }
        try {
            const result = await pool.query(`
        SELECT
          ai_enabled,
          ai_provider,
          ai_model,
          max_tokens,
          temperature,
          custom_config
        FROM ai_config
        WHERE id = 1
      `);
            if (result.rows.length === 0) {
                return {
                    aiEnabled: false,
                    aiProvider: 'gemini',
                    aiModel: 'gemini-2.5-flash',
                    maxTokens: 4096,
                    temperature: 0.7,
                    customConfig: {},
                };
            }
            const row = result.rows[0];
            const temperature = row.temperature === null || row.temperature === undefined
                ? 0.7
                : (typeof row.temperature === 'number' ? row.temperature : parseFloat(row.temperature));
            return {
                aiEnabled: row.ai_enabled || false,
                aiProvider: normalizeAIProvider(row.ai_provider),
                aiModel: row.ai_model || 'gemini-2.5-flash',
                maxTokens: row.max_tokens || 4096,
                temperature: Number.isNaN(temperature) ? 0.7 : temperature,
                customConfig: row.custom_config || {},
            };
        }
        catch (error) {
            console.error(`[AIConfig] Error fetching public configuration for ${context.type}:`, error.message);
            throw new Error(`Failed to fetch public AI configuration: ${error.message}`);
        }
    }
    /**
     * Get API key for AI requests (internal use only)
     * Returns configuration API key based on context, or fallback to global env var
     * @param context - AI context (central or tenant)
     * @returns API key string or null
     */
    async getAPIKey(context) {
        const resolvedContext = context ?? { type: 'central' };
        if (resolvedContext.type === 'tenant' && !resolvedContext.tenantPool) {
            console.warn('[AIConfig] Tenant context missing tenantPool; skipping tenant lookup');
            return null;
        }
        try {
            const config = await this.getAIConfig(resolvedContext);
            if (config.aiEnabled && config.apiKey) {
                console.log(`[AIConfig] Using ${resolvedContext.type}-level API key from database`);
                return config.apiKey;
            }
            console.warn(`[AIConfig] ${resolvedContext.type} AI configuration is ${config.aiEnabled ? 'missing API key' : 'disabled'}`);
        }
        catch (error) {
            console.error(`[AIConfig] Failed to load ${resolvedContext.type} AI configuration:`, error.message);
        }
        console.warn('[AIConfig] No AI API key configured in database');
        return null;
    }
    /**
     * Returns an empty configuration
     */
    getEmptyConfig() {
        return {
            aiEnabled: false,
            aiProvider: 'gemini',
            aiModel: 'gemini-2.5-flash',
            apiKey: null,
            apiSecret: null,
            maxTokens: 4096,
            temperature: 0.7,
            customConfig: {},
        };
    }
}
