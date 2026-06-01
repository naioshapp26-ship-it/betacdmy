import { Router } from 'express';
import { centralPool } from '../central-db.js';
import pool from '../../../db/pool.js';
import { ProvisioningService } from '../services/provisioning.service.js';
import { getTenantPool } from '../services/db-manager.js';
import { isValidSubdomain } from '../utils/subdomain-validator.js';
import { TenantMembershipService } from '../services/tenant-membership.service.js';
import { TenantCleanupService } from '../services/tenant-cleanup.service.js';
import { SuperAdminRefundService } from '../services/super-admin-refund.service.js';
import { SubscriptionService } from '../services/subscription.service.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { isAdmin } from '../middleware/rbac.middleware.js';
import { createErrorResponse } from '../utils/error-messages.js';
const superAdminRefundService = new SuperAdminRefundService();
const VALID_TENANT_STATUS = new Set(['active', 'suspended', 'deleted']);
const VALID_TENANT_PLAN = new Set(['basic', 'pro', 'enterprise']);
const MAX_TENANT_USER_LIMIT = 200;
const MAX_PLATFORM_USER_LIMIT = 500;
const tenantSummarySelect = `
  SELECT
    t.id,
    t.subdomain,
    t.company_name,
    t.status,
    t.subscription_plan,
    t.created_at,
    t.updated_at,
    t.suspended_at,
    t.deleted_at,
    admin.email AS primary_admin_email,
    admin.first_name AS primary_admin_first_name,
    admin.last_name AS primary_admin_last_name,
    sub.plan AS billing_plan,
    sub.status AS billing_status,
    sub.price_monthly AS billing_price_monthly,
    sub.current_period_end AS billing_period_end,
    pay_last.amount AS last_payment_amount,
    pay_last.status AS last_payment_status,
    pay_last.payment_method AS last_payment_method,
    pay_last.created_at AS last_payment_at,
    pay_tot.total_payments AS total_payments
  FROM tenants t
  LEFT JOIN LATERAL (
    SELECT email, first_name, last_name
    FROM tenant_admins
    WHERE tenant_id = t.id
    ORDER BY is_primary DESC, created_at ASC
    LIMIT 1
  ) admin ON TRUE
  LEFT JOIN LATERAL (
    SELECT plan, status, price_monthly, current_period_end
    FROM subscriptions
    WHERE tenant_id = t.id
    ORDER BY created_at DESC
    LIMIT 1
  ) sub ON TRUE
  LEFT JOIN LATERAL (
    SELECT SUM(amount) AS total_payments
    FROM payment_transactions
    WHERE tenant_id = t.id
  ) pay_tot ON TRUE
  LEFT JOIN LATERAL (
    SELECT amount, status, payment_method, created_at
    FROM payment_transactions
    WHERE tenant_id = t.id
    ORDER BY created_at DESC
    LIMIT 1
  ) pay_last ON TRUE
`;
const mapTenantSummary = (row) => {
    const adminName = [row.primary_admin_first_name, row.primary_admin_last_name]
        .filter(Boolean)
        .join(' ')
        .trim();
    return {
        id: row.id,
        subdomain: row.subdomain,
        companyName: row.company_name,
        status: row.status,
        subscriptionPlan: row.subscription_plan,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        suspendedAt: row.suspended_at,
        deletedAt: row.deleted_at,
        primaryAdmin: row.primary_admin_email
            ? {
                email: row.primary_admin_email,
                name: adminName || null
            }
            : null,
        subscription: row.billing_plan
            ? {
                plan: row.billing_plan,
                status: row.billing_status,
                priceMonthly: row.billing_price_monthly ? Number(row.billing_price_monthly) : null,
                currentPeriodEnd: row.billing_period_end
            }
            : null,
        payments: {
            total: row.total_payments ? Number(row.total_payments) : 0,
            last: row.last_payment_amount
                ? {
                    amount: Number(row.last_payment_amount),
                    status: row.last_payment_status,
                    method: row.last_payment_method,
                    createdAt: row.last_payment_at
                }
                : null
        }
    };
};
const centralSeoSelect = `
  SELECT
    s.id,
    s.page_path,
    s.title_en,
    s.title_ar,
    s.description_en,
    s.description_ar,
    s.keywords_en,
    s.keywords_ar,
    s.canonical_url,
    s.robots,
    s.indexable,
    s.og_title_en,
    s.og_title_ar,
    s.og_description_en,
    s.og_description_ar,
    s.og_image_url,
    s.og_type,
    s.og_site_name,
    s.twitter_card,
    s.twitter_title_en,
    s.twitter_title_ar,
    s.twitter_description_en,
    s.twitter_description_ar,
    s.twitter_image_url,
    s.jsonld_en,
    s.jsonld_ar,
    s.locale,
    s.locale_alternate,
    s.sitemap_priority,
    s.sitemap_changefreq,
    s.created_at,
    s.updated_at,
    s.created_by,
    s.updated_by
  FROM central_seo_settings s
`;
const fetchTenantSummary = async (id) => {
    const result = await centralPool.query(`${tenantSummarySelect} WHERE t.id = $1 LIMIT 1`, [id]);
    return result.rows[0] ? mapTenantSummary(result.rows[0]) : null;
};
const fetchTenantRecord = async (id) => {
    const result = await centralPool.query(`SELECT * FROM tenants WHERE id = $1 LIMIT 1`, [id]);
    return result.rows[0] ?? null;
};
export const createSuperAdminRouter = (deps = {}) => {
    const router = Router();
    const provisioning = deps.provisioningService ?? new ProvisioningService();
    const membershipService = new TenantMembershipService();
    const subscriptionService = new SubscriptionService();
    router.get('/api/super-admin/tenants', async (_req, res) => {
        try {
            const result = await centralPool.query(`${tenantSummarySelect} ORDER BY t.created_at DESC`);
            res.json(result.rows.map(mapTenantSummary));
        }
        catch (error) {
            console.error('List tenants failed', error);
            res.status(500).json({ error: 'Failed to list tenants' });
        }
    });
    router.get('/api/super-admin/tenants/:id', async (req, res) => {
        try {
            const summary = await fetchTenantSummary(req.params.id);
            if (!summary) {
                return res.status(404).json({ error: 'Tenant not found' });
            }
            res.json(summary);
        }
        catch (error) {
            console.error('Tenant details failed', error);
            res.status(500).json({ error: 'Failed to fetch tenant' });
        }
    });
    router.post('/api/super-admin/tenants', async (req, res) => {
        try {
            const payload = req.body || {};
            const subdomain = (payload.subdomain || '').trim().toLowerCase();
            const companyName = (payload.companyName || '').trim();
            const subscriptionPlan = (payload.subscriptionPlan || '').trim().toLowerCase();
            const adminEmail = (payload.adminEmail || '').trim().toLowerCase();
            if (!subdomain || !isValidSubdomain(subdomain)) {
                return res.status(400).json({ error: 'invalid_subdomain' });
            }
            if (!companyName) {
                return res.status(400).json({ error: 'company_name_required' });
            }
            if (!VALID_TENANT_PLAN.has(subscriptionPlan)) {
                return res.status(400).json({ error: 'invalid_plan' });
            }
            if (!adminEmail) {
                return res.status(400).json({ error: 'admin_email_required' });
            }
            const tenant = await provisioning.provisioningOrchestrator({
                subdomain,
                companyName,
                subscriptionPlan,
                admin: {
                    email: adminEmail,
                    firstName: payload.adminFirstName || undefined,
                    lastName: payload.adminLastName || undefined,
                    phone: payload.adminPhone || undefined
                }
            });
            const summary = await fetchTenantSummary(tenant.id);
            res.status(201).json(summary ?? {
                id: tenant.id,
                subdomain,
                companyName,
                subscriptionPlan
            });
        }
        catch (error) {
            console.error('Create tenant failed', error);
            res.status(500).json({ error: 'Failed to create tenant' });
        }
    });
    /**
     * GET /api/super-admin/seo/settings
     * List all central SEO settings
     */
    router.get('/api/super-admin/seo/settings', requireAuth, async (req, res) => {
        if (!(await isAdmin(req))) {
            return res.status(403).json(createErrorResponse('errors.forbidden', req, 'Admin access required'));
        }
        try {
            const result = await centralPool.query(`${centralSeoSelect} ORDER BY s.updated_at DESC`);
            res.json({ success: true, data: result.rows });
        }
        catch (error) {
            console.error('Failed to fetch central SEO settings', error);
            res.status(500).json({
                error: 'Failed to fetch central SEO settings'
            });
        }
    });
    /**
     * GET /api/super-admin/seo/settings/:id
     * Get single central SEO setting by ID
     */
    router.get('/api/super-admin/seo/settings/:id', requireAuth, async (req, res) => {
        if (!(await isAdmin(req))) {
            return res.status(403).json(createErrorResponse('errors.forbidden', req, 'Admin access required'));
        }
        try {
            const result = await centralPool.query(`${centralSeoSelect} WHERE s.id = $1`, [req.params.id]);
            if (!result.rowCount) {
                return res.status(404).json(createErrorResponse('errors.notFound', req, 'SEO setting not found'));
            }
            res.json({ success: true, data: result.rows[0] });
        }
        catch (error) {
            console.error('Failed to fetch central SEO setting', error);
            res.status(500).json({
                error: 'Failed to fetch central SEO setting'
            });
        }
    });
    /**
     * POST /api/super-admin/seo/settings
     * Create central SEO setting
     */
    router.post('/api/super-admin/seo/settings', requireAuth, async (req, res) => {
        if (!(await isAdmin(req))) {
            return res.status(403).json(createErrorResponse('errors.forbidden', req, 'Admin access required'));
        }
        const userId = req.userId;
        const { page_path, title_en, title_ar, description_en, description_ar, keywords_en, keywords_ar, canonical_url, robots, indexable, og_title_en, og_title_ar, og_description_en, og_description_ar, og_image_url, og_type, og_site_name, twitter_card, twitter_title_en, twitter_title_ar, twitter_description_en, twitter_description_ar, twitter_image_url, jsonld_en, jsonld_ar, locale, locale_alternate, sitemap_priority, sitemap_changefreq } = req.body || {};
        if (!page_path) {
            return res.status(400).json(createErrorResponse('errors.validation', req, 'Page path is required'));
        }
        try {
            const existingCheck = await centralPool.query('SELECT id FROM central_seo_settings WHERE page_path = $1', [page_path]);
            if (existingCheck.rowCount) {
                return res.status(409).json(createErrorResponse('errors.conflict', req, 'SEO setting for this page path already exists'));
            }
            const result = await centralPool.query(`INSERT INTO central_seo_settings
          (page_path, title_en, title_ar, description_en, description_ar,
           keywords_en, keywords_ar, canonical_url, robots, indexable, og_title_en, og_title_ar,
           og_description_en, og_description_ar, og_image_url, og_type, og_site_name,
           twitter_card, twitter_title_en, twitter_title_ar, twitter_description_en,
           twitter_description_ar, twitter_image_url, jsonld_en, jsonld_ar, locale,
           locale_alternate, sitemap_priority, sitemap_changefreq, created_by, updated_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $30)
        RETURNING *`, [
                page_path,
                title_en,
                title_ar,
                description_en,
                description_ar,
                keywords_en,
                keywords_ar,
                canonical_url,
                robots,
                indexable,
                og_title_en,
                og_title_ar,
                og_description_en,
                og_description_ar,
                og_image_url,
                og_type,
                og_site_name,
                twitter_card,
                twitter_title_en,
                twitter_title_ar,
                twitter_description_en,
                twitter_description_ar,
                twitter_image_url,
                jsonld_en,
                jsonld_ar,
                locale,
                locale_alternate,
                sitemap_priority,
                sitemap_changefreq,
                userId
            ]);
            res.status(201).json({ success: true, data: result.rows[0] });
        }
        catch (error) {
            console.error('Failed to create central SEO setting', error);
            res.status(500).json({ error: 'Failed to create central SEO setting' });
        }
    });
    /**
     * PUT /api/super-admin/seo/settings/:id
     * Update central SEO setting
     */
    router.put('/api/super-admin/seo/settings/:id', requireAuth, async (req, res) => {
        if (!(await isAdmin(req))) {
            return res.status(403).json(createErrorResponse('errors.forbidden', req, 'Admin access required'));
        }
        const userId = req.userId;
        const { id } = req.params;
        const { page_path, title_en, title_ar, description_en, description_ar, keywords_en, keywords_ar, canonical_url, robots, indexable, og_title_en, og_title_ar, og_description_en, og_description_ar, og_image_url, og_type, og_site_name, twitter_card, twitter_title_en, twitter_title_ar, twitter_description_en, twitter_description_ar, twitter_image_url, jsonld_en, jsonld_ar, locale, locale_alternate, sitemap_priority, sitemap_changefreq } = req.body || {};
        try {
            const existingCheck = await centralPool.query('SELECT id FROM central_seo_settings WHERE id = $1', [id]);
            if (!existingCheck.rowCount) {
                return res.status(404).json(createErrorResponse('errors.notFound', req, 'SEO setting not found'));
            }
            if (page_path) {
                const conflictCheck = await centralPool.query('SELECT id FROM central_seo_settings WHERE page_path = $1 AND id != $2', [page_path, id]);
                if (conflictCheck.rowCount) {
                    return res.status(409).json(createErrorResponse('errors.conflict', req, 'Another SEO setting with this page path already exists'));
                }
            }
            const result = await centralPool.query(`UPDATE central_seo_settings
        SET
          page_path = COALESCE($1, page_path),
          title_en = COALESCE($2, title_en),
          title_ar = COALESCE($3, title_ar),
          description_en = COALESCE($4, description_en),
          description_ar = COALESCE($5, description_ar),
          keywords_en = COALESCE($6, keywords_en),
          keywords_ar = COALESCE($7, keywords_ar),
          canonical_url = COALESCE($8, canonical_url),
          robots = COALESCE($9, robots),
          indexable = COALESCE($10, indexable),
          og_title_en = COALESCE($11, og_title_en),
          og_title_ar = COALESCE($12, og_title_ar),
          og_description_en = COALESCE($13, og_description_en),
          og_description_ar = COALESCE($14, og_description_ar),
          og_image_url = COALESCE($15, og_image_url),
          og_type = COALESCE($16, og_type),
          og_site_name = COALESCE($17, og_site_name),
          twitter_card = COALESCE($18, twitter_card),
          twitter_title_en = COALESCE($19, twitter_title_en),
          twitter_title_ar = COALESCE($20, twitter_title_ar),
          twitter_description_en = COALESCE($21, twitter_description_en),
          twitter_description_ar = COALESCE($22, twitter_description_ar),
          twitter_image_url = COALESCE($23, twitter_image_url),
          jsonld_en = COALESCE($24, jsonld_en),
          jsonld_ar = COALESCE($25, jsonld_ar),
          locale = COALESCE($26, locale),
          locale_alternate = COALESCE($27, locale_alternate),
          sitemap_priority = COALESCE($28, sitemap_priority),
          sitemap_changefreq = COALESCE($29, sitemap_changefreq),
          updated_by = $30
        WHERE id = $31
        RETURNING *`, [
                page_path,
                title_en,
                title_ar,
                description_en,
                description_ar,
                keywords_en,
                keywords_ar,
                canonical_url,
                robots,
                indexable,
                og_title_en,
                og_title_ar,
                og_description_en,
                og_description_ar,
                og_image_url,
                og_type,
                og_site_name,
                twitter_card,
                twitter_title_en,
                twitter_title_ar,
                twitter_description_en,
                twitter_description_ar,
                twitter_image_url,
                jsonld_en,
                jsonld_ar,
                locale,
                locale_alternate,
                sitemap_priority,
                sitemap_changefreq,
                userId,
                id
            ]);
            res.json({ success: true, data: result.rows[0] });
        }
        catch (error) {
            console.error('Failed to update central SEO setting', error);
            res.status(500).json({ error: 'Failed to update central SEO setting' });
        }
    });
    /**
     * DELETE /api/super-admin/seo/settings/:id
     * Delete central SEO setting
     */
    router.delete('/api/super-admin/seo/settings/:id', requireAuth, async (req, res) => {
        if (!(await isAdmin(req))) {
            return res.status(403).json(createErrorResponse('errors.forbidden', req, 'Admin access required'));
        }
        try {
            const result = await centralPool.query('DELETE FROM central_seo_settings WHERE id = $1 RETURNING *', [req.params.id]);
            if (!result.rowCount) {
                return res.status(404).json(createErrorResponse('errors.notFound', req, 'SEO setting not found'));
            }
            res.json({ success: true, message: 'SEO setting deleted successfully' });
        }
        catch (error) {
            console.error('Failed to delete central SEO setting', error);
            res.status(500).json({ error: 'Failed to delete central SEO setting' });
        }
    });
    /**
     * GET /api/seo/settings/page
     * Get central SEO settings for a specific page (public endpoint)
     */
    router.get('/api/seo/settings/page', async (req, res, next) => {
        const { path } = req.query;
        const tenant = req.tenant;
        if (tenant) {
            return next();
        }
        if (!path) {
            return res.status(400).json(createErrorResponse('errors.validation', req, 'Path query parameter is required'));
        }
        try {
            const result = await centralPool.query(`SELECT
          page_path,
          title_en,
          title_ar,
          description_en,
          description_ar,
          keywords_en,
          keywords_ar,
          canonical_url,
          robots,
          indexable,
          og_title_en,
          og_title_ar,
          og_description_en,
          og_description_ar,
          og_image_url,
          og_type,
          og_site_name,
          twitter_card,
          twitter_title_en,
          twitter_title_ar,
          twitter_description_en,
          twitter_description_ar,
          twitter_image_url,
          jsonld_en,
          jsonld_ar,
          locale,
          locale_alternate,
          sitemap_priority,
          sitemap_changefreq
        FROM central_seo_settings
        WHERE page_path = $1`, [path]);
            if (!result.rowCount) {
                return res.status(404).json({ success: false, data: null });
            }
            res.json({ success: true, data: result.rows[0] });
        }
        catch (error) {
            console.error('Failed to fetch central page SEO settings', error);
            res.status(500).json({ error: 'Failed to fetch central SEO settings' });
        }
    });
    router.post('/api/super-admin/tenants/:id/users/assign', async (req, res) => {
        const { id } = req.params;
        const payload = req.body || {};
        try {
            const tenant = await fetchTenantRecord(id);
            if (!tenant) {
                return res.status(404).json({ error: 'Tenant not found' });
            }
            if (!payload.platformUserId && !payload.email) {
                return res.status(400).json({ error: 'platform_user_required' });
            }
            const result = await membershipService.assignUser({
                tenant,
                platformUserId: payload.platformUserId,
                email: payload.email,
                role: payload.role
            });
            res.status(201).json({
                assignment: result.link,
                platformUser: {
                    id: result.platformUser.id,
                    email: result.platformUser.email,
                    name: result.platformUser.name,
                    role: result.platformUser.role
                }
            });
        }
        catch (error) {
            const status = error?.statusCode || 500;
            const message = error?.message || 'Failed to assign user';
            console.error('Assign tenant user failed', error);
            res.status(status).json({ error: message });
        }
    });
    router.delete('/api/super-admin/tenants/:id/users/:platformUserId', async (req, res) => {
        const { id, platformUserId } = req.params;
        try {
            const tenant = await fetchTenantRecord(id);
            if (!tenant) {
                return res.status(404).json({ error: 'Tenant not found' });
            }
            await membershipService.revokeUser({ tenant, platformUserId });
            res.status(204).send();
        }
        catch (error) {
            const status = error?.statusCode || 500;
            const message = error?.message || 'Failed to revoke user';
            console.error('Revoke tenant user failed', error);
            res.status(status).json({ error: message });
        }
    });
    router.patch('/api/super-admin/tenants/:id', async (req, res) => {
        const { id } = req.params;
        const payload = req.body || {};
        try {
            const tenant = await fetchTenantRecord(id);
            if (!tenant) {
                return res.status(404).json({ error: 'Tenant not found' });
            }
            const updates = [];
            const values = [];
            let idx = 1;
            let normalizedSubdomain;
            const companyName = typeof payload.companyName === 'string' ? payload.companyName.trim() : undefined;
            if (companyName && companyName !== tenant.company_name) {
                updates.push(`company_name = $${idx++}`);
                values.push(companyName);
            }
            const subscriptionPlan = typeof payload.subscriptionPlan === 'string' ? payload.subscriptionPlan.trim().toLowerCase() : undefined;
            if (subscriptionPlan && VALID_TENANT_PLAN.has(subscriptionPlan) && subscriptionPlan !== tenant.subscription_plan) {
                updates.push(`subscription_plan = $${idx++}`);
                values.push(subscriptionPlan);
            }
            const status = typeof payload.status === 'string' ? payload.status.trim().toLowerCase() : undefined;
            if (status) {
                if (!VALID_TENANT_STATUS.has(status)) {
                    return res.status(400).json({ error: 'invalid_status' });
                }
                updates.push(`status = $${idx++}`);
                values.push(status);
                if (status === 'suspended') {
                    updates.push(`suspended_at = NOW()`);
                }
                else if (status === 'active') {
                    updates.push(`suspended_at = NULL, deleted_at = NULL`);
                }
                else if (status === 'deleted') {
                    updates.push(`deleted_at = NOW()`);
                    try {
                        await subscriptionService.cancelSubscription(id, false);
                    }
                    catch (error) {
                        console.warn('Cancel subscription on status delete failed', error);
                    }
                }
            }
            if (typeof payload.maxUsers === 'number') {
                updates.push(`max_users = $${idx++}`);
                values.push(payload.maxUsers);
            }
            if (typeof payload.maxCourses === 'number') {
                updates.push(`max_courses = $${idx++}`);
                values.push(payload.maxCourses);
            }
            if (typeof payload.storageQuotaGb === 'number') {
                updates.push(`storage_quota_gb = $${idx++}`);
                values.push(payload.storageQuotaGb);
            }
            if (typeof payload.customDomain === 'string') {
                updates.push(`custom_domain = $${idx++}`);
                values.push(payload.customDomain.trim());
            }
            if (typeof payload.subdomain === 'string') {
                const candidate = payload.subdomain.trim().toLowerCase();
                if (candidate && candidate !== tenant.subdomain) {
                    if (!isValidSubdomain(candidate)) {
                        return res.status(400).json({ error: 'invalid_subdomain' });
                    }
                    const available = await provisioning.isSubdomainAvailable(candidate);
                    if (!available) {
                        return res.status(409).json({ error: 'subdomain_unavailable' });
                    }
                    normalizedSubdomain = candidate;
                    updates.push(`subdomain = $${idx++}`);
                    values.push(candidate);
                }
            }
            if (!updates.length) {
                return res.json(await fetchTenantSummary(id));
            }
            values.push(id);
            const updateQuery = `UPDATE tenants SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING id`;
            await centralPool.query(updateQuery, values);
            if (payload.primaryAdminEmail) {
                const email = String(payload.primaryAdminEmail).trim().toLowerCase();
                if (email) {
                    await centralPool.query(`INSERT INTO tenant_admins (tenant_id, email, is_primary)
             VALUES ($1, $2, true)
             ON CONFLICT (tenant_id, email) DO UPDATE SET is_primary = true`, [id, email]);
                    await centralPool.query(`UPDATE tenant_admins SET is_primary = false WHERE tenant_id = $1 AND email <> $2`, [id, email]);
                }
            }
            const summary = await fetchTenantSummary(id);
            res.json(summary);
        }
        catch (error) {
            console.error('Update tenant failed', error);
            res.status(500).json({ error: 'Failed to update tenant' });
        }
    });
    router.delete('/api/super-admin/tenants/:id', async (req, res) => {
        const { id } = req.params;
        try {
            const tenant = await fetchTenantRecord(id);
            if (!tenant) {
                return res.status(404).json({ error: 'Tenant not found' });
            }
            try {
                await subscriptionService.cancelSubscription(id, false);
            }
            catch (error) {
                console.warn('Cancel subscription on super admin delete failed', error);
            }
            // Soft delete - mark as deleted but keep data
            await centralPool.query(`UPDATE tenants SET status = 'deleted', deleted_at = NOW() WHERE id = $1`, [id]);
            res.status(204).send();
        }
        catch (error) {
            console.error('Delete tenant failed', error);
            res.status(500).json({ error: 'Failed to delete tenant' });
        }
    });
    // Hard delete endpoint - full cleanup
    router.delete('/api/super-admin/tenants/:id/hard-delete', async (req, res) => {
        const { id } = req.params;
        const { dropDatabase = true, deleteFiles = true, archiveCentralRecords = true, retentionDays = 90 } = req.body || {};
        try {
            const tenant = await fetchTenantRecord(id);
            if (!tenant) {
                return res.status(404).json({ error: 'Tenant not found' });
            }
            try {
                await subscriptionService.cancelSubscription(id, false);
            }
            catch (error) {
                console.warn('Cancel subscription on hard delete failed', error);
            }
            const cleanupService = new TenantCleanupService();
            const result = await cleanupService.hardDeleteTenant(id, {
                dropDatabase,
                deleteFiles,
                archiveCentralRecords,
                retentionDays
            });
            res.json({
                success: true,
                result,
                message: 'Tenant hard delete completed',
                warnings: result.errors.length > 0 ? result.errors : undefined
            });
        }
        catch (error) {
            console.error('Hard delete tenant failed', error);
            res.status(500).json({
                error: 'Failed to hard delete tenant',
                message: error.message
            });
        }
    });
    router.get('/api/super-admin/tenants/:id/payments', async (req, res) => {
        const { id } = req.params;
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        try {
            const tenant = await fetchTenantRecord(id);
            if (!tenant) {
                return res.status(404).json({ error: 'Tenant not found' });
            }
            const result = await centralPool.query(`SELECT id, amount, currency, status, payment_method, transaction_reference, created_at,
                COALESCE(refunded_amount, 0) as refunded_amount,
                COALESCE(refund_status, 'none') as refund_status
         FROM payment_transactions
         WHERE tenant_id = $1
         ORDER BY created_at DESC
         LIMIT $2`, [id, limit]);
            res.json(result.rows);
        }
        catch (error) {
            console.error('Fetch tenant payments failed', error);
            res.status(500).json({ error: 'Failed to load payments' });
        }
    });
    router.get('/api/super-admin/tenants/:id/users', async (req, res) => {
        const { id } = req.params;
        const limit = Math.min(Number(req.query.limit) || 50, MAX_TENANT_USER_LIMIT);
        const search = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
        const role = typeof req.query.role === 'string' ? req.query.role.trim().toUpperCase() : '';
        try {
            const tenant = await fetchTenantRecord(id);
            if (!tenant) {
                return res.status(404).json({ error: 'Tenant not found' });
            }
            const tenantPool = await getTenantPool(tenant);
            const filters = [];
            const values = [];
            let idx = 1;
            if (search) {
                filters.push(`(LOWER(email) LIKE $${idx} OR LOWER(name) LIKE $${idx} OR COALESCE(LOWER(public_user_id), '') LIKE $${idx})`);
                values.push(`%${search}%`);
                idx += 1;
            }
            if (role) {
                filters.push(`role = $${idx}`);
                values.push(role);
                idx += 1;
            }
            let query = `SELECT id, public_user_id, email, name, role, status, last_active, join_date FROM users`;
            if (filters.length) {
                query += ` WHERE ${filters.join(' AND ')}`;
            }
            query += ` ORDER BY COALESCE(last_active, NOW()) DESC LIMIT ${limit}`;
            const result = await tenantPool.query(query, values);
            res.json(result.rows);
        }
        catch (error) {
            console.error('Fetch tenant users failed', error);
            res.status(500).json({ error: 'Failed to load tenant users' });
        }
    });
    router.get('/api/super-admin/platform-users', async (req, res) => {
        const limit = Math.min(Number(req.query.limit) || 100, MAX_PLATFORM_USER_LIMIT);
        const search = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
        const role = typeof req.query.role === 'string' ? req.query.role.trim().toUpperCase() : '';
        try {
            const filters = [];
            const values = [];
            let idx = 1;
            if (search) {
                filters.push(`(LOWER(email) LIKE $${idx} OR LOWER(name) LIKE $${idx} OR COALESCE(LOWER(public_user_id), '') LIKE $${idx})`);
                values.push(`%${search}%`);
                idx += 1;
            }
            if (role) {
                filters.push(`role = $${idx}`);
                values.push(role);
                idx += 1;
            }
            let query = `SELECT id, public_user_id, email, name, role, status, last_active, join_date FROM users`;
            if (filters.length) {
                query += ` WHERE ${filters.join(' AND ')}`;
            }
            query += ` ORDER BY COALESCE(last_active, NOW()) DESC LIMIT ${limit}`;
            const result = await pool.query(query, values);
            res.json(result.rows);
        }
        catch (error) {
            console.error('Fetch platform users failed', error);
            res.status(500).json({ error: 'Failed to load platform users' });
        }
    });
    router.get('/api/super-admin/provisioning-logs', async (req, res) => {
        const limit = Math.min(Number(req.query.limit) || 200, 500);
        try {
            const result = await centralPool.query(`SELECT id, tenant_id, subdomain, status, step, message, started_at, completed_at
         FROM provisioning_logs
         ORDER BY started_at DESC
         LIMIT $1`, [limit]);
            res.json(result.rows);
        }
        catch (error) {
            console.error('Provisioning logs failed', error);
            res.status(500).json({ error: 'Failed to fetch logs' });
        }
    });
    router.get('/api/super-admin/analytics', async (_req, res) => {
        try {
            const [tenantCounts, paymentSummary] = await Promise.all([
                centralPool.query(`SELECT
            COUNT(*) AS total_tenants,
            COUNT(*) FILTER (WHERE status = 'active') AS active_tenants,
            COUNT(*) FILTER (WHERE status = 'suspended') AS suspended_tenants,
            COUNT(*) FILTER (WHERE status = 'deleted') AS deleted_tenants
           FROM tenants`),
                centralPool.query(`SELECT COALESCE(SUM(amount), 0) AS total_revenue, COUNT(*) AS payment_events FROM payment_transactions`)
            ]);
            const counts = tenantCounts.rows[0] || {};
            const payments = paymentSummary.rows[0] || {};
            res.json({
                total_tenants: Number(counts.total_tenants || 0),
                active_tenants: Number(counts.active_tenants || 0),
                suspended_tenants: Number(counts.suspended_tenants || 0),
                deleted_tenants: Number(counts.deleted_tenants || 0),
                total_revenue: Number(payments.total_revenue || 0),
                payment_events: Number(payments.payment_events || 0)
            });
        }
        catch (error) {
            console.error('Analytics failed', error);
            res.status(500).json({ error: 'Failed to load analytics' });
        }
    });
    /**
     * POST /api/super-admin/tenants/:id/subscription/cancel
     * Cancel a tenant subscription via Stripe
     */
    router.post('/api/super-admin/tenants/:id/subscription/cancel', async (req, res) => {
        const { id } = req.params;
        const { cancelAtPeriodEnd = true } = req.body || {};
        try {
            const tenant = await fetchTenantRecord(id);
            if (!tenant) {
                return res.status(404).json({ error: 'Tenant not found' });
            }
            await subscriptionService.cancelSubscription(id, Boolean(cancelAtPeriodEnd));
            const updated = await fetchTenantSummary(id);
            res.json({
                success: true,
                message: cancelAtPeriodEnd
                    ? 'Subscription will be cancelled at the end of the billing period'
                    : 'Subscription cancelled immediately',
                tenant: updated
            });
        }
        catch (error) {
            console.error('Cancel subscription failed', error);
            res.status(400).json({ error: error.message || 'Failed to cancel subscription' });
        }
    });
    // =====================================================
    // Subscription Payment Refund Endpoints
    // =====================================================
    /**
     * GET /api/super-admin/payments/:paymentId/refund-check
     * Check if a payment can be refunded
     */
    router.get('/api/super-admin/payments/:paymentId/refund-check', async (req, res) => {
        const { paymentId } = req.params;
        try {
            const eligibility = await superAdminRefundService.canRefund(paymentId);
            res.json(eligibility);
        }
        catch (error) {
            console.error('Refund check failed', error);
            res.status(500).json({ error: 'Failed to check refund eligibility' });
        }
    });
    /**
     * POST /api/super-admin/payments/:paymentId/refund
     * Process a refund for a subscription payment
     */
    router.post('/api/super-admin/payments/:paymentId/refund', async (req, res) => {
        const { paymentId } = req.params;
        const { amount, reason } = req.body;
        // Get admin info from request (set by auth middleware)
        const adminId = req.adminId || req.user?.id;
        const adminEmail = req.adminEmail || req.user?.email || 'super-admin';
        const adminName = req.adminName || req.user?.name || 'Super Admin';
        try {
            // Get payment to retrieve tenant ID
            const payment = await superAdminRefundService.getPaymentTransaction(paymentId);
            if (!payment) {
                return res.status(404).json({ error: 'Payment not found' });
            }
            const result = await superAdminRefundService.processRefund({
                paymentTransactionId: paymentId,
                amount: amount ? parseFloat(amount) : undefined,
                reason,
                refundedBy: adminId || 'super-admin',
                refundedByName: adminName,
                refundedByEmail: adminEmail,
                tenantId: payment.tenant_id
            });
            res.json({
                success: true,
                message: 'Refund processed successfully',
                data: result
            });
        }
        catch (error) {
            console.error('Refund processing failed', error);
            res.status(400).json({
                error: error.message || 'Failed to process refund',
                success: false
            });
        }
    });
    /**
     * GET /api/super-admin/payments/:paymentId/refunds
     * Get all refunds for a specific payment
     */
    router.get('/api/super-admin/payments/:paymentId/refunds', async (req, res) => {
        const { paymentId } = req.params;
        try {
            const refunds = await superAdminRefundService.getRefundsForPayment(paymentId);
            res.json({
                success: true,
                data: refunds,
                total: refunds.length
            });
        }
        catch (error) {
            console.error('Fetch payment refunds failed', error);
            res.status(500).json({ error: 'Failed to fetch refunds' });
        }
    });
    /**
     * GET /api/super-admin/tenants/:id/refunds
     * Get all refunds for a tenant
     */
    router.get('/api/super-admin/tenants/:id/refunds', async (req, res) => {
        const { id } = req.params;
        try {
            const tenant = await fetchTenantRecord(id);
            if (!tenant) {
                return res.status(404).json({ error: 'Tenant not found' });
            }
            const refunds = await superAdminRefundService.getTenantRefunds(id);
            res.json({
                success: true,
                data: refunds,
                total: refunds.length
            });
        }
        catch (error) {
            console.error('Fetch tenant refunds failed', error);
            res.status(500).json({ error: 'Failed to fetch tenant refunds' });
        }
    });
    /**
     * GET /api/super-admin/refunds
     * Get all subscription refunds with optional filters
     */
    router.get('/api/super-admin/refunds', async (req, res) => {
        const status = req.query.status;
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        const offset = Number(req.query.offset) || 0;
        try {
            const result = await superAdminRefundService.getAllRefunds({
                status,
                limit,
                offset
            });
            res.json({
                success: true,
                data: result.refunds,
                total: result.total,
                limit,
                offset
            });
        }
        catch (error) {
            console.error('Fetch all refunds failed', error);
            res.status(500).json({ error: 'Failed to fetch refunds' });
        }
    });
    return router;
};
