import { Pool } from 'pg';
import fs from 'fs/promises';
import path from 'path';
import bcrypt from 'bcrypt';
import { centralPool } from '../central-db.js';
import { getTenantPool } from './db-manager.js';
import { isValidSubdomain } from '../utils/subdomain-validator.js';
import { auditLogService } from './audit-log.service.js';
import { emailService } from './email.service.js';
const DUPLICATE_DATABASE = '42P04';
// Transaction boundaries:
// - ATOMIC_IN_CENTRAL: Steps that are atomic within a single Central DB transaction
// - ATOMIC_PER_TENANT: Steps that are atomic within Tenant DB (but not across DBs)
// - NON_ATOMIC: Steps that involve external calls or cannot be rolled back automatically
const STEP_ATOMICITY = {
    CREATE_TENANT_RECORD: 'ATOMIC_IN_CENTRAL',
    CREATE_TENANT_DATABASE: 'NON_ATOMIC', // External DB creation
    STORE_DATABASE_SECRET: 'ATOMIC_IN_CENTRAL',
    RUN_MIGRATIONS: 'ATOMIC_PER_TENANT', // Each migration file could be wrapped in transaction
    SEED_DEFAULTS: 'ATOMIC_PER_TENANT',
    CREATE_SUBSCRIPTION: 'ATOMIC_IN_CENTRAL', // Central DB transaction
    CREATE_ADMIN: 'ATOMIC_PER_TENANT',
    SEND_WELCOME_EMAIL: 'NON_ATOMIC' // External service
};
const normalizeSubdomain = (value) => value.trim().toLowerCase();
const formatDatabaseName = (value) => `tenant_${value.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
const shouldUseSSL = (connectionString) => {
    const isLocal = /localhost|127\.0\.0\.1/i.test(connectionString);
    return process.env.PGSSL ? process.env.PGSSL === 'true' : !isLocal;
};
const buildPool = (connectionString) => new Pool({
    connectionString,
    ...(shouldUseSSL(connectionString) ? { ssl: { rejectUnauthorized: false } } : {})
});
export class ProvisioningService {
    central;
    constructor(central = centralPool) {
        this.central = central;
    }
    /**
     * Get current provisioning state for idempotency and resume capability
     */
    async getProvisioningState(tenantIdOrSubdomain) {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantIdOrSubdomain);
        const tenantQuery = isUuid
            ? `SELECT id, subdomain, status FROM tenants WHERE id = $1`
            : `SELECT id, subdomain, status FROM tenants WHERE subdomain = $1`;
        const tenantResult = await this.central.query(tenantQuery, [tenantIdOrSubdomain]);
        if (tenantResult.rows.length === 0) {
            return null;
        }
        const tenant = tenantResult.rows[0];
        const logs = await this.getProvisioningLogs(tenant.id);
        const successfulSteps = logs.filter(l => l.status === 'success').map(l => l.step);
        const failedSteps = logs.filter(l => l.status === 'failed');
        const runningSteps = logs.filter(l => l.status === 'running');
        let status = 'in_progress';
        let canResume = false;
        if (tenant.status === 'deleted' || tenant.status === 'suspended') {
            status = 'rolled_back';
            canResume = false;
        }
        else if (failedSteps.length > 0 && runningSteps.length === 0) {
            status = 'failed';
            canResume = true; // Can retry failed steps
        }
        else if (successfulSteps.length === 8) { // All steps completed (updated from 7 to 8 with CREATE_SUBSCRIPTION)
            status = 'completed';
            canResume = false;
        }
        else if (runningSteps.length > 0) {
            status = 'in_progress';
            canResume = false; // Wait for running steps to finish
        }
        else {
            canResume = true; // Partial completion, can resume
        }
        const lastCompletedStep = successfulSteps.length > 0
            ? successfulSteps[successfulSteps.length - 1]
            : null;
        const failedStep = failedSteps.length > 0
            ? failedSteps[failedSteps.length - 1].step
            : null;
        return {
            tenantId: tenant.id,
            subdomain: tenant.subdomain,
            lastCompletedStep,
            failedStep,
            canResume,
            status
        };
    }
    /**
     * Rollback/cleanup provisioning for a tenant
     * Compensation strategy:
     * 1. Suspend tenant in Central DB (soft delete, can be recovered)
     * 2. Optionally drop tenant database if requested
     * 3. Log all rollback actions
     */
    async rollbackProvisioning(tenantId, options = {}) {
        const context = {
            subdomain: '',
            tenantId,
            completedSteps: new Set(),
            rollbackActions: []
        };
        try {
            const tenant = await this.fetchTenantById(tenantId);
            const stateBefore = { ...tenant };
            context.subdomain = tenant.subdomain;
            console.log(`[Provisioning Rollback] Starting rollback for tenant ${tenantId} (${tenant.subdomain}). Reason: ${options.reason || 'manual'}`);
            // Log rollback initiation
            await this.logStep(context, 'CREATE_TENANT_RECORD', 'failed', `Rollback initiated: ${options.reason || 'manual rollback'}`, { rollback: true, dropDatabase: options.dropDatabase });
            // Step 1: Suspend tenant (soft delete - can be recovered)
            await this.central.query(`UPDATE tenants SET status = 'suspended', suspended_at = NOW(), 
         settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{rollback_reason}', $2::jsonb)
         WHERE id = $1`, [tenantId, JSON.stringify(options.reason || 'provisioning failed')]);
            console.log(`[Provisioning Rollback] Tenant ${tenantId} suspended`);
            // Step 2: Optionally drop tenant database
            if (options.dropDatabase && tenant.database_name) {
                try {
                    await this.dropTenantDatabase(tenant.database_name);
                    console.log(`[Provisioning Rollback] Database ${tenant.database_name} dropped`);
                }
                catch (error) {
                    console.error(`[Provisioning Rollback] Failed to drop database ${tenant.database_name}:`, error);
                    // Continue with rollback even if DB drop fails
                }
            }
            // Step 3: Clean up tenant_admins (optional - keep for recovery)
            // await this.central.query(`DELETE FROM tenant_admins WHERE tenant_id = $1`, [tenantId]);
            console.log(`[Provisioning Rollback] Rollback complete for tenant ${tenantId}`);
            // Audit log: Tenant rollback
            await auditLogService.logSuccess({
                tenantId,
                action: 'tenant.suspend',
                resourceType: 'tenant',
                resourceId: tenantId,
                metadata: {
                    reason: options.reason || 'manual rollback',
                    dropDatabase: options.dropDatabase || false
                },
                stateBefore,
                stateAfter: {
                    status: 'suspended',
                    subdomain: tenant.subdomain
                }
            }).catch(err => console.error('Failed to create audit log:', err));
        }
        catch (error) {
            console.error(`[Provisioning Rollback] Rollback failed for tenant ${tenantId}:`, error);
            // Audit log: Failed rollback
            await auditLogService.logError({
                tenantId,
                action: 'tenant.suspend',
                resourceType: 'tenant',
                resourceId: tenantId,
                metadata: {
                    reason: options.reason || 'manual rollback',
                    dropDatabase: options.dropDatabase || false
                }
            }, error).catch(err => console.error('Failed to create audit log:', err));
            throw new Error(`Rollback failed: ${error.message}`);
        }
    }
    /**
     * Drop a tenant database (destructive operation)
     */
    async dropTenantDatabase(databaseName) {
        const adminUrl = process.env.PROVISIONING_ADMIN_DATABASE_URL;
        if (!adminUrl) {
            console.warn('[Provisioning] PROVISIONING_ADMIN_DATABASE_URL not set; cannot drop database %s', databaseName);
            return;
        }
        const adminPool = buildPool(adminUrl);
        try {
            // Terminate existing connections first
            await adminPool.query(`SELECT pg_terminate_backend(pid) 
         FROM pg_stat_activity 
         WHERE datname = $1 AND pid <> pg_backend_pid()`, [databaseName]);
            // Drop database
            await adminPool.query(`DROP DATABASE IF EXISTS ${databaseName}`);
        }
        finally {
            await adminPool.end();
        }
    }
    /**
     * Resume provisioning from last successful step
     */
    async resumeProvisioning(tenantId, payload) {
        const state = await this.getProvisioningState(tenantId);
        if (!state) {
            throw new Error(`Tenant ${tenantId} not found`);
        }
        if (!state.canResume) {
            throw new Error(`Cannot resume provisioning for tenant ${tenantId}. Status: ${state.status}`);
        }
        const tenant = await this.fetchTenantById(tenantId);
        // Merge existing tenant data with optional new payload
        const resumePayload = {
            subdomain: tenant.subdomain,
            companyName: tenant.company_name,
            subscriptionPlan: tenant.subscription_plan,
            databaseName: tenant.database_name,
            ...payload
        };
        console.log(`[Provisioning Resume] Resuming from step: ${state.lastCompletedStep || 'START'} for tenant ${tenantId}`);
        // Continue orchestrator from where it left off
        return this.provisioningOrchestrator(resumePayload, {
            resumeFromStep: state.lastCompletedStep || undefined,
            existingTenantId: tenantId
        });
    }
    async isSubdomainAvailable(subdomain) {
        const normalized = normalizeSubdomain(subdomain);
        const result = await this.central.query(`SELECT EXISTS(SELECT 1 FROM tenants WHERE subdomain = $1 AND status != 'deleted') AS exists`, [normalized]);
        return !result.rows[0].exists;
    }
    async getProvisioningLogs(tenantId) {
        const result = await this.central.query(`SELECT id, step, status, message, started_at, completed_at
       FROM provisioning_logs
       WHERE tenant_id = $1
       ORDER BY started_at ASC`, [tenantId]);
        return result.rows;
    }
    async attachTenantIdToLogs(subdomain, tenantId) {
        await this.central.query(`UPDATE provisioning_logs SET tenant_id = $1 WHERE tenant_id IS NULL AND subdomain = $2`, [tenantId, subdomain]);
    }
    async startStepLog(context, step, message) {
        const result = await this.central.query(`INSERT INTO provisioning_logs (tenant_id, subdomain, step, status, message)
       VALUES ($1, $2, $3, 'running', $4)
       RETURNING id`, [context.tenantId ?? null, context.subdomain, step, message || null]);
        return result.rows[0].id;
    }
    async finishStepLog(logId, status, message, errorDetails) {
        await this.central.query(`UPDATE provisioning_logs
       SET status = $2,
           message = COALESCE($3, message),
           error_details = $4::jsonb,
           completed_at = NOW()
       WHERE id = $1`, [logId, status, message || null, errorDetails ? JSON.stringify(errorDetails) : null]);
    }
    async logStep(context, step, status, message, errorDetails) {
        await this.central.query(`INSERT INTO provisioning_logs (tenant_id, subdomain, step, status, message, error_details)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`, [context.tenantId ?? null, context.subdomain, step, status, message || null, errorDetails ? JSON.stringify(errorDetails) : null]);
    }
    async runStep(context, step, handler, messages) {
        const logId = await this.startStepLog(context, step, messages?.start);
        try {
            const result = await handler();
            await this.finishStepLog(logId, 'success', messages?.success);
            context.completedSteps.add(step);
            return result;
        }
        catch (error) {
            await this.finishStepLog(logId, 'failed', error?.message, {
                name: error?.name,
                stack: error?.stack,
                atomicity: STEP_ATOMICITY[step]
            });
            // Execute rollback actions in reverse order
            console.error(`[Provisioning] Step ${step} failed. Executing rollback actions...`);
            await this.executeRollbackActions(context);
            throw error;
        }
    }
    /**
     * Execute accumulated rollback actions in reverse order
     */
    async executeRollbackActions(context) {
        const actions = [...context.rollbackActions].reverse();
        for (const action of actions) {
            try {
                await action();
            }
            catch (rollbackError) {
                console.error('[Provisioning Rollback] Rollback action failed:', rollbackError);
                // Continue with other rollback actions even if one fails
            }
        }
        context.rollbackActions = [];
    }
    encryptionKey() {
        return process.env.TENANT_DB_ENCRYPTION_KEY || 'placeholder_key';
    }
    async fetchTenantById(id) {
        const result = await this.central.query(`SELECT id, subdomain, company_name, status, subscription_plan, database_url_encrypted, database_name
       FROM tenants
       WHERE id = $1
       LIMIT 1`, [id]);
        return result.rows[0];
    }
    async getTenantSummary(id) {
        const result = await this.central.query(`SELECT id, subdomain, company_name, status, subscription_plan, database_name, created_at, suspended_at, deleted_at
       FROM tenants
       WHERE id = $1
       LIMIT 1`, [id]);
        return result.rows[0] || null;
    }
    async createTenant(input, options = {}) {
        const normalizedSubdomain = normalizeSubdomain(input.subdomain);
        if (!isValidSubdomain(normalizedSubdomain)) {
            throw new Error('Invalid subdomain');
        }
        if (!options.skipDuplicateCheck) {
            const available = await this.isSubdomainAvailable(normalizedSubdomain);
            if (!available) {
                throw new Error('Subdomain already in use');
            }
        }
        const fallbackDbName = input.databaseName || formatDatabaseName(normalizedSubdomain);
        // Use a transaction for tenant creation (ATOMIC_IN_CENTRAL)
        const client = await this.central.connect();
        try {
            await client.query('BEGIN');
            // Default status is 'active' - no payment required to provision tenants
            const result = await client.query(`INSERT INTO tenants (subdomain, company_name, subscription_plan, database_url_encrypted, database_name, status, activated_at)
         VALUES ($1, $2, $3, pgp_sym_encrypt(COALESCE($4,''), $5), $6, 'active', NOW())
         RETURNING id, subdomain, company_name, status, subscription_plan, database_url_encrypted, database_name`, [normalizedSubdomain, input.companyName, input.subscriptionPlan, input.databaseUrl || '', this.encryptionKey(), fallbackDbName]);
            const tenant = result.rows[0];
            if (input.admin) {
                // Hash password before storing
                let passwordHash = null;
                if (input.admin.password) {
                    passwordHash = await bcrypt.hash(input.admin.password, 10);
                }
                await client.query(`INSERT INTO tenant_admins (tenant_id, email, password_hash, first_name, last_name, phone, is_primary)
           VALUES ($1, $2, $3, $4, $5, $6, true)
           ON CONFLICT (tenant_id, email) DO NOTHING`, [tenant.id, input.admin.email, passwordHash, input.admin.firstName || null, input.admin.lastName || null, input.admin.phone || null]);
            }
            await client.query('COMMIT');
            // Audit log: Tenant creation
            await auditLogService.logSuccess({
                tenantId: tenant.id,
                userEmail: input.admin?.email,
                action: 'tenant.create',
                resourceType: 'tenant',
                resourceId: tenant.id,
                metadata: {
                    subdomain: normalizedSubdomain,
                    companyName: input.companyName,
                    subscriptionPlan: input.subscriptionPlan
                },
                stateAfter: {
                    id: tenant.id,
                    subdomain: tenant.subdomain,
                    companyName: tenant.company_name,
                    status: tenant.status,
                    subscriptionPlan: tenant.subscription_plan
                }
            }).catch(err => console.error('Failed to create audit log:', err));
            return tenant;
        }
        catch (error) {
            await client.query('ROLLBACK');
            // Audit log: Failed tenant creation
            await auditLogService.logFailure({
                userEmail: input.admin?.email,
                action: 'tenant.create',
                resourceType: 'tenant',
                metadata: {
                    subdomain: normalizedSubdomain,
                    companyName: input.companyName,
                    subscriptionPlan: input.subscriptionPlan
                }
            }, error.message).catch(err => console.error('Failed to create audit log:', err));
            throw error;
        }
        finally {
            client.release();
        }
    }
    async ensureTenantDatabaseExists(databaseName) {
        const adminUrl = process.env.PROVISIONING_ADMIN_DATABASE_URL;
        if (!adminUrl) {
            console.warn('[Provisioning] PROVISIONING_ADMIN_DATABASE_URL not set; skipping CREATE DATABASE for %s', databaseName);
            return;
        }
        const adminPool = buildPool(adminUrl);
        try {
            await adminPool.query(`CREATE DATABASE ${databaseName}`);
        }
        catch (error) {
            if (error?.code !== DUPLICATE_DATABASE) {
                throw error;
            }
        }
        finally {
            await adminPool.end();
        }
    }
    async createTenantDatabase(subdomain) {
        const template = process.env.TENANT_DATABASE_URL_TEMPLATE;
        if (!template || !template.includes('{db}')) {
            throw new Error('TENANT_DATABASE_URL_TEMPLATE must be configured with a {db} placeholder');
        }
        const databaseName = formatDatabaseName(subdomain);
        await this.ensureTenantDatabaseExists(databaseName);
        const databaseUrl = template.replace('{db}', databaseName);
        return { databaseUrl, databaseName };
    }
    async runTenantMigrations(tenant, migrationsDir = path.join(process.cwd(), 'migrations', 'tenant')) {
        const pool = await getTenantPool(tenant);
        const files = (await fs.readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
        // Track which migrations have been applied for idempotency
        const appliedMigrations = await this.getAppliedMigrations(pool);
        for (const file of files) {
            // Skip already applied migrations (idempotency)
            if (appliedMigrations.has(file)) {
                console.log(`[Migrations] Skipping already applied migration: ${file}`);
                continue;
            }
            const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
            // Each migration runs in its own transaction for atomicity
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                await client.query(sql);
                // Record migration as applied
                await client.query(`INSERT INTO schema_migrations (migration_name, applied_at) 
           VALUES ($1, NOW())
           ON CONFLICT (migration_name) DO NOTHING`, [file]);
                await client.query('COMMIT');
                console.log(`[Migrations] Applied migration: ${file}`);
            }
            catch (error) {
                await client.query('ROLLBACK');
                console.error(`[Migrations] Failed to apply migration ${file}:`, error);
                throw new Error(`Migration ${file} failed: ${error.message}`);
            }
            finally {
                client.release();
            }
        }
    }
    /**
     * Get list of applied migrations from tenant database
     */
    async getAppliedMigrations(pool) {
        try {
            // Ensure schema_migrations table exists
            await pool.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id SERIAL PRIMARY KEY,
          migration_name VARCHAR(255) UNIQUE NOT NULL,
          applied_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
            const result = await pool.query(`SELECT migration_name FROM schema_migrations`);
            return new Set(result.rows.map(r => r.migration_name));
        }
        catch (error) {
            console.warn('[Migrations] Could not fetch applied migrations:', error);
            return new Set();
        }
    }
    async seedTenantDefaults(tenant) {
        // Placeholder for seeding demo data, feature flags, etc.
        return { status: 'ok' };
    }
    /**
     * Create a subscription record for a newly provisioned tenant
     * This ensures every tenant has a corresponding subscription with locked pricing
     */
    async createSubscriptionForTenant(tenant) {
        try {
            // Get the plan_id from subscription_plans table
            const planResult = await this.central.query(`SELECT id FROM subscription_plans WHERE code = $1`, [tenant.subscription_plan]);
            if (planResult.rows.length === 0) {
                console.warn(`[Provisioning] subscription_plans entry not found for plan: ${tenant.subscription_plan}`);
                return;
            }
            const planId = planResult.rows[0].id;
            // Get the current price for the plan (monthly billing)
            const priceResult = await this.central.query(`SELECT amount, currency 
         FROM subscription_plan_prices 
         WHERE plan_id = $1 
           AND billing_cycle = 'monthly'
           AND is_active = true
           AND valid_from <= NOW()
           AND (valid_to IS NULL OR valid_to > NOW())
         ORDER BY valid_from DESC
         LIMIT 1`, [planId]);
            const lockedAmount = priceResult.rows[0]?.amount || 0;
            const lockedCurrency = priceResult.rows[0]?.currency || 'USD';
            // VALIDATION: Ensure we have valid pricing before creating subscription
            if (lockedAmount === 0) {
                console.error(`[Provisioning] Cannot create subscription with zero price for tenant ${tenant.id} (plan: ${tenant.subscription_plan})`);
                throw new Error(`No valid price found for plan ${tenant.subscription_plan}. Cannot create subscription.`);
            }
            if (!lockedCurrency) {
                console.error(`[Provisioning] Missing currency for tenant ${tenant.id}`);
                throw new Error('Currency is required to create a subscription');
            }
            console.log(`[Provisioning] Creating subscription with locked pricing: ${lockedAmount} ${lockedCurrency} for tenant ${tenant.id}`);
            // Create subscription record with locked pricing
            // CRITICAL: locked_amount = price agreed to at signup (source of truth for billing)
            await this.central.query(`INSERT INTO subscriptions 
          (tenant_id, plan, plan_id, status, price_monthly, locked_amount, locked_currency, 
           currency, billing_cycle, current_period_start, current_period_end, created_at, updated_at)
         VALUES ($1, $2, $3, 'active', $4, $4, $5, $5, 'monthly', NOW(), NOW() + INTERVAL '1 month', NOW(), NOW())
         ON CONFLICT (tenant_id) WHERE status = 'active' DO NOTHING`, [tenant.id, tenant.subscription_plan, planId, lockedAmount, lockedCurrency]);
            console.log(`[Provisioning] Created subscription for tenant ${tenant.id} (${tenant.subdomain}) - Plan: ${tenant.subscription_plan}, Locked Amount: ${lockedAmount} ${lockedCurrency}`);
        }
        catch (error) {
            console.error(`[Provisioning] Failed to create subscription for tenant ${tenant.id}:`, error);
            throw error;
        }
    }
    async createAdminUser(tenant, admin) {
        const pool = await getTenantPool(tenant);
        // Use provided password or generate a temporary one
        const password = admin.password || `${admin.email.split('@')[0]}123`;
        const normalizedEmail = admin.email.trim().toLowerCase();
        const displayName = `${admin.firstName || 'Admin'} ${admin.lastName || ''}`.trim();
        const existingUser = await pool.query(`SELECT id, password FROM users WHERE LOWER(email) = $1 LIMIT 1`, [normalizedEmail]);
        if (existingUser.rows.length > 0) {
            await pool.query(`UPDATE users
         SET name = $2,
             role = 'ADMIN',
             password = COALESCE(password, $3)
         WHERE id = $1`, [existingUser.rows[0].id, displayName, password]);
            console.info('[Provisioning] Admin user already exists for %s; updated record', admin.email);
            return;
        }
        await pool.query(`INSERT INTO users (id, email, name, role, password)
       VALUES (uuid_generate_v4(), $1, $2, 'ADMIN', $3)
       ON CONFLICT (email) DO NOTHING`, [normalizedEmail, displayName, password]);
        console.info('[Provisioning] Admin user created for %s with password: %s', admin.email, admin.password ? '***provided***' : password);
    }
    async sendWelcomeEmail(tenant, adminEmail) {
        console.info('[Provisioning] Sending welcome email to %s for tenant %s', adminEmail, tenant.subdomain);
        const result = await emailService.sendProvisioningWelcome({
            to: adminEmail,
            tenantName: tenant.company_name,
            subdomain: tenant.subdomain,
            adminName: 'Admin',
        });
        if (result.sent) {
            console.info('[Provisioning] Welcome email sent successfully to %s (messageId: %s)', adminEmail, result.messageId);
        }
        else {
            console.warn('[Provisioning] Welcome email not sent to %s: %s', adminEmail, result.reason || result.error);
        }
        return result;
    }
    async provisioningOrchestrator(payload, options = {}) {
        const normalizedSubdomain = normalizeSubdomain(payload.subdomain);
        const context = {
            subdomain: normalizedSubdomain,
            completedSteps: new Set(),
            rollbackActions: []
        };
        // Idempotency check: if tenant exists and we're not resuming, check state
        if (!options.existingTenantId) {
            const existingState = await this.getProvisioningState(normalizedSubdomain);
            if (existingState) {
                if (existingState.status === 'completed') {
                    throw new Error(`Tenant ${normalizedSubdomain} already fully provisioned`);
                }
                else if (existingState.status === 'in_progress' && !existingState.canResume) {
                    throw new Error(`Tenant ${normalizedSubdomain} provisioning already in progress`);
                }
                else if (existingState.canResume) {
                    console.log(`[Provisioning] Resuming existing provisioning for ${normalizedSubdomain}`);
                    return this.resumeProvisioning(existingState.tenantId, payload);
                }
            }
        }
        let tenant;
        try {
            // STEP 1: CREATE_TENANT_RECORD (ATOMIC_IN_CENTRAL - database transaction)
            if (!options.resumeFromStep || options.resumeFromStep === 'CREATE_TENANT_RECORD') {
                if (options.existingTenantId) {
                    tenant = await this.fetchTenantById(options.existingTenantId);
                    context.tenantId = tenant.id;
                    console.log(`[Provisioning] Using existing tenant ${tenant.id}`);
                }
                else {
                    tenant = await this.runStep(context, 'CREATE_TENANT_RECORD', () => this.createTenant({ ...payload, subdomain: normalizedSubdomain }), {
                        start: 'Creating tenant record',
                        success: 'Tenant record created'
                    });
                    context.tenantId = tenant.id;
                    await this.attachTenantIdToLogs(context.subdomain, tenant.id);
                    // Rollback action: suspend tenant if subsequent steps fail
                    context.rollbackActions.push(async () => {
                        console.log(`[Rollback] Suspending tenant ${tenant.id} due to provisioning failure`);
                        await this.central.query(`UPDATE tenants SET status = 'suspended', suspended_at = NOW() WHERE id = $1`, [tenant.id]);
                    });
                }
            }
            else {
                // Resuming - fetch existing tenant
                tenant = await this.fetchTenantById(options.existingTenantId);
                context.tenantId = tenant.id;
            }
            // Determine starting step for resume
            const stepOrder = [
                'CREATE_TENANT_RECORD',
                'CREATE_TENANT_DATABASE',
                'STORE_DATABASE_SECRET',
                'RUN_MIGRATIONS',
                'SEED_DEFAULTS',
                'CREATE_SUBSCRIPTION',
                'CREATE_ADMIN',
                'SEND_WELCOME_EMAIL'
            ];
            const resumeIndex = options.resumeFromStep
                ? stepOrder.indexOf(options.resumeFromStep) + 1
                : 1;
            // STEP 2: CREATE_TENANT_DATABASE (NON_ATOMIC - external resource, idempotent)
            if (resumeIndex <= stepOrder.indexOf('CREATE_TENANT_DATABASE')) {
                const dbInfo = payload.databaseUrl
                    ? { databaseUrl: payload.databaseUrl, databaseName: payload.databaseName || tenant.database_name }
                    : await this.runStep(context, 'CREATE_TENANT_DATABASE', async () => {
                        const result = await this.createTenantDatabase(normalizedSubdomain);
                        // Rollback action: optionally drop database if creation succeeded but later steps fail
                        context.rollbackActions.push(async () => {
                            console.log(`[Rollback] Dropping database ${result.databaseName}`);
                            try {
                                await this.dropTenantDatabase(result.databaseName);
                            }
                            catch (error) {
                                console.error(`[Rollback] Failed to drop database:`, error);
                            }
                        });
                        return result;
                    }, {
                        start: 'Provisioning dedicated database',
                        success: 'Database ready'
                    });
                // STEP 3: STORE_DATABASE_SECRET (ATOMIC_IN_CENTRAL - database transaction)
                if (resumeIndex <= stepOrder.indexOf('STORE_DATABASE_SECRET')) {
                    await this.runStep(context, 'STORE_DATABASE_SECRET', async () => {
                        await this.central.query(`UPDATE tenants SET database_url_encrypted = pgp_sym_encrypt($1, $2), database_name = $3 WHERE id = $4`, [dbInfo.databaseUrl, this.encryptionKey(), dbInfo.databaseName, tenant.id]);
                    }, { start: 'Encrypting tenant connection string', success: 'Connection string stored' });
                    tenant = await this.fetchTenantById(tenant.id);
                }
            }
            else {
                // Already have database info from previous run
                tenant = await this.fetchTenantById(tenant.id);
            }
            // STEP 4: RUN_MIGRATIONS (ATOMIC_PER_TENANT - each migration in transaction, idempotent)
            if (resumeIndex <= stepOrder.indexOf('RUN_MIGRATIONS')) {
                await this.runStep(context, 'RUN_MIGRATIONS', () => this.runTenantMigrations(tenant), {
                    start: 'Running tenant migrations',
                    success: 'Tenant migrations complete'
                });
            }
            // STEP 5: SEED_DEFAULTS (ATOMIC_PER_TENANT - idempotent seeding)
            if (resumeIndex <= stepOrder.indexOf('SEED_DEFAULTS')) {
                await this.runStep(context, 'SEED_DEFAULTS', () => this.seedTenantDefaults(tenant), {
                    start: 'Seeding baseline data',
                    success: 'Baseline data ready'
                });
            }
            // STEP 6: CREATE_SUBSCRIPTION (ATOMIC_IN_CENTRAL - subscription record with locked pricing)
            if (resumeIndex <= stepOrder.indexOf('CREATE_SUBSCRIPTION')) {
                await this.runStep(context, 'CREATE_SUBSCRIPTION', () => this.createSubscriptionForTenant(tenant), {
                    start: 'Creating subscription record',
                    success: 'Subscription created with locked pricing'
                });
            }
            // STEP 7 & 8: CREATE_ADMIN and SEND_WELCOME_EMAIL
            if (payload.admin) {
                if (resumeIndex <= stepOrder.indexOf('CREATE_ADMIN')) {
                    await this.runStep(context, 'CREATE_ADMIN', () => this.createAdminUser(tenant, payload.admin), {
                        start: 'Creating primary admin user',
                        success: 'Admin user created'
                    });
                }
                if (resumeIndex <= stepOrder.indexOf('SEND_WELCOME_EMAIL')) {
                    await this.runStep(context, 'SEND_WELCOME_EMAIL', () => this.sendWelcomeEmail(tenant, payload.admin.email), {
                        start: 'Sending welcome email',
                        success: 'Welcome email queued'
                    });
                }
            }
            else {
                await this.logStep(context, 'CREATE_ADMIN', 'pending', 'Admin payload missing');
                await this.logStep(context, 'SEND_WELCOME_EMAIL', 'pending', 'Admin payload missing');
            }
            // Clear rollback actions on success
            context.rollbackActions = [];
            // Tenant is active immediately when provisioning completes
            console.log(`Tenant ${tenant.id} provisioning complete. Status: ${tenant.status}`);
            return tenant;
        }
        catch (error) {
            console.error(`[Provisioning] Orchestrator failed for ${normalizedSubdomain}:`, error);
            // Attempt automatic rollback
            if (context.tenantId) {
                try {
                    await this.rollbackProvisioning(context.tenantId, {
                        reason: `Provisioning failed at step: ${error.message}`,
                        dropDatabase: false // Don't auto-drop, allow manual recovery
                    });
                }
                catch (rollbackError) {
                    console.error('[Provisioning] Automatic rollback failed:', rollbackError);
                }
            }
            throw error;
        }
    }
}
