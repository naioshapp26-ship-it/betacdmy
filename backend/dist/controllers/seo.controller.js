/**
 * SEO Settings Controller
 *
 * Provides endpoints for managing page SEO metadata
 * with bilingual support (English & Arabic)
 *
 * Requires ADMIN role
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { isAdmin } from '../middleware/rbac.middleware.js';
import { requireTenantPool } from '../middleware/tenant-isolation-guard.js';
import { createErrorResponse } from '../utils/error-messages.js';
export const createSEORouter = () => {
    const router = Router();
    const schemaEnsuredPools = new WeakSet();
    const ensureSeoSchema = async (tenantPool) => {
        if (!tenantPool || schemaEnsuredPools.has(tenantPool)) {
            return;
        }
        await tenantPool.query(`
      CREATE TABLE IF NOT EXISTS seo_settings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        page_path VARCHAR(255) NOT NULL UNIQUE,
        title_en VARCHAR(255),
        title_ar VARCHAR(255),
        description_en TEXT,
        description_ar TEXT,
        keywords_en TEXT,
        keywords_ar TEXT,
        canonical_url TEXT,
        robots VARCHAR(255),
        indexable BOOLEAN DEFAULT TRUE,
        og_title_en VARCHAR(255),
        og_title_ar VARCHAR(255),
        og_description_en TEXT,
        og_description_ar TEXT,
        og_image_url TEXT,
        og_type VARCHAR(100),
        og_site_name VARCHAR(255),
        twitter_card VARCHAR(100),
        twitter_title_en VARCHAR(255),
        twitter_title_ar VARCHAR(255),
        twitter_description_en TEXT,
        twitter_description_ar TEXT,
        twitter_image_url TEXT,
        jsonld_en TEXT,
        jsonld_ar TEXT,
        locale VARCHAR(100),
        locale_alternate VARCHAR(255),
        sitemap_priority NUMERIC(3,2),
        sitemap_changefreq VARCHAR(50),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        updated_by UUID REFERENCES users(id) ON DELETE SET NULL
      )
    `);
        await tenantPool.query(`
      ALTER TABLE seo_settings
      ADD COLUMN IF NOT EXISTS canonical_url TEXT,
      ADD COLUMN IF NOT EXISTS robots VARCHAR(255),
      ADD COLUMN IF NOT EXISTS indexable BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS og_title_en VARCHAR(255),
      ADD COLUMN IF NOT EXISTS og_title_ar VARCHAR(255),
      ADD COLUMN IF NOT EXISTS og_description_en TEXT,
      ADD COLUMN IF NOT EXISTS og_description_ar TEXT,
      ADD COLUMN IF NOT EXISTS og_image_url TEXT,
      ADD COLUMN IF NOT EXISTS og_type VARCHAR(100),
      ADD COLUMN IF NOT EXISTS og_site_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS twitter_card VARCHAR(100),
      ADD COLUMN IF NOT EXISTS twitter_title_en VARCHAR(255),
      ADD COLUMN IF NOT EXISTS twitter_title_ar VARCHAR(255),
      ADD COLUMN IF NOT EXISTS twitter_description_en TEXT,
      ADD COLUMN IF NOT EXISTS twitter_description_ar TEXT,
      ADD COLUMN IF NOT EXISTS twitter_image_url TEXT,
      ADD COLUMN IF NOT EXISTS jsonld_en TEXT,
      ADD COLUMN IF NOT EXISTS jsonld_ar TEXT,
      ADD COLUMN IF NOT EXISTS locale VARCHAR(100),
      ADD COLUMN IF NOT EXISTS locale_alternate VARCHAR(255),
      ADD COLUMN IF NOT EXISTS sitemap_priority NUMERIC(3,2),
      ADD COLUMN IF NOT EXISTS sitemap_changefreq VARCHAR(50),
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL
    `);
        await tenantPool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_settings_page_path ON seo_settings(page_path)');
        await tenantPool.query('CREATE INDEX IF NOT EXISTS idx_seo_settings_updated_at ON seo_settings(updated_at DESC)');
        schemaEnsuredPools.add(tenantPool);
    };
    const resolveTenantUserId = async (tenantPool, userId) => {
        if (!userId) {
            return null;
        }
        const result = await tenantPool.query('SELECT 1 FROM users WHERE id = $1', [userId]);
        return result.rowCount ? userId : null;
    };
    /**
     * GET /api/admin/seo/settings
     * Get all SEO settings
     */
    router.get('/api/admin/seo/settings', requireAuth, requireTenantPool, async (req, res) => {
        const tenantPool = req.tenantPool;
        await ensureSeoSchema(tenantPool);
        // Check if user is admin
        if (!(await isAdmin(req))) {
            return res.status(403).json(createErrorResponse('errors.forbidden', req, 'Admin access required'));
        }
        try {
            const result = await tenantPool.query(`
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
            s.updated_by,
            u1.name as created_by_name,
            u2.name as updated_by_name
          FROM seo_settings s
          LEFT JOIN users u1 ON s.created_by = u1.id
          LEFT JOIN users u2 ON s.updated_by = u2.id
          ORDER BY s.updated_at DESC
        `);
            res.json({ success: true, data: result.rows });
        }
        catch (error) {
            console.error('Failed to fetch SEO settings', error);
            res.status(500).json(createErrorResponse('errors.apiServerError', req, 'Failed to fetch SEO settings'));
        }
    });
    /**
     * GET /api/admin/seo/settings/:id
     * Get single SEO setting by ID
     */
    router.get('/api/admin/seo/settings/:id', requireAuth, requireTenantPool, async (req, res) => {
        const tenantPool = req.tenantPool;
        await ensureSeoSchema(tenantPool);
        const { id } = req.params;
        // Check if user is admin
        if (!(await isAdmin(req))) {
            return res.status(403).json(createErrorResponse('errors.forbidden', req, 'Admin access required'));
        }
        try {
            const result = await tenantPool.query(`SELECT 
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
            s.updated_by,
            u1.name as created_by_name,
            u2.name as updated_by_name
          FROM seo_settings s
          LEFT JOIN users u1 ON s.created_by = u1.id
          LEFT JOIN users u2 ON s.updated_by = u2.id
          WHERE s.id = $1`, [id]);
            if (result.rows.length === 0) {
                return res.status(404).json(createErrorResponse('errors.notFound', req, 'SEO setting not found'));
            }
            res.json({ success: true, data: result.rows[0] });
        }
        catch (error) {
            console.error('Failed to fetch SEO setting', error);
            res.status(500).json(createErrorResponse('errors.apiServerError', req, 'Failed to fetch SEO setting'));
        }
    });
    /**
     * POST /api/admin/seo/settings
     * Create new SEO setting
     */
    router.post('/api/admin/seo/settings', requireAuth, requireTenantPool, async (req, res) => {
        const tenantPool = req.tenantPool;
        await ensureSeoSchema(tenantPool);
        const userId = req.userId;
        // Check if user is admin
        if (!(await isAdmin(req))) {
            return res.status(403).json(createErrorResponse('errors.forbidden', req, 'Admin access required'));
        }
        const { page_path, title_en, title_ar, description_en, description_ar, keywords_en, keywords_ar, canonical_url, robots, indexable, og_title_en, og_title_ar, og_description_en, og_description_ar, og_image_url, og_type, og_site_name, twitter_card, twitter_title_en, twitter_title_ar, twitter_description_en, twitter_description_ar, twitter_image_url, jsonld_en, jsonld_ar, locale, locale_alternate, sitemap_priority, sitemap_changefreq } = req.body;
        // Validate required fields
        if (!page_path) {
            return res.status(400).json(createErrorResponse('errors.validation', req, 'Page path is required'));
        }
        try {
            // Check if page_path already exists
            const existingCheck = await tenantPool.query('SELECT id FROM seo_settings WHERE page_path = $1', [page_path]);
            if (existingCheck.rows.length > 0) {
                return res.status(409).json(createErrorResponse('errors.conflict', req, 'SEO setting for this page path already exists'));
            }
            const actorId = await resolveTenantUserId(tenantPool, userId);
            const result = await tenantPool.query(`INSERT INTO seo_settings 
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
                actorId
            ]);
            res.status(201).json({ success: true, data: result.rows[0] });
        }
        catch (error) {
            console.error('Failed to create SEO setting', error);
            res.status(500).json(createErrorResponse('errors.apiServerError', req, 'Failed to create SEO setting'));
        }
    });
    /**
     * PUT /api/admin/seo/settings/:id
     * Update SEO setting
     */
    router.put('/api/admin/seo/settings/:id', requireAuth, requireTenantPool, async (req, res) => {
        const tenantPool = req.tenantPool;
        await ensureSeoSchema(tenantPool);
        const userId = req.userId;
        const { id } = req.params;
        // Check if user is admin
        if (!(await isAdmin(req))) {
            return res.status(403).json(createErrorResponse('errors.forbidden', req, 'Admin access required'));
        }
        const { page_path, title_en, title_ar, description_en, description_ar, keywords_en, keywords_ar, canonical_url, robots, indexable, og_title_en, og_title_ar, og_description_en, og_description_ar, og_image_url, og_type, og_site_name, twitter_card, twitter_title_en, twitter_title_ar, twitter_description_en, twitter_description_ar, twitter_image_url, jsonld_en, jsonld_ar, locale, locale_alternate, sitemap_priority, sitemap_changefreq } = req.body;
        try {
            // Check if record exists
            const existingCheck = await tenantPool.query('SELECT id FROM seo_settings WHERE id = $1', [id]);
            if (existingCheck.rows.length === 0) {
                return res.status(404).json(createErrorResponse('errors.notFound', req, 'SEO setting not found'));
            }
            // Check if page_path conflicts with another record
            if (page_path) {
                const conflictCheck = await tenantPool.query('SELECT id FROM seo_settings WHERE page_path = $1 AND id != $2', [page_path, id]);
                if (conflictCheck.rows.length > 0) {
                    return res.status(409).json(createErrorResponse('errors.conflict', req, 'Another SEO setting with this page path already exists'));
                }
            }
            const actorId = await resolveTenantUserId(tenantPool, userId);
            const result = await tenantPool.query(`UPDATE seo_settings 
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
                actorId,
                id
            ]);
            res.json({ success: true, data: result.rows[0] });
        }
        catch (error) {
            console.error('Failed to update SEO setting', error);
            res.status(500).json(createErrorResponse('errors.apiServerError', req, 'Failed to update SEO setting'));
        }
    });
    /**
     * DELETE /api/admin/seo/settings/:id
     * Delete SEO setting
     */
    router.delete('/api/admin/seo/settings/:id', requireAuth, requireTenantPool, async (req, res) => {
        const tenantPool = req.tenantPool;
        await ensureSeoSchema(tenantPool);
        const { id } = req.params;
        // Check if user is admin
        if (!(await isAdmin(req))) {
            return res.status(403).json(createErrorResponse('errors.forbidden', req, 'Admin access required'));
        }
        try {
            const result = await tenantPool.query('DELETE FROM seo_settings WHERE id = $1 RETURNING *', [id]);
            if (result.rows.length === 0) {
                return res.status(404).json(createErrorResponse('errors.notFound', req, 'SEO setting not found'));
            }
            res.json({ success: true, message: 'SEO setting deleted successfully' });
        }
        catch (error) {
            console.error('Failed to delete SEO setting', error);
            res.status(500).json(createErrorResponse('errors.apiServerError', req, 'Failed to delete SEO setting'));
        }
    });
    /**
     * GET /api/seo/settings/page
     * Get SEO settings for a specific page (public endpoint)
     * Query param: path
     */
    router.get('/api/seo/settings/page', requireTenantPool, async (req, res) => {
        const tenantPool = req.tenantPool;
        await ensureSeoSchema(tenantPool);
        const { path } = req.query;
        if (!path) {
            return res.status(400).json(createErrorResponse('errors.validation', req, 'Path query parameter is required'));
        }
        try {
            const result = await tenantPool.query(`SELECT 
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
          FROM seo_settings 
          WHERE page_path = $1`, [path]);
            if (result.rows.length === 0) {
                return res.status(404).json({ success: false, data: null });
            }
            res.json({ success: true, data: result.rows[0] });
        }
        catch (error) {
            console.error('Failed to fetch page SEO settings', error);
            res.status(500).json(createErrorResponse('errors.apiServerError', req, 'Failed to fetch page SEO settings'));
        }
    });
    return router;
};
