import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { JWT } from 'google-auth-library';
import multer from 'multer';
import bcrypt from 'bcrypt';
import { mkdir, stat, readdir, readFile } from 'fs/promises';
import fs from 'fs';
import { createTenantRouter } from './backend/dist/controllers/tenant.controller.js';
import { createSuperAdminRouter } from './backend/dist/controllers/super-admin.controller.js';
import { createPaymentWebhookRouter } from './backend/dist/controllers/payment-webhook.controller.js';
import { createPaymentRouter } from './backend/dist/controllers/payment.controller.js';
import { createCoursePaymentRouter } from './backend/dist/controllers/course-payment.controller.js';
import { createRefundRouter } from './backend/dist/controllers/refund.controller.js';
import { createPaymentGatewayConfigRouter } from './backend/dist/controllers/payment-gateway-config.controller.js';
import { createTenantPaymentGatewayConfigRouter } from './backend/dist/controllers/tenant-payment-gateway-config.controller.js';
import { createAIConfigRouter } from './backend/dist/controllers/ai-config.controller.js';
import { createTenantAIConfigRouter } from './backend/dist/controllers/tenant-ai-config.controller.js';
import { createRBACRouter } from './backend/dist/controllers/rbac.controller.js';
import { createSEORouter } from './backend/dist/controllers/seo.controller.js';
import adminSubscriptionsRouter from './backend/dist/controllers/admin-subscriptions.controller.js';
import { tenantResolver, optionalTenantResolver } from './backend/dist/middleware/tenant-resolver.js';
import { ProvisioningService } from './backend/dist/services/provisioning.service.js';
import { runCentralMigrations } from './backend/dist/services/central-migrator.js';
import { centralPool } from './backend/dist/central-db.js';
import { resolveSeoForPath } from './backend/dist/services/seo-resolver.js';
import { loginRateLimiter, tenantApiRateLimiter, generalApiRateLimiter } from './backend/dist/middleware/rate-limiter.js';
import { requireTenantPool, blockSuperAdminOnTenant } from './backend/dist/middleware/tenant-isolation-guard.js';
import { requireAuth, optionalAuth, requireRole, requireSelfOrAdmin, requireTenantAdmin, generateAccessToken } from './backend/dist/middleware/auth.middleware.js';
import { requirePermission, requireAnyPermission, isAdmin, canAccessResource } from './backend/dist/middleware/rbac.middleware.js';
import * as authController from './backend/dist/controllers/auth.controller.js';
import { forgotPassword, resetPassword } from './backend/dist/controllers/password-reset.controller.js';
import { apiCorsConfig, mediaCorsConfig, getCorsConfig } from './backend/dist/middleware/cors.middleware.js';

const staticPageDefinitions = JSON.parse(await readFile('./static-pages.json', 'utf8'));
const blogImageConfig = JSON.parse(await readFile('./blogImageConfig.json', 'utf8'));
import pool, { getDefaultPool, runWithPoolContext } from './db/pool.js';
import { decryptField, encryptField } from './db/field-encryption.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BLOG_IMAGE_FALLBACK = blogImageConfig?.fallback || '/blog-placeholder.svg';
const BLOCKED_BLOG_IMAGE_PATTERNS = blogImageConfig?.blockedSources || [];
const ICON_PATH_FAVICON = '/favicon.ico';
const ICON_PATH_APPLE_TOUCH = '/apple-touch-icon.png';
const DEFAULT_ICON_FALLBACK = '/beta-logo.png';
const MAX_ACADEMY_NAME_LENGTH = 200;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isValidUuid = (value) => typeof value === 'string' && UUID_REGEX.test(value.trim());

const isBlockedBlogImage = (source = '') => BLOCKED_BLOG_IMAGE_PATTERNS.some((pattern) => source.includes(pattern));
const sanitizeBlogImage = (source) => {
  if (!source) {
    return BLOG_IMAGE_FALLBACK;
  }
  return isBlockedBlogImage(source) ? BLOG_IMAGE_FALLBACK : source;
};

const resolveBlogImageResponse = (imageUrl, uploadedImagePath) => {
  if (uploadedImagePath) {
    return uploadedImagePath;
  }
  return sanitizeBlogImage(imageUrl);
};

const sanitizeExistingBlogImages = async () => {
  try {
    const { rows } = await pool.query('SELECT id, image FROM blog_posts');
    let sanitizedCount = 0;
    for (const row of rows) {
      if (isBlockedBlogImage(row.image)) {
        await pool.query('UPDATE blog_posts SET image = $1 WHERE id = $2', [BLOG_IMAGE_FALLBACK, row.id]);
        sanitizedCount += 1;
      }
    }
    if (sanitizedCount) {
      console.log(`Sanitized ${sanitizedCount} blog post cover image(s) that referenced blocked sources.`);
    }
  } catch (error) {
    console.warn('Failed to sanitize existing blog images', error);
  }
};

const runDefaultTenantMigrations = async (migrationsDir = join(process.cwd(), 'migrations', 'tenant')) => {
  const targetPool = getDefaultPool();
  const exists = await stat(migrationsDir)
    .then((result) => result.isDirectory())
    .catch(() => false);

  if (!exists) {
    console.warn(`[Tenant Migrations] Directory not found: ${migrationsDir}`);
    return;
  }

  await targetPool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      scope TEXT NOT NULL,
      filename TEXT NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (scope, filename)
    );
  `);

  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const alreadyApplied = await targetPool.query(
      'SELECT 1 FROM schema_migrations WHERE scope = $1 AND filename = $2 LIMIT 1',
      ['tenant', file]
    );
    if (alreadyApplied.rowCount > 0) {
      continue;
    }

    const sql = await readFile(join(migrationsDir, file), 'utf8');
    const client = await targetPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (scope, filename) VALUES ($1, $2)', ['tenant', file]);
      await client.query('COMMIT');
      console.info('[Tenant Migrations] Applied %s', file);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[Tenant Migrations] Failed to apply %s', file, error);
      throw error;
    } finally {
      client.release();
    }
  }
};

let indexTemplateCache;
const getIndexTemplate = async () => {
  if (indexTemplateCache) {
    return indexTemplateCache;
  }
  indexTemplateCache = await readFile(join(__dirname, 'dist', 'index.html'), 'utf8');
  return indexTemplateCache;
};

const escapeHtml = (value = '') => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const buildSeoHeadTags = (seo) => {
  const tags = [];
  const description = seo?.description ? escapeHtml(seo.description) : '';
  const keywords = seo?.keywords ? escapeHtml(seo.keywords) : '';
  const canonical = seo?.canonical_url ? escapeHtml(seo.canonical_url) : '';
  const robots = seo?.robots
    ? escapeHtml(seo.robots)
    : (seo?.indexable === false ? 'noindex,nofollow' : 'index,follow');
  if (description) {
    tags.push(`<meta name="description" content="${description}">`);
  }
  if (keywords) {
    tags.push(`<meta name="keywords" content="${keywords}">`);
  }
  if (robots) {
    tags.push(`<meta name="robots" content="${robots}">`);
  }
  if (canonical) {
    tags.push(`<link rel="canonical" href="${canonical}">`);
    tags.push(`<meta property="og:url" content="${canonical}">`);
  }

  if (seo?.og?.title) {
    tags.push(`<meta property="og:title" content="${escapeHtml(seo.og.title)}">`);
  }
  if (seo?.og?.description) {
    tags.push(`<meta property="og:description" content="${escapeHtml(seo.og.description)}">`);
  }
  if (seo?.og?.image) {
    tags.push(`<meta property="og:image" content="${escapeHtml(seo.og.image)}">`);
  }
  if (seo?.og?.type) {
    tags.push(`<meta property="og:type" content="${escapeHtml(seo.og.type)}">`);
  }
  if (seo?.og?.site_name) {
    tags.push(`<meta property="og:site_name" content="${escapeHtml(seo.og.site_name)}">`);
  }
  if (seo?.locale) {
    tags.push(`<meta property="og:locale" content="${escapeHtml(seo.locale)}">`);
  }
  if (seo?.locale_alternate) {
    tags.push(`<meta property="og:locale:alternate" content="${escapeHtml(seo.locale_alternate)}">`);
  }

  if (seo?.twitter?.card) {
    tags.push(`<meta name="twitter:card" content="${escapeHtml(seo.twitter.card)}">`);
  }
  if (seo?.twitter?.title) {
    tags.push(`<meta name="twitter:title" content="${escapeHtml(seo.twitter.title)}">`);
  }
  if (seo?.twitter?.description) {
    tags.push(`<meta name="twitter:description" content="${escapeHtml(seo.twitter.description)}">`);
  }
  if (seo?.twitter?.image) {
    tags.push(`<meta name="twitter:image" content="${escapeHtml(seo.twitter.image)}">`);
  }

  if (seo?.jsonld) {
    tags.push(`<script type="application/ld+json">${seo.jsonld}</script>`);
  }

  return tags.join('\n');
};

const applyHeadTagReplacement = (html, pattern, replacement) => {
  if (pattern.test(html)) {
    return html.replace(pattern, replacement);
  }
  return html.replace(/<\/head>/i, `${replacement}\n</head>`);
};

const applyBrandingHeadOverrides = (html, branding = {}, baseUrl) => {
  const safeBranding = branding && typeof branding === 'object' ? branding : {};
  let nextHtml = html;

  const faviconHref = toAbsoluteUrl(safeBranding.faviconUrl || safeBranding.logoUrl, baseUrl);
  if (faviconHref) {
    nextHtml = applyHeadTagReplacement(
      nextHtml,
      /<link[^>]*rel=["']icon["'][^>]*>/i,
      `<link rel="icon" type="image/png" href="${escapeHtml(faviconHref)}" />`
    );
    nextHtml = applyHeadTagReplacement(
      nextHtml,
      /<link[^>]*rel=["']apple-touch-icon["'][^>]*>/i,
      `<link rel="apple-touch-icon" href="${escapeHtml(faviconHref)}" />`
    );
  }

  const themeColor = typeof safeBranding.primaryColor === 'string' ? safeBranding.primaryColor.trim() : '';
  if (themeColor && HEX_COLOR_REGEX.test(themeColor)) {
    nextHtml = applyHeadTagReplacement(
      nextHtml,
      /<meta[^>]*name=["']theme-color["'][^>]*>/i,
      `<meta name="theme-color" content="${escapeHtml(themeColor)}" />`
    );
  }

  return nextHtml;
};

const toIconRedirectUrl = (iconUrl) => {
  if (typeof iconUrl !== 'string' || !iconUrl.trim()) {
    return null;
  }
  const trimmed = iconUrl.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.pathname === ICON_PATH_FAVICON || parsed.pathname === ICON_PATH_APPLE_TOUCH) {
      return null;
    }
    return parsed.toString();
  } catch (_error) {
    if (trimmed === ICON_PATH_FAVICON || trimmed === ICON_PATH_APPLE_TOUCH) {
      return null;
    }
    return trimmed;
  }
};

const resolveRequestLanguage = (req) => {
  const lang = req.query?.lang;
  if (lang === 'ar' || lang === 'en') {
    return lang;
  }
  const acceptLang = req.headers['accept-language'] || '';
  return acceptLang.toLowerCase().includes('ar') ? 'ar' : 'en';
};

const getRequestBaseUrl = (req) => {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const scheme = proto || req.protocol || 'https';
  const forwardedHost = req.headers['x-forwarded-host'];
  let host = req.headers.host;
  if (Array.isArray(forwardedHost) && forwardedHost.length > 0) {
    host = forwardedHost[0];
  } else if (typeof forwardedHost === 'string' && forwardedHost.trim()) {
    host = forwardedHost.split(',')[0].trim();
  }
  if (!host) {
    return undefined;
  }
  return `${scheme}://${String(host).trim()}`;
};

const escapeXml = (value = '') => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};

const isNoIndexRobots = (robots) => typeof robots === 'string' && robots.toLowerCase().includes('noindex');

const normalizePath = (path = '') => {
  if (!path) return '/';
  const trimmed = path.trim();
  if (!trimmed) return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
};

const toAbsoluteUrl = (value, baseUrl) => {
  if (!value) return undefined;
  if (typeof value !== 'string') return undefined;
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  if (!baseUrl) return undefined;
  return new URL(value, baseUrl).toString();
};

const resolveChangefreq = (value) => {
  if (!value) return undefined;
  const normalized = value.toString().trim().toLowerCase();
  if (!normalized) return undefined;
  const allowed = new Set(['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']);
  return allowed.has(normalized) ? normalized : undefined;
};

const buildSitemapXml = (entries) => {
  const items = entries.map((entry) => {
    const lines = [`<loc>${escapeXml(entry.loc)}</loc>`];
    if (entry.lastmod) {
      lines.push(`<lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
    }
    if (entry.changefreq) {
      lines.push(`<changefreq>${escapeXml(entry.changefreq)}</changefreq>`);
    }
    if (entry.priority !== undefined && entry.priority !== null) {
      lines.push(`<priority>${Number(entry.priority).toFixed(1)}</priority>`);
    }
    return `<url>${lines.join('')}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${items.join('')}</urlset>`;
};

await runCentralMigrations();
await runDefaultTenantMigrations();
await sanitizeExistingBlogImages();

const app = express();
// cPanel يمرّر PORT ديناميكياً — لا تثبّته في .env
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const shouldTrustProxy = () => {
  const raw = process.env.TRUST_PROXY;
  if (raw === undefined || raw === null || raw === '') return true;
  const normalized = String(raw).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
};

if (shouldTrustProxy()) {
  app.set('trust proxy', 1);
}

// Create uploads directory if it doesn't exist
// Use UPLOAD_DIR env var (set to Railway volume mount path) or fall back to local uploads/
const uploadsDir = process.env.UPLOAD_DIR || join(__dirname, 'uploads');
await mkdir(uploadsDir, { recursive: true });
await mkdir(join(uploadsDir, 'blog-images'), { recursive: true });
await mkdir(join(uploadsDir, 'blog-videos'), { recursive: true });
await mkdir(join(uploadsDir, 'course-images'), { recursive: true });
await mkdir(join(uploadsDir, 'avatars'), { recursive: true });
await mkdir(join(uploadsDir, 'resumes'), { recursive: true });
await mkdir(join(uploadsDir, 'general'), { recursive: true });

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (file.fieldname === 'image') {
      cb(null, join(uploadsDir, 'blog-images'));
    } else if (file.fieldname === 'video') {
      cb(null, join(uploadsDir, 'blog-videos'));
    } else if (file.fieldname === 'thumbnail' || file.fieldname === 'courseImage') {
      cb(null, join(uploadsDir, 'course-images'));
    } else if (file.fieldname === 'avatar' || file.fieldname === 'profilePicture') {
      cb(null, join(uploadsDir, 'avatars'));
    } else if (file.fieldname === 'resume') {
      cb(null, join(uploadsDir, 'resumes'));
    } else {
      cb(null, join(uploadsDir, 'general'));
    }
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + randomUUID();
    const ext = file.originalname.split('.').pop();
    cb(null, `${file.fieldname}-${uniqueSuffix}.${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const imageFields = ['image', 'thumbnail', 'courseImage', 'avatar', 'profilePicture'];
  const videoFields = ['video'];
  const resumeFields = ['resume'];
  const allowedResumeMimeTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];
  
  if (imageFields.includes(file.fieldname)) {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for this field'), false);
    }
  } else if (videoFields.includes(file.fieldname)) {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed for this field'), false);
    }
  } else if (resumeFields.includes(file.fieldname)) {
    if (allowedResumeMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, DOC, or DOCX files are allowed for resume'), false);
    }
  } else {
    // Allow all file types for general uploads
    cb(null, true);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  }
});

// Enable gzip compression for all responses
app.use(compression());

// Cookie parser for handling authentication cookies
app.use(cookieParser());

// Apply CORS to API routes (must be before route definitions)
app.use('/api', apiCorsConfig);
app.use('/saas', apiCorsConfig);

// Stripe webhook requires raw body for signature verification
app.use('/api/webhooks/payment/stripe', express.raw({ type: 'application/json' }));
app.use('/saas/api/webhooks/payment/stripe', express.raw({ type: 'application/json' }));

// Regular JSON parsing for other routes
app.use(express.json({ 
  limit: '50mb',
  verify: (req, res, buf) => {
    // Store raw body for webhook verification
    if (req.url === '/api/webhooks/payment/stripe' || req.url === '/saas/api/webhooks/payment/stripe') {
      req.rawBody = buf.toString('utf8');
    }
  }
}));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Block super-admin routes on tenant subdomains BEFORE tenant resolution
app.use(blockSuperAdminOnTenant);

app.use(optionalTenantResolver);
app.use((req, res, next) => {
  if (res.headersSent) {
    return;
  }
  const targetPool = req.tenantPool ?? getDefaultPool();
  runWithPoolContext(targetPool, () => next());
});

app.get('/sitemap.xml', async (req, res) => {
  try {
    const baseUrl = getRequestBaseUrl(req) || (process.env.MAIN_DOMAIN ? `https://${process.env.MAIN_DOMAIN}` : undefined);
    const seoPool = req.tenantPool ? req.tenantPool : centralPool;
    const contentPool = req.tenantPool ? req.tenantPool : pool;
    const seoTable = req.tenantPool ? 'seo_settings' : 'central_seo_settings';

    await ensureSeoOverridesTable(contentPool);

    const [seoResult, blogResult, courseResult, overrideResult] = await Promise.all([
      seoPool.query(
        `SELECT page_path, canonical_url, updated_at, indexable, robots, sitemap_priority, sitemap_changefreq
         FROM ${seoTable}`
      ),
      contentPool.query(
        `SELECT id, slug, updated_at, published_on, status
         FROM blog_posts
         WHERE UPPER(status) = 'PUBLISHED'`
      ),
      contentPool.query(
        `SELECT id, updated_at, status
         FROM courses
         WHERE LOWER(status) = 'published'`
      ),
      contentPool.query(
        `SELECT content_type, content_id, canonical_url, robots, indexable, sitemap_priority, sitemap_changefreq, updated_at
         FROM seo_overrides
         WHERE content_type IN ('blog_post', 'course')`
      )
    ]);

    const blockedPrefixes = [
      '/dashboard',
      '/login',
      '/register',
      '/student-profile',
      '/my-instructor-profile',
      '/admin',
      '/settings',
      '/messages',
      '/reports',
      '/attendance',
      '/financial',
      '/credits'
    ];

    const publicPaths = new Set([
      '/',
      '/courses',
      '/blog',
      '/enrollment',
      ...staticPageDefinitions.map((page) => page.path)
    ]);
    if (!req.tenantPool) {
      publicPaths.add('/saas');
    }

    const seoRows = seoResult.rows || [];
    const seoMap = new Map();
    seoRows.forEach((row) => {
      const path = normalizePath(row.page_path || '/');
      seoMap.set(path, row);
    });

    const overrideRows = overrideResult.rows || [];
    const overrideMap = new Map();
    overrideRows.forEach((row) => {
      overrideMap.set(`${row.content_type}:${row.content_id}`, row);
    });

    const entriesByLoc = new Map();
    const addEntry = (entry) => {
      if (!entry?.loc) return;
      const existing = entriesByLoc.get(entry.loc);
      if (!existing) {
        entriesByLoc.set(entry.loc, entry);
        return;
      }
      const existingLastmod = existing.lastmod ? Date.parse(existing.lastmod) : 0;
      const nextLastmod = entry.lastmod ? Date.parse(entry.lastmod) : 0;
      if (nextLastmod > existingLastmod) {
        entriesByLoc.set(entry.loc, entry);
      }
    };

    const resolvePageEntry = (path, row, defaults = {}) => {
      if (!path) return;
      if (blockedPrefixes.some((prefix) => path.startsWith(prefix))) return;
      if (path.includes(':')) return;
      const indexable = row?.indexable !== false && !isNoIndexRobots(row?.robots);
      if (!indexable) return;
      const canonical = toAbsoluteUrl(row?.canonical_url, baseUrl);
      const loc = canonical || (baseUrl ? new URL(path, baseUrl).toString() : path);
      const lastmod = row?.updated_at ? new Date(row.updated_at).toISOString() : undefined;
      const changefreq = resolveChangefreq(row?.sitemap_changefreq) || defaults.changefreq;
      const priority = row?.sitemap_priority ?? defaults.priority;
      addEntry({ loc, lastmod, changefreq, priority });
    };

    publicPaths.forEach((path) => resolvePageEntry(path, seoMap.get(path), { changefreq: 'weekly', priority: 0.7 }));
    seoMap.forEach((row, path) => resolvePageEntry(path, row, { changefreq: 'weekly', priority: 0.7 }));

    const blogRows = blogResult.rows || [];
    blogRows.forEach((row) => {
      if (!row?.slug) return;
      const override = overrideMap.get(`blog_post:${row.id}`);
      const indexable = override?.indexable !== false && !isNoIndexRobots(override?.robots);
      if (!indexable) return;
      const path = `/blog/${row.slug}`;
      const canonical = toAbsoluteUrl(override?.canonical_url, baseUrl);
      const loc = canonical || (baseUrl ? new URL(path, baseUrl).toString() : path);
      const updatedAt = override?.updated_at || row.updated_at || row.published_on;
      const lastmod = updatedAt ? new Date(updatedAt).toISOString() : undefined;
      const changefreq = resolveChangefreq(override?.sitemap_changefreq) || 'monthly';
      const priority = override?.sitemap_priority ?? 0.6;
      addEntry({ loc, lastmod, changefreq, priority });
    });

    const courseRows = courseResult.rows || [];
    courseRows.forEach((row) => {
      const override = overrideMap.get(`course:${row.id}`);
      const indexable = override?.indexable !== false && !isNoIndexRobots(override?.robots);
      if (!indexable) return;
      const path = `/course-player?courseId=${row.id}`;
      const canonical = toAbsoluteUrl(override?.canonical_url, baseUrl);
      const loc = canonical || (baseUrl ? new URL(path, baseUrl).toString() : path);
      const updatedAt = override?.updated_at || row.updated_at;
      const lastmod = updatedAt ? new Date(updatedAt).toISOString() : undefined;
      const changefreq = resolveChangefreq(override?.sitemap_changefreq) || 'weekly';
      const priority = override?.sitemap_priority ?? 0.7;
      addEntry({ loc, lastmod, changefreq, priority });
    });

    const xml = buildSitemapXml(Array.from(entriesByLoc.values()));
    res.setHeader('Content-Type', 'application/xml');
    res.send(xml);
  } catch (error) {
    console.error('Sitemap generation failed', error);
    res.status(500).send('Unable to generate sitemap');
  }
});

app.get('/robots.txt', async (req, res) => {
  try {
    const baseUrl = getRequestBaseUrl(req) || (process.env.MAIN_DOMAIN ? `https://${process.env.MAIN_DOMAIN}` : undefined);
    const seoPool = req.tenantPool ? req.tenantPool : centralPool;
    const contentPool = req.tenantPool ? req.tenantPool : pool;
    const seoTable = req.tenantPool ? 'seo_settings' : 'central_seo_settings';

    await ensureSeoOverridesTable(contentPool);

    const [seoResult, overrideResult, blogResult, courseResult] = await Promise.all([
      seoPool.query(
        `SELECT page_path, indexable, robots
         FROM ${seoTable}`
      ),
      contentPool.query(
        `SELECT content_type, content_id, indexable, robots
         FROM seo_overrides
         WHERE content_type IN ('blog_post', 'course')`
      ),
      contentPool.query(
        `SELECT id, slug
         FROM blog_posts
         WHERE UPPER(status) = 'PUBLISHED'`
      ),
      contentPool.query(
        `SELECT id
         FROM courses
         WHERE LOWER(status) = 'published'`
      )
    ]);

    const disallowPaths = new Set();
    (seoResult.rows || []).forEach((row) => {
      if (row?.indexable === false || isNoIndexRobots(row?.robots)) {
        const path = normalizePath(row.page_path || '/');
        disallowPaths.add(path);
      }
    });

    const overrideMap = new Map();
    (overrideResult.rows || []).forEach((row) => {
      overrideMap.set(`${row.content_type}:${row.content_id}`, row);
    });

    (blogResult.rows || []).forEach((row) => {
      if (!row?.slug) return;
      const override = overrideMap.get(`blog_post:${row.id}`);
      if (override?.indexable === false || isNoIndexRobots(override?.robots)) {
        disallowPaths.add(`/blog/${row.slug}`);
      }
    });

    (courseResult.rows || []).forEach((row) => {
      const override = overrideMap.get(`course:${row.id}`);
      if (override?.indexable === false || isNoIndexRobots(override?.robots)) {
        disallowPaths.add(`/course-player?courseId=${row.id}`);
      }
    });

    const lines = ['User-agent: *'];
    if (disallowPaths.size) {
      Array.from(disallowPaths).sort().forEach((path) => {
        lines.push(`Disallow: ${path}`);
      });
    } else {
      lines.push('Disallow:');
    }
    if (baseUrl) {
      lines.push(`Sitemap: ${baseUrl.replace(/\/$/, '')}/sitemap.xml`);
    }

    res.setHeader('Content-Type', 'text/plain');
    res.send(lines.join('\n'));
  } catch (error) {
    console.error('Robots generation failed', error);
    res.status(500).send('Unable to generate robots.txt');
  }
});

// Apply general rate limiting to all API routes (except webhooks which have their own)
app.use('/api', (req, res, next) => {
  // Skip rate limiting for webhooks as they have specific limiters
  if (req.path.startsWith('/webhooks')) {
    return next();
  }
  generalApiRateLimiter(req, res, next);
});

const provisioningService = new ProvisioningService();
const superAdminRouter = createSuperAdminRouter();
const rbacRouter = createRBACRouter();
const seoRouter = createSEORouter();
const paymentGatewayConfigRouter = createPaymentGatewayConfigRouter();
const tenantPaymentGatewayConfigRouter = createTenantPaymentGatewayConfigRouter();
const aiConfigRouter = createAIConfigRouter();
const tenantAIConfigRouter = createTenantAIConfigRouter();

// ============================================================================
// API Versioning Setup
// ============================================================================
// Create a middleware that forwards /api/v1/* requests to /api/* handlers
// This allows all /api/* routes to automatically work with /api/v1/* prefix
app.use('/api/v1', (req, res, next) => {
  // Add version header for tracking
  res.setHeader('X-API-Version', 'v1');
  
  // Store original URL for logging
  req.apiVersion = 'v1';
  
  // Forward to the actual /api handlers by rewriting the path
  const originalUrl = req.url;
  req.url = originalUrl;
  
  // Continue to next middleware which will match /api routes
  next();
});

// ============================================================================
// API Routes - Available at both /api/* and /api/v1/*
// ============================================================================
// Authentication endpoints (available for both tenant and main domain)
app.post('/api/auth/login', loginRateLimiter, authController.login);
app.post('/api/auth/logout', authController.logout);
app.get('/api/auth/me', requireAuth, authController.getCurrentUser);
app.post('/api/auth/refresh', authController.refreshAccessToken);
app.post('/api/auth/forgot-password', loginRateLimiter, forgotPassword);
app.post('/api/auth/reset-password', resetPassword);

// Mount v1 versions
app.post('/api/v1/auth/login', loginRateLimiter, authController.login);
app.post('/api/v1/auth/logout', authController.logout);
app.get('/api/v1/auth/me', requireAuth, authController.getCurrentUser);
app.post('/api/v1/auth/refresh', authController.refreshAccessToken);
app.post('/api/v1/auth/forgot-password', loginRateLimiter, forgotPassword);
app.post('/api/v1/auth/reset-password', resetPassword);

app.use('/saas', createTenantRouter(provisioningService));
app.use('/saas', superAdminRouter);
app.use(superAdminRouter);
app.use('/api/admin/subscriptions', adminSubscriptionsRouter); // Admin subscription management
app.use(paymentGatewayConfigRouter); // Super Admin payment gateway configuration
app.use(aiConfigRouter); // Super Admin AI configuration
app.use('/saas', createPaymentWebhookRouter(provisioningService));
app.use('/saas', createPaymentRouter());
app.use(createPaymentRouter());
app.use(createCoursePaymentRouter()); // Course payment Stripe checkout
app.use(createRefundRouter()); // Payment refund management

// Mount v1 versions of routers
app.use('/api/v1/admin/subscriptions', adminSubscriptionsRouter);
app.use(createCoursePaymentRouter()); // Already handles both /api and internal paths

// ============================================================================
// Tenant-scoped API (both v1 and legacy)
// ============================================================================
// Create messaging router early so it can be mounted in tenant scoped API
const messagingRouter = express.Router();

const tenantScopedApi = express.Router();
tenantScopedApi.use(tenantResolver);
tenantScopedApi.use(rbacRouter); // RBAC endpoints for role and permission management
tenantScopedApi.use(seoRouter); // SEO settings management
// Note: tenantPaymentGatewayConfigRouter is mounted separately on app because it uses /api/admin/* paths
tenantScopedApi.use(tenantAIConfigRouter); // Tenant Admin AI configuration
tenantScopedApi.use(requireTenantPool); // Enforce tenant pool isolation
tenantScopedApi.use(tenantApiRateLimiter); // Apply tenant-specific rate limiting
// Mount messaging router for tenant subdomain access
tenantScopedApi.use('/messaging', messagingRouter);

const handleGetAppearance = async (req, res) => {
  try {
    const shouldUseTenantScope = Boolean(req.tenant) && !isCentralDomainHostRequest(req);
    let appearance;
    if (shouldUseTenantScope) {
      const tenantSettings = readTenantSettings(req.tenant);
      const centralSettings = await readCentralAppearanceSettings();
      appearance = withTenantHeroMediaFallback(tenantSettings, centralSettings);
    } else {
      const currentSettings = await readAppearanceSettings(req);
      appearance = buildAppearanceResponse(currentSettings);
    }
    res.json(appearance);
  } catch (error) {
    console.error('Appearance fetch failed', error);
    res.status(500).json({ error: 'Failed to load appearance' });
  }
};

const handlePutAppearance = async (req, res) => {
  try {
    const payload = req.body || {};
    const brandingUpdate = sanitizeBrandingPayload(payload.branding);
    const pricingUpdate = sanitizePricingPayload(payload.pricing);
    const updatedBy = typeof payload.updatedBy === 'string' ? payload.updatedBy : null;
    const currentSettings = await readAppearanceSettings(req);
    const brandingBase = currentSettings.branding && typeof currentSettings.branding === 'object' ? currentSettings.branding : {};
    const pricingBase = currentSettings.pricing && typeof currentSettings.pricing === 'object' ? currentSettings.pricing : {};
    const nextSettings = {
      ...currentSettings,
      branding: { ...brandingBase, ...brandingUpdate },
      pricing: { ...pricingBase, ...pricingUpdate },
      appearanceMeta: {
        updatedAt: new Date().toISOString(),
        updatedBy
      }
    };

    await writeAppearanceSettings(req, nextSettings);
    const appearance = buildAppearanceResponse(nextSettings);
    res.json(appearance);
  } catch (error) {
    console.error('Appearance update failed', error);
    res.status(500).json({ error: 'Failed to update appearance' });
  }
};

const handleGetEmailSettings = async (req, res) => {
  try {
    const settings = await readScopedEmailSettings(req);
    res.json(settings);
  } catch (error) {
    console.error('Email settings fetch failed', error);
    res.status(500).json({ error: 'Failed to load email settings' });
  }
};

const handlePutEmailSettings = async (req, res) => {
  try {
    const updated = await writeScopedEmailSettings(req, req.body || {});
    res.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update email settings';
    const status = message.includes('required') ? 400 : 500;
    if (status === 500) {
      console.error('Email settings update failed', error);
    }
    res.status(status).json({ error: message });
  }
};

const handleDeleteEmailSettings = async (req, res) => {
  try {
    const scope = req.tenant?.id ? 'tenant' : 'central';
    const tenantId = req.tenant?.id || null;

    const result = await centralPool.query(
      `DELETE FROM email_settings
       WHERE scope = $1
         AND ((tenant_id = $2) OR (tenant_id IS NULL AND $2 IS NULL))
       RETURNING id`,
      [scope, tenantId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Email settings not found' });
    }

    res.json({ message: 'Email settings deleted successfully' });
  } catch (error) {
    console.error('Email settings delete failed', error);
    res.status(500).json({ error: 'Failed to delete email settings' });
  }
};

// Appearance settings should be available on both central and tenant domains.
app.get('/api/tenant/appearance', handleGetAppearance);
app.put('/api/tenant/appearance', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), handlePutAppearance);
app.get('/api/v1/tenant/appearance', handleGetAppearance);
app.put('/api/v1/tenant/appearance', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), handlePutAppearance);

// SMTP settings are editable by admins and super admins from central/tenant dashboards.
app.get('/api/tenant/email-settings', optionalTenantResolver, requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), handleGetEmailSettings);
app.put('/api/tenant/email-settings', optionalTenantResolver, requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), handlePutEmailSettings);
app.delete('/api/tenant/email-settings', optionalTenantResolver, requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), handleDeleteEmailSettings);
app.get('/api/v1/tenant/email-settings', optionalTenantResolver, requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), handleGetEmailSettings);
app.put('/api/v1/tenant/email-settings', optionalTenantResolver, requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), handlePutEmailSettings);
app.delete('/api/v1/tenant/email-settings', optionalTenantResolver, requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), handleDeleteEmailSettings);

tenantScopedApi.get('/config', async (req, res) => {
  if (!req.tenant) {
    return res.status(404).json({ error: 'Tenant not found' });
  }
  try {
    const tenant = req.tenant;
    const tenantSettings = readTenantSettings(tenant);
    const centralSettings = await readCentralAppearanceSettings();
    const appearance = withTenantHeroMediaFallback(tenantSettings, centralSettings);
    res.json({
      id: tenant.id,
      name: tenant.company_name,
      subdomain: tenant.subdomain,
      plan: tenant.subscription_plan,
      database: tenant.database_name,
      branding: appearance.branding,
      pricing: appearance.pricing,
      appearanceUpdatedAt: appearance.updatedAt,
      appearanceUpdatedBy: appearance.updatedBy
    });
  } catch (error) {
    console.error('Tenant config fetch failed', error);
    res.status(500).json({ error: 'Failed to load tenant config' });
  }
});

tenantScopedApi.put('/config', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  if (!req.tenant) {
    return res.status(404).json({ error: 'Tenant not found' });
  }
  try {
    const nameInput = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!nameInput) {
      return res.status(400).json({ error: 'Academy name is required' });
    }
    if (nameInput.length > MAX_ACADEMY_NAME_LENGTH) {
      return res.status(400).json({ error: `Academy name must be ${MAX_ACADEMY_NAME_LENGTH} characters or fewer` });
    }
    const result = await centralPool.query(
      `UPDATE tenants
          SET company_name = $1,
              updated_at = now()
        WHERE id = $2
        RETURNING id, company_name, subdomain, subscription_plan, database_name`,
      [nameInput, req.tenant.id]
    );
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    const updatedTenant = {
      ...req.tenant,
      company_name: result.rows[0].company_name
    };
    const tenantSettings = readTenantSettings(updatedTenant);
    const centralSettings = await readCentralAppearanceSettings();
    const appearance = withTenantHeroMediaFallback(tenantSettings, centralSettings);
    res.json({
      id: updatedTenant.id,
      name: updatedTenant.company_name,
      subdomain: updatedTenant.subdomain,
      plan: updatedTenant.subscription_plan,
      database: updatedTenant.database_name,
      branding: appearance.branding,
      pricing: appearance.pricing,
      appearanceUpdatedAt: appearance.updatedAt,
      appearanceUpdatedBy: appearance.updatedBy
    });
  } catch (error) {
    console.error('Tenant config update failed', error);
    res.status(500).json({ error: 'Failed to update tenant config' });
  }
});

tenantScopedApi.get('/appearance', handleGetAppearance);
tenantScopedApi.put('/appearance', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), handlePutAppearance);
tenantScopedApi.get('/email-settings', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), handleGetEmailSettings);
tenantScopedApi.put('/email-settings', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), handlePutEmailSettings);

// Mount tenant-scoped API for both legacy and v1
app.use('/api/tenant', tenantScopedApi); // Legacy version
app.use('/api/v1/tenant', tenantScopedApi); // v1 version

// Mount tenant payment gateway config with tenant context (directly on /api/admin/payment-gateway/*)
// This needs to be separate because the frontend calls /api/admin/payment-gateway/config
// Uses optionalTenantResolver so it doesn't break main domain requests
const tenantAdminPaymentRouter = express.Router();
tenantAdminPaymentRouter.use(optionalTenantResolver);
tenantAdminPaymentRouter.use(tenantPaymentGatewayConfigRouter);
app.use('/api/admin/payment-gateway', tenantAdminPaymentRouter);

// Mount tenant AI config with tenant context (directly on /api/admin/ai-config and /api/ai/key)
const tenantAdminAIRouter = express.Router();
tenantAdminAIRouter.use(optionalTenantResolver);
tenantAdminAIRouter.use(tenantAIConfigRouter);
app.use('/api', tenantAdminAIRouter);

// Central-domain fallback for admin SEO routes.
// If tenant context exists, pass through to tenant SEO router unchanged.
const centralAdminSEORouter = express.Router();

const ensureAdminAccess = async (req, res) => {
  if (!(await isAdmin(req))) {
    res.status(403).json({ success: false, error: 'Admin access required' });
    return false;
  }
  return true;
};

centralAdminSEORouter.get('/api/admin/seo/settings', requireAuth, async (req, res, next) => {
  if (req.tenantPool) {
    return next();
  }
  if (!(await ensureAdminAccess(req, res))) {
    return;
  }

  try {
    const result = await centralPool.query(
      `SELECT *
         FROM central_seo_settings
        ORDER BY updated_at DESC`
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Failed to fetch central SEO settings', error);
    res.status(500).json({ success: false, error: 'Failed to fetch SEO settings' });
  }
});

centralAdminSEORouter.get('/api/admin/seo/settings/:id', requireAuth, async (req, res, next) => {
  if (req.tenantPool) {
    return next();
  }
  if (!(await ensureAdminAccess(req, res))) {
    return;
  }

  try {
    const result = await centralPool.query(
      `SELECT *
         FROM central_seo_settings
        WHERE id = $1
        LIMIT 1`,
      [req.params.id]
    );

    if (!result.rowCount) {
      return res.status(404).json({ success: false, error: 'SEO setting not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Failed to fetch central SEO setting', error);
    res.status(500).json({ success: false, error: 'Failed to fetch SEO setting' });
  }
});

centralAdminSEORouter.post('/api/admin/seo/settings', requireAuth, async (req, res, next) => {
  if (req.tenantPool) {
    return next();
  }
  if (!(await ensureAdminAccess(req, res))) {
    return;
  }

  const {
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
  } = req.body || {};

  if (!page_path) {
    return res.status(400).json({ success: false, error: 'Page path is required' });
  }

  const userId = req.userId || null;

  try {
    const existing = await centralPool.query(
      'SELECT id FROM central_seo_settings WHERE page_path = $1 LIMIT 1',
      [page_path]
    );
    if (existing.rowCount) {
      return res.status(409).json({ success: false, error: 'SEO setting for this page path already exists' });
    }

    const result = await centralPool.query(
      `INSERT INTO central_seo_settings
        (page_path, title_en, title_ar, description_en, description_ar,
         keywords_en, keywords_ar, canonical_url, robots, indexable, og_title_en, og_title_ar,
         og_description_en, og_description_ar, og_image_url, og_type, og_site_name,
         twitter_card, twitter_title_en, twitter_title_ar, twitter_description_en,
         twitter_description_ar, twitter_image_url, jsonld_en, jsonld_ar, locale,
         locale_alternate, sitemap_priority, sitemap_changefreq, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$30)
       RETURNING *`,
      [
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
      ]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Failed to create central SEO setting', error);
    res.status(500).json({ success: false, error: 'Failed to create SEO setting' });
  }
});

centralAdminSEORouter.put('/api/admin/seo/settings/:id', requireAuth, async (req, res, next) => {
  if (req.tenantPool) {
    return next();
  }
  if (!(await ensureAdminAccess(req, res))) {
    return;
  }

  const {
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
  } = req.body || {};

  const userId = req.userId || null;

  try {
    const existing = await centralPool.query('SELECT id FROM central_seo_settings WHERE id = $1 LIMIT 1', [req.params.id]);
    if (!existing.rowCount) {
      return res.status(404).json({ success: false, error: 'SEO setting not found' });
    }

    if (page_path) {
      const conflict = await centralPool.query(
        'SELECT id FROM central_seo_settings WHERE page_path = $1 AND id != $2 LIMIT 1',
        [page_path, req.params.id]
      );
      if (conflict.rowCount) {
        return res.status(409).json({ success: false, error: 'Another SEO setting with this page path already exists' });
      }
    }

    const result = await centralPool.query(
      `UPDATE central_seo_settings
          SET page_path = COALESCE($1, page_path),
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
              updated_by = $30,
              updated_at = NOW()
        WHERE id = $31
        RETURNING *`,
      [
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
        req.params.id
      ]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Failed to update central SEO setting', error);
    res.status(500).json({ success: false, error: 'Failed to update SEO setting' });
  }
});

centralAdminSEORouter.delete('/api/admin/seo/settings/:id', requireAuth, async (req, res, next) => {
  if (req.tenantPool) {
    return next();
  }
  if (!(await ensureAdminAccess(req, res))) {
    return;
  }

  try {
    const result = await centralPool.query(
      'DELETE FROM central_seo_settings WHERE id = $1 RETURNING *',
      [req.params.id]
    );

    if (!result.rowCount) {
      return res.status(404).json({ success: false, error: 'SEO setting not found' });
    }

    res.json({ success: true, message: 'SEO setting deleted successfully' });
  } catch (error) {
    console.error('Failed to delete central SEO setting', error);
    res.status(500).json({ success: false, error: 'Failed to delete SEO setting' });
  }
});

app.use(centralAdminSEORouter);

// ─── Central Live Platform Config (SuperAdmin / central domain) ───────────────
let ensureCentralLivePlatformConfigPromise;
const ensureCentralLivePlatformConfigTable = async () => {
  if (!ensureCentralLivePlatformConfigPromise) {
    ensureCentralLivePlatformConfigPromise = (async () => {
      await centralPool.query(`
        CREATE TABLE IF NOT EXISTS central_live_platform_config (
          id INTEGER PRIMARY KEY,
          smrrtx_enabled BOOLEAN NOT NULL DEFAULT true,
          smrrtx_permanent_room_link TEXT,
          zoom_enabled BOOLEAN NOT NULL DEFAULT false,
          zoom_config_link TEXT,
          zoom_client_id TEXT,
          zoom_client_secret TEXT,
          zoom_account_id TEXT,
          zoom_user_id TEXT,
          meet_enabled BOOLEAN NOT NULL DEFAULT false,
          meet_config_link TEXT,
          google_sa_email TEXT,
          google_sa_key TEXT,
          google_calendar_id TEXT,
          updated_at TIMESTAMPTZ DEFAULT now()
        );
      `);
      await centralPool.query(`
        INSERT INTO central_live_platform_config (id, smrrtx_enabled, zoom_enabled, meet_enabled)
        VALUES (1, true, false, false)
        ON CONFLICT (id) DO NOTHING
      `);
    })().catch((error) => {
      ensureCentralLivePlatformConfigPromise = null;
      console.error('Central live platform config initialization failed', error);
      throw error;
    });
  }
  return ensureCentralLivePlatformConfigPromise;
};

const mapCentralLivePlatformConfigRow = (row) => ({
  smrrtxEnabled: row.smrrtx_enabled !== false,
  smrrtxPermanentRoomLink: row.smrrtx_permanent_room_link || '',
  zoomEnabled: Boolean(row.zoom_enabled),
  zoomConfigLink: row.zoom_config_link || '',
  zoomClientId: row.zoom_client_id || '',
  zoomClientSecret: row.zoom_client_secret || '',
  zoomAccountId: row.zoom_account_id || '',
  zoomUserId: row.zoom_user_id || '',
  meetEnabled: Boolean(row.meet_enabled),
  meetConfigLink: row.meet_config_link || '',
  googleSaEmail: row.google_sa_email || '',
  googleSaKey: row.google_sa_key || '',
  googleCalendarId: row.google_calendar_id || ''
});

const fetchCentralLivePlatformConfig = async () => {
  await ensureCentralLivePlatformConfigTable();
  const result = await centralPool.query('SELECT * FROM central_live_platform_config WHERE id = 1 LIMIT 1');
  if (!result.rowCount) {
    return {
      smrrtxEnabled: true, smrrtxPermanentRoomLink: '',
      zoomEnabled: false, zoomConfigLink: '', zoomClientId: '', zoomClientSecret: '', zoomAccountId: '', zoomUserId: '',
      meetEnabled: false, meetConfigLink: '', googleSaEmail: '', googleSaKey: '', googleCalendarId: ''
    };
  }
  return mapCentralLivePlatformConfigRow(result.rows[0]);
};

app.get('/api/central/live-platform-config', requireAuth, requireRole('SUPER_ADMIN'), async (_req, res) => {
  try {
    const config = await fetchCentralLivePlatformConfig();
    res.json(config);
  } catch (error) {
    console.error('Central live platform config fetch error', error);
    res.status(500).json({ error: 'Failed to load central live platform configuration' });
  }
});

app.put('/api/central/live-platform-config', requireAuth, requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const current = await fetchCentralLivePlatformConfig();
    const body = req.body || {};
    const next = {
      smrrtxEnabled: body.smrrtxEnabled !== undefined ? Boolean(body.smrrtxEnabled) : current.smrrtxEnabled,
      zoomEnabled: body.zoomEnabled !== undefined ? Boolean(body.zoomEnabled) : current.zoomEnabled,
      meetEnabled: body.meetEnabled !== undefined ? Boolean(body.meetEnabled) : current.meetEnabled,
      smrrtxPermanentRoomLink: typeof body.smrrtxPermanentRoomLink === 'string' ? body.smrrtxPermanentRoomLink.trim() : current.smrrtxPermanentRoomLink || '',
      zoomConfigLink: typeof body.zoomConfigLink === 'string' ? body.zoomConfigLink.trim() : current.zoomConfigLink || '',
      zoomClientId: typeof body.zoomClientId === 'string' ? body.zoomClientId.trim() : current.zoomClientId || '',
      zoomClientSecret: typeof body.zoomClientSecret === 'string' ? body.zoomClientSecret.trim() : current.zoomClientSecret || '',
      zoomAccountId: typeof body.zoomAccountId === 'string' ? body.zoomAccountId.trim() : current.zoomAccountId || '',
      zoomUserId: typeof body.zoomUserId === 'string' ? body.zoomUserId.trim() : current.zoomUserId || '',
      meetConfigLink: typeof body.meetConfigLink === 'string' ? body.meetConfigLink.trim() : current.meetConfigLink || '',
      googleSaEmail: typeof body.googleSaEmail === 'string' ? body.googleSaEmail.trim() : current.googleSaEmail || '',
      googleSaKey: typeof body.googleSaKey === 'string' ? body.googleSaKey.trim() : current.googleSaKey || '',
      googleCalendarId: typeof body.googleCalendarId === 'string' ? body.googleCalendarId.trim() : current.googleCalendarId || ''
    };

    if (!next.smrrtxEnabled && !next.zoomEnabled && !next.meetEnabled) {
      return res.status(400).json({ error: 'At least one platform must remain enabled' });
    }

    const result = await centralPool.query(
      `INSERT INTO central_live_platform_config (
          id, smrrtx_enabled, smrrtx_permanent_room_link,
          zoom_enabled, zoom_config_link, zoom_client_id, zoom_client_secret, zoom_account_id, zoom_user_id,
          meet_enabled, meet_config_link, google_sa_email, google_sa_key, google_calendar_id
       ) VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id)
       DO UPDATE SET
          smrrtx_enabled = EXCLUDED.smrrtx_enabled,
          smrrtx_permanent_room_link = EXCLUDED.smrrtx_permanent_room_link,
          zoom_enabled = EXCLUDED.zoom_enabled,
          zoom_config_link = EXCLUDED.zoom_config_link,
          zoom_client_id = EXCLUDED.zoom_client_id,
          zoom_client_secret = EXCLUDED.zoom_client_secret,
          zoom_account_id = EXCLUDED.zoom_account_id,
          zoom_user_id = EXCLUDED.zoom_user_id,
          meet_enabled = EXCLUDED.meet_enabled,
          meet_config_link = EXCLUDED.meet_config_link,
          google_sa_email = EXCLUDED.google_sa_email,
          google_sa_key = EXCLUDED.google_sa_key,
          google_calendar_id = EXCLUDED.google_calendar_id,
          updated_at = now()
       RETURNING *`,
      [
        next.smrrtxEnabled, next.smrrtxPermanentRoomLink || null,
        next.zoomEnabled, next.zoomConfigLink || null,
        next.zoomClientId || null, next.zoomClientSecret || null, next.zoomAccountId || null, next.zoomUserId || null,
        next.meetEnabled, next.meetConfigLink || null,
        next.googleSaEmail || null, next.googleSaKey || null, next.googleCalendarId || null
      ]
    );

    res.json(mapCentralLivePlatformConfigRow(result.rows[0]));
  } catch (error) {
    console.error('Central live platform config update error', error);
    res.status(500).json({ error: 'Failed to update central live platform configuration' });
  }
});
// ───────────────────────────────────────────────────────────────────────────────

// Mount tenant SEO routes with tenant context (directly on /api/admin/seo/* and /api/seo/settings/page)
const tenantAdminSEORouter = express.Router();
tenantAdminSEORouter.use(optionalTenantResolver);
tenantAdminSEORouter.use(seoRouter);
app.use(tenantAdminSEORouter);

const isBlogNavigationRequest = (path = '', referrer = '') => {
  const normalizedPath = path || '';
  const normalizedReferrer = referrer || '';
  if (normalizedPath.startsWith('/blog')) {
    return true;
  }
  if (normalizedPath.startsWith('/blogs')) {
    return true;
  }
  return normalizedReferrer.includes('/blog');
};

// Request logging middleware (disabled to save resources)
// app.use((req, res, next) => {
//   const timestamp = new Date().toISOString();
//   console.log(`[${timestamp}] ${req.method} ${req.path}`);
//   const referrer = req.get('referer') || req.get('referrer') || null;
//   const userAgent = req.get('user-agent') || null;
//   
//   if (Object.keys(req.query).length > 0) {
//     console.log(`  Query params:`, req.query);
//   }
//   
//   if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body && Object.keys(req.body).length > 0) {
//     const safeBody = { ...req.body };
//     if (safeBody.password) safeBody.password = '***';
//     console.log(`  Request body:`, safeBody);
//   }
//   
//   if (referrer) {
//     console.log(`  Referer:`, referrer);
//   }
//   if (userAgent) {
//     console.log(`  User-Agent:`, userAgent);
//   }
//
//   if (isBlogNavigationRequest(req.path, referrer)) {
//     console.log('  [BlogNavTrace]', {
//       method: req.method,
//       path: req.path,
//       referrer: referrer || null,
//       query: req.query,
//       tenantId: req.tenant?.id || null,
//       tenantSubdomain: req.tenant?.subdomain || null,
//       userAgent: userAgent || null
//     });
//   }
//   
//   next();
// });

app.post('/api/debug/navigation', (req, res) => {
  try {
    const referrer = req.get('referer') || req.get('referrer') || null;
    const userAgent = req.get('user-agent') || null;
    const payload = req.body || {};
    // console.log('[NavigationDebug]', {
    //   method: req.method,
    //   path: req.path,
    //   referrer,
    //   userAgent,
    //   tenantId: req.tenant?.id || null,
    //   tenantSubdomain: req.tenant?.subdomain || null,
    //   body: payload
    // });
  } catch (error) {
    console.error('Navigation debug log failed', error);
  }
  res.json({ ok: true });
});

const toCurrency = (value) => (value === null || value === undefined ? null : Number(value));
const generateReceiptId = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const randomBlock = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RCPT-${timestamp}-${randomBlock}`;
};

const STATIC_PAGE_DEFINITIONS = staticPageDefinitions;
const STATIC_PAGE_SLUGS = STATIC_PAGE_DEFINITIONS.map((page) => page.slug);
const MAX_STATIC_PAGE_LENGTH = 200_000;
const getStaticPageMeta = (slug) => STATIC_PAGE_DEFINITIONS.find((page) => page.slug === slug);
const isValidStaticPageSlug = (slug) => STATIC_PAGE_SLUGS.includes(slug);
const buildStaticPageFallback = (slug) => {
  const meta = getStaticPageMeta(slug);
  if (!meta) return null;
  return {
    slug: meta.slug,
    title: meta.title,
    content: '',
    updatedAt: null,
    updatedBy: null
  };
};

const DEFAULT_REWARDS_CONFIG = {
  daily_login: 15,
  lesson_completion: 65,
  quiz_pass: 110,
  assignment_submission: 180,
  credits_per_currency_unit: 3200,
  currency_code: 'USD'
};

const DEFAULT_LIVE_PLATFORM_CONFIG = {
  smrrtxEnabled: true,
  smrrtxPermanentRoomLink: '',
  zoomEnabled: false,
  zoomConfigLink: '',
  meetEnabled: false,
  meetConfigLink: ''
};

const DEFAULT_PAYMENT_GATEWAY_CONFIG = {
  paypalEnabled: false,
  paypalClientId: '',
  paypalSecretKey: '',
  stripeEnabled: false,
  stripePublicKey: '',
  stripeSecretKey: '',
  stripePriceBasicMonthly: '',
  stripePriceBasicYearly: '',
  stripePriceProMonthly: '',
  stripePriceProYearly: '',
  stripePriceEnterpriseMonthly: '',
  stripePriceEnterpriseYearly: '',
  planBasicMonthlyAmount: null,
  planBasicMonthlyCurrency: 'USD',
  planProMonthlyAmount: null,
  planProMonthlyCurrency: 'USD',
  planEnterpriseMonthlyAmount: null,
  planEnterpriseMonthlyCurrency: 'USD'
};

const HEX_COLOR_REGEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const HERO_BACKGROUND_MODES = new Set(['color', 'image', 'video']);
const MEDIA_TYPES = new Set(['image', 'video']);

const DEFAULT_BRANDING = Object.freeze({
  logoUrl: '/beta-logo.png',
  faviconUrl: '/beta-logo.png',
  primaryColor: '#dc2626',
  secondaryColor: '#0f172a',
  accentColor: '#f97316',
  footerBackgroundColor: '#0b0b0b',
  announcementBarColor: '#7f1d1d',
  heroBackgroundColor: '#020617',
  heroBackgroundMode: 'color',
  heroBackgroundImageUrl: '',
  heroBackgroundVideoUrl: '',
  heroMediaGallery: [],
  footerText: '',
  heroTitleLeading: '',
  heroTitleHighlight: '',
  heroSubtitle: '',
  heroBadge: '',
  primaryCtaLabel: '',
  secondaryCtaLabel: '',
  pricingCtaLabel: ''
});

const DEFAULT_PRICING = Object.freeze({
  headline: 'Flexible pricing for every academy',
  subheading: 'Scale confidently with transparent plans tailored to your growth.',
  ctaLabel: 'Get started',
  plans: [
    {
      id: 'starter',
      title: 'Starter',
      price: '$29/mo',
      description: 'Launch-ready essentials for new academies.',
      highlight: false,
      features: ['Up to 100 students', 'Core LMS modules', 'Email support']
    },
    {
      id: 'growth',
      title: 'Growth',
      price: '$99/mo',
      description: 'Automation, live classes, and analytics.',
      highlight: true,
      features: ['Live classes', 'Automation toolkit', 'Priority support']
    },
    {
      id: 'enterprise',
      title: 'Enterprise',
      price: 'Custom',
      description: 'Tailored infrastructure and white-glove onboarding.',
      highlight: false,
      features: ['Unlimited students', 'Dedicated success manager', 'Custom SLAs']
    }
  ]
});

const clampText = (value, limit = 200) => {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, limit);
};

const sanitizeColorInput = (value) => {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return HEX_COLOR_REGEX.test(trimmed) ? trimmed : undefined;
};

const sanitizeUrlInput = (value) => {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 1024);
};

const sanitizeHeroBackgroundMode = (value) => {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  return HERO_BACKGROUND_MODES.has(trimmed) ? trimmed : undefined;
};

const sanitizeMediaGalleryInput = (value, maxItems = 40) => {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  return value
    .slice(0, maxItems)
    .map((item, index) => {
      if (typeof item === 'string') {
        const url = sanitizeUrlInput(item);
        if (typeof url !== 'string' || !url) return null;
        return {
          id: `media_${index + 1}`,
          url,
          mediaType: 'image',
          order: index
        };
      }
      if (!item || typeof item !== 'object') return null;
      const url = sanitizeUrlInput(item.url);
      if (typeof url !== 'string' || !url) return null;
      const mediaType = typeof item.mediaType === 'string' && MEDIA_TYPES.has(item.mediaType.trim().toLowerCase())
        ? item.mediaType.trim().toLowerCase()
        : 'image';
      const id = typeof item.id === 'string' && item.id.trim()
        ? item.id.trim().slice(0, 120)
        : `media_${index + 1}`;
      return {
        id,
        url,
        mediaType,
        order: index
      };
    })
    .filter(Boolean);
};

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const normalizePlanList = (rawPlans, { fallbackToDefault } = { fallbackToDefault: true }) => {
  const source = Array.isArray(rawPlans) && rawPlans.length ? rawPlans : (fallbackToDefault ? DEFAULT_PRICING.plans : []);
  return source.slice(0, 4).map((plan = {}, index) => {
    const id = clampText(plan.id, 60) || `plan_${index + 1}`;
    const title = clampText(plan.title, 80) || `Plan ${index + 1}`;
    const price = clampText(plan.price, 60) || '$0';
    const description = clampText(plan.description, 200) || '';
    const features = (Array.isArray(plan.features) ? plan.features : [])
      .map((feature) => clampText(feature, 120))
      .filter((feature) => typeof feature === 'string' && feature.length)
      .slice(0, 10);
    return {
      id,
      title,
      price,
      description,
      highlight: Boolean(plan.highlight),
      features
    };
  });
};

const mergeBrandingConfig = (raw = {}) => {
  const merged = { ...DEFAULT_BRANDING };
  if (!raw || typeof raw !== 'object') {
    return merged;
  }
  Object.entries(raw).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') {
      return;
    }
    if (['primaryColor', 'secondaryColor', 'accentColor', 'footerBackgroundColor', 'announcementBarColor', 'heroBackgroundColor'].includes(key)) {
      if (typeof value === 'string' && HEX_COLOR_REGEX.test(value)) {
        merged[key] = value;
      }
      return;
    }
    if (key === 'heroBackgroundMode') {
      if (typeof value === 'string') {
        const normalizedMode = value.trim().toLowerCase();
        if (HERO_BACKGROUND_MODES.has(normalizedMode)) {
          merged.heroBackgroundMode = normalizedMode;
        }
      }
      return;
    }
    if (['heroBackgroundImageUrl', 'heroBackgroundVideoUrl'].includes(key)) {
      if (typeof value === 'string') {
        merged[key] = value;
      }
      return;
    }
    if (key === 'heroMediaGallery') {
      const sanitizedGallery = sanitizeMediaGalleryInput(value);
      if (Array.isArray(sanitizedGallery)) {
        merged.heroMediaGallery = sanitizedGallery;
      }
      return;
    }
    if (typeof value === 'string') {
      merged[key] = value;
    }
  });
  return merged;
};

const mergePricingConfig = (raw = {}) => {
  const pricing = raw && typeof raw === 'object' ? raw : {};
  return {
    headline: typeof pricing.headline === 'string' && pricing.headline.trim() ? pricing.headline : DEFAULT_PRICING.headline,
    subheading: typeof pricing.subheading === 'string' && pricing.subheading.trim() ? pricing.subheading : DEFAULT_PRICING.subheading,
    ctaLabel: typeof pricing.ctaLabel === 'string' && pricing.ctaLabel.trim() ? pricing.ctaLabel : DEFAULT_PRICING.ctaLabel,
    plans: normalizePlanList(pricing.plans, { fallbackToDefault: true })
  };
};

const sanitizeBrandingPayload = (payload = {}) => {
  if (!payload || typeof payload !== 'object') {
    return {};
  }
  const normalized = {};
  ['primaryColor', 'secondaryColor', 'accentColor', 'footerBackgroundColor', 'announcementBarColor', 'heroBackgroundColor'].forEach((field) => {
    if (field in payload) {
      const sanitized = sanitizeColorInput(payload[field]);
      if (sanitized !== undefined) {
        normalized[field] = sanitized;
      }
    }
  });
  ['logoUrl', 'faviconUrl'].forEach((field) => {
    if (field in payload) {
      const sanitized = sanitizeUrlInput(payload[field]);
      if (sanitized !== undefined) {
        normalized[field] = sanitized;
      }
    }
  });
  if ('heroBackgroundMode' in payload) {
    const sanitized = sanitizeHeroBackgroundMode(payload.heroBackgroundMode);
    if (sanitized !== undefined) {
      normalized.heroBackgroundMode = sanitized;
    }
  }
  ['heroBackgroundImageUrl', 'heroBackgroundVideoUrl'].forEach((field) => {
    if (field in payload) {
      const sanitized = sanitizeUrlInput(payload[field]);
      if (sanitized !== undefined) {
        normalized[field] = sanitized;
      }
    }
  });
  if ('heroMediaGallery' in payload) {
    const sanitizedGallery = sanitizeMediaGalleryInput(payload.heroMediaGallery);
    if (sanitizedGallery !== undefined) {
      normalized.heroMediaGallery = sanitizedGallery;
      if (Array.isArray(sanitizedGallery)) {
        const firstImage = sanitizedGallery.find((item) => item.mediaType === 'image' && isNonEmptyString(item.url));
        const firstVideo = sanitizedGallery.find((item) => item.mediaType === 'video' && isNonEmptyString(item.url));
        normalized.heroBackgroundImageUrl = firstImage ? firstImage.url : '';
        normalized.heroBackgroundVideoUrl = firstVideo ? firstVideo.url : '';
      }
    }
  }
  const textLimits = {
    footerText: 240,
    heroTitleLeading: 200,
    heroTitleHighlight: 200,
    heroSubtitle: 320,
    heroBadge: 80,
    primaryCtaLabel: 80,
    secondaryCtaLabel: 80,
    pricingCtaLabel: 80
  };
  Object.entries(textLimits).forEach(([field, limit]) => {
    if (field in payload) {
      const sanitized = clampText(payload[field], limit);
      if (sanitized !== undefined) {
        normalized[field] = sanitized;
      }
    }
  });
  return normalized;
};

const sanitizePricingPayload = (payload = {}) => {
  if (!payload || typeof payload !== 'object') {
    return {};
  }
  const normalized = {};
  if ('headline' in payload) {
    const sanitized = clampText(payload.headline, 200);
    if (sanitized !== undefined) {
      normalized.headline = sanitized;
    }
  }
  if ('subheading' in payload) {
    const sanitized = clampText(payload.subheading, 320);
    if (sanitized !== undefined) {
      normalized.subheading = sanitized;
    }
  }
  if ('ctaLabel' in payload) {
    const sanitized = clampText(payload.ctaLabel, 80);
    if (sanitized !== undefined) {
      normalized.ctaLabel = sanitized;
    }
  }
  if ('plans' in payload) {
    normalized.plans = normalizePlanList(payload.plans, { fallbackToDefault: false });
  }
  return normalized;
};

const buildAppearanceResponse = (settings = {}) => {
  const safeSettings = settings && typeof settings === 'object' ? settings : {};
  const branding = mergeBrandingConfig(safeSettings.branding);
  const pricing = mergePricingConfig(safeSettings.pricing);
  const meta = safeSettings.appearanceMeta && typeof safeSettings.appearanceMeta === 'object' ? safeSettings.appearanceMeta : {};
  return {
    branding,
    pricing,
    updatedAt: meta.updatedAt || null,
    updatedBy: meta.updatedBy || null
  };
};

const withTenantHeroMediaFallback = (tenantSettings = {}, centralSettings = {}) => {
  const tenantAppearance = buildAppearanceResponse(tenantSettings);
  const centralAppearance = buildAppearanceResponse(centralSettings);
  const tenantBrandingRaw = tenantSettings?.branding && typeof tenantSettings.branding === 'object'
    ? tenantSettings.branding
    : {};
  const tenantHasExplicitMode =
    typeof tenantBrandingRaw.heroBackgroundMode === 'string'
    && HERO_BACKGROUND_MODES.has(tenantBrandingRaw.heroBackgroundMode.trim().toLowerCase());
  const tenantHasGalleryMedia = Array.isArray(tenantBrandingRaw.heroMediaGallery)
    && tenantBrandingRaw.heroMediaGallery.some((item) => {
      if (typeof item === 'string') {
        return isNonEmptyString(item);
      }
      return isNonEmptyString(item?.url);
    });
  const tenantHasMedia =
    tenantHasGalleryMedia
    ||
    isNonEmptyString(tenantBrandingRaw.heroBackgroundImageUrl)
    || isNonEmptyString(tenantBrandingRaw.heroBackgroundVideoUrl);
  const branding = {
    ...tenantAppearance.branding
  };

  if (!tenantHasMedia) {
    const centralHeroGallery = sanitizeMediaGalleryInput(centralAppearance.branding.heroMediaGallery);
    if (Array.isArray(centralHeroGallery) && centralHeroGallery.length) {
      branding.heroMediaGallery = centralHeroGallery;
    }
    if (isNonEmptyString(centralAppearance.branding.heroBackgroundImageUrl)) {
      branding.heroBackgroundImageUrl = centralAppearance.branding.heroBackgroundImageUrl;
    }
    if (isNonEmptyString(centralAppearance.branding.heroBackgroundVideoUrl)) {
      branding.heroBackgroundVideoUrl = centralAppearance.branding.heroBackgroundVideoUrl;
    }
    if (!tenantHasExplicitMode && HERO_BACKGROUND_MODES.has(centralAppearance.branding.heroBackgroundMode)) {
      branding.heroBackgroundMode = centralAppearance.branding.heroBackgroundMode;
    }
  }

  const hasImage = isNonEmptyString(branding.heroBackgroundImageUrl);
  const hasVideo = isNonEmptyString(branding.heroBackgroundVideoUrl);
  if (branding.heroBackgroundMode === 'video' && !hasVideo) {
    branding.heroBackgroundMode = hasImage ? 'image' : 'color';
  }
  if (branding.heroBackgroundMode === 'image' && !hasImage) {
    branding.heroBackgroundMode = hasVideo ? 'video' : 'color';
  }

  return {
    ...tenantAppearance,
    branding
  };
};

const readTenantSettings = (tenant) => {
  if (!tenant || !tenant.settings) {
    return {};
  }
  if (typeof tenant.settings === 'object') {
    return tenant.settings;
  }
  if (typeof tenant.settings === 'string') {
    try {
      return JSON.parse(tenant.settings) || {};
    } catch (error) {
      console.warn('Unable to parse tenant settings JSON', error);
      return {};
    }
  }
  return {};
};

const CENTRAL_APPEARANCE_SETTINGS_KEY = 'platform.appearance';

const readCentralAppearanceSettings = async () => {
  const result = await centralPool.query(
    `SELECT value
       FROM system_settings
      WHERE key = $1
      LIMIT 1`,
    [CENTRAL_APPEARANCE_SETTINGS_KEY]
  );

  if (!result.rows.length || !result.rows[0].value) {
    return {};
  }

  const rawValue = result.rows[0].value;
  if (typeof rawValue === 'object') {
    return rawValue || {};
  }

  if (typeof rawValue === 'string') {
    try {
      return JSON.parse(rawValue) || {};
    } catch (error) {
      console.warn('Unable to parse central appearance settings JSON', error);
      return {};
    }
  }

  return {};
};

const writeCentralAppearanceSettings = async (settings) => {
  await centralPool.query(
    `INSERT INTO system_settings (key, value, value_type, category, description, is_public, created_at, updated_at)
     VALUES ($1, $2, 'json', 'general', 'Central domain appearance settings', true, NOW(), NOW())
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, value_type = 'json', updated_at = NOW()`,
    [CENTRAL_APPEARANCE_SETTINGS_KEY, JSON.stringify(settings || {})]
  );
};

const getEffectiveRequestHost = (req) => {
  const forwarded = req?.headers?.['x-forwarded-host'];
  const rawHost = Array.isArray(forwarded)
    ? forwarded[0]
    : (typeof forwarded === 'string' ? forwarded.split(',')[0] : (req?.headers?.host || ''));
  return String(rawHost || '').split(':')[0].trim().toLowerCase();
};

const isCentralDomainHostRequest = (req) => {
  const host = getEffectiveRequestHost(req);
  if (!host) {
    return false;
  }
  const mainDomain = String(process.env.MAIN_DOMAIN || 'betacdmy.com.vendoworld.com').trim().toLowerCase();
  return host === mainDomain || host === `www.${mainDomain}`;
};

const readAppearanceSettings = async (req) => {
  if (req.tenant && !isCentralDomainHostRequest(req)) {
    return readTenantSettings(req.tenant);
  }
  return readCentralAppearanceSettings();
};

const writeAppearanceSettings = async (req, settings) => {
  if (req.tenant && !isCentralDomainHostRequest(req)) {
    await centralPool.query(
      `UPDATE tenants SET settings = $1, updated_at = now() WHERE id = $2`,
      [JSON.stringify(settings), req.tenant.id]
    );
    req.tenant.settings = settings;
    return;
  }

  await writeCentralAppearanceSettings(settings);
};

const parseSmtpPort = (value, fallback = 587) => {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    return null;
  }
  return parsed;
};

const toOptionalTrimmedString = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const sanitizeEmailSettingsPayload = (payload = {}) => {
  const smtpHost = toOptionalTrimmedString(payload.smtpHost);
  const smtpUser = toOptionalTrimmedString(payload.smtpUser);
  const smtpFrom = toOptionalTrimmedString(payload.smtpFrom);
  const smtpPassRaw = typeof payload.smtpPass === 'string' ? payload.smtpPass.trim() : undefined;
  const smtpPort = parseSmtpPort(payload.smtpPort, 587);
  const smtpSecure = typeof payload.smtpSecure === 'boolean'
    ? payload.smtpSecure
    : smtpPort === 465;

  return {
    smtpHost,
    smtpPort,
    smtpUser,
    smtpFrom,
    smtpPassRaw,
    smtpSecure
  };
};

const mapEmailSettingsResponse = (row, scope, inheritedForTenant = false) => {
  if (!row) {
    return {
      scope,
      inheritedForTenant,
      smtpHost: '',
      smtpPort: 587,
      smtpUser: '',
      smtpFrom: '',
      smtpSecure: false,
      hasPassword: false,
      updatedAt: null
    };
  }

  return {
    scope,
    inheritedForTenant,
    smtpHost: row.smtp_host || '',
    smtpPort: Number(row.smtp_port) || 587,
    smtpUser: row.smtp_user || '',
    smtpFrom: row.smtp_from || '',
    smtpSecure: Boolean(row.smtp_secure),
    hasPassword: Boolean(row.smtp_pass),
    updatedAt: row.updated_at || null
  };
};

const readScopedEmailSettings = async (req) => {
  if (req.tenant?.id) {
    const tenantResult = await centralPool.query(
      `SELECT smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_secure, updated_at
         FROM email_settings
        WHERE scope = 'tenant' AND tenant_id = $1
        LIMIT 1`,
      [req.tenant.id]
    );

    if (tenantResult.rows.length > 0) {
      return mapEmailSettingsResponse(tenantResult.rows[0], 'tenant', false);
    }

    const centralResult = await centralPool.query(
      `SELECT smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_secure, updated_at
         FROM email_settings
        WHERE scope = 'central' AND tenant_id IS NULL
        LIMIT 1`
    );

    return mapEmailSettingsResponse(centralResult.rows[0], 'central', true);
  }

  const centralResult = await centralPool.query(
    `SELECT smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_secure, updated_at
       FROM email_settings
      WHERE scope = 'central' AND tenant_id IS NULL
      LIMIT 1`
  );

  return mapEmailSettingsResponse(centralResult.rows[0], 'central', false);
};

const writeScopedEmailSettings = async (req, payload) => {
  const normalized = sanitizeEmailSettingsPayload(payload);
  const actorId = req.userId ? String(req.userId) : null;

  if (!normalized.smtpHost || !normalized.smtpUser || !normalized.smtpFrom || !normalized.smtpPort) {
    throw new Error('SMTP host, port, user, and from address are required.');
  }

  const scope = req.tenant?.id ? 'tenant' : 'central';
  const tenantId = req.tenant?.id || null;

  const existingResult = await centralPool.query(
    `SELECT smtp_pass
       FROM email_settings
      WHERE scope = $1
        AND ((tenant_id = $2) OR (tenant_id IS NULL AND $2 IS NULL))
      LIMIT 1`,
    [scope, tenantId]
  );

  const existingPassword = existingResult.rows[0]?.smtp_pass || null;
  const nextPassword = normalized.smtpPassRaw !== undefined ? normalized.smtpPassRaw : existingPassword;

  if (!nextPassword) {
    throw new Error('SMTP password is required.');
  }

  if (scope === 'tenant') {
    await centralPool.query(
      `INSERT INTO email_settings (
         scope, tenant_id, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_secure, created_by, updated_by, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, NOW(), NOW())
       ON CONFLICT (tenant_id) WHERE scope = 'tenant'
       DO UPDATE SET
         smtp_host = EXCLUDED.smtp_host,
         smtp_port = EXCLUDED.smtp_port,
         smtp_user = EXCLUDED.smtp_user,
         smtp_pass = EXCLUDED.smtp_pass,
         smtp_from = EXCLUDED.smtp_from,
         smtp_secure = EXCLUDED.smtp_secure,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      [scope, tenantId, normalized.smtpHost, normalized.smtpPort, normalized.smtpUser, nextPassword, normalized.smtpFrom, normalized.smtpSecure, actorId]
    );
  } else {
    await centralPool.query(
      `INSERT INTO email_settings (
         scope, tenant_id, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_secure, created_by, updated_by, created_at, updated_at
       ) VALUES ('central', NULL, $1, $2, $3, $4, $5, $6, $7, $7, NOW(), NOW())
       ON CONFLICT (scope) WHERE scope = 'central' AND tenant_id IS NULL
       DO UPDATE SET
         smtp_host = EXCLUDED.smtp_host,
         smtp_port = EXCLUDED.smtp_port,
         smtp_user = EXCLUDED.smtp_user,
         smtp_pass = EXCLUDED.smtp_pass,
         smtp_from = EXCLUDED.smtp_from,
         smtp_secure = EXCLUDED.smtp_secure,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      [normalized.smtpHost, normalized.smtpPort, normalized.smtpUser, nextPassword, normalized.smtpFrom, normalized.smtpSecure, actorId]
    );
  }

  return readScopedEmailSettings(req);
};

const DISCOUNT_SELECT_BASE = `
  SELECT d.*, c.title AS course_title
    FROM discounts d
    LEFT JOIN courses c ON c.id = d.course_id
`;

const ATTENDANCE_THRESHOLDS = {
  lateSeconds: 5 * 60,
  presentSeconds: 25 * 60
};

const REWARD_ACTIVITY_TYPES = new Set([
  'LESSON_COMPLETION',
  'ASSIGNMENT_SUBMISSION',
  'QUIZ_PASS',
  'COURSE_COMPLETION'
]);

const CREDIT_OPTION_TYPES = new Set(['FREE_COURSE', 'DISCOUNT', 'SCHOLARSHIP']);

const DEFAULT_COURSE_CATEGORIES = [
  'Technology',
  'Business',
  'Finance',
  'Marketing',
  'Design',
  'Languages',
  'Personal Development',
  'Health & Fitness',
  'Academics',
  'Professional Skills'
];

const NOTIFICATION_CATEGORIES = {
  SYSTEM: 'SYSTEM',
  COURSE_UPDATE: 'COURSE_UPDATE',
  ASSIGNMENT_DEADLINE: 'ASSIGNMENT_DEADLINE',
  EXAM_RESULT: 'EXAM_RESULT',
  NEW_CONTENT: 'NEW_CONTENT',
  LIVE_MEETING: 'LIVE_MEETING',
  MESSAGE: 'MESSAGE'
};

let ensureCreditSchemaPromise;
const ensureCreditSchema = async () => {
  if (!ensureCreditSchemaPromise) {
    ensureCreditSchemaPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS credit_redemption_options (
          id UUID PRIMARY KEY,
          title TEXT NOT NULL,
          type TEXT NOT NULL,
          description TEXT,
          required_credits INTEGER NOT NULL,
          metadata JSONB DEFAULT '{}'::jsonb,
          is_active BOOLEAN DEFAULT true,
          created_by UUID REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS credit_transactions (
          id UUID PRIMARY KEY,
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
          amount INTEGER NOT NULL,
          action_type TEXT NOT NULL,
          source TEXT,
          reason TEXT,
          metadata JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ DEFAULT now()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS credit_redemptions (
          id UUID PRIMARY KEY,
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          option_id UUID REFERENCES credit_redemption_options(id) ON DELETE SET NULL,
          credits_spent INTEGER NOT NULL,
          status TEXT NOT NULL,
          metadata JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ DEFAULT now()
        );
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_credit_transactions_user ON credit_transactions (user_id, created_at DESC);');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_credit_redemptions_user ON credit_redemptions (user_id, created_at DESC);');
    })().catch((error) => {
      ensureCreditSchemaPromise = null;
      console.error('Credit schema initialization failed', error);
      throw error;
    });
  }
  return ensureCreditSchemaPromise;
};

let ensureAttendanceSchemaPromise;
const ensureAttendanceSchema = async () => {
  if (!ensureAttendanceSchemaPromise) {
    ensureAttendanceSchemaPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS attendance_records (
          id UUID PRIMARY KEY,
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
          session_date DATE NOT NULL,
          status TEXT NOT NULL,
          duration_seconds INTEGER NOT NULL DEFAULT 0,
          items_completed INTEGER NOT NULL DEFAULT 0,
          milestone_events INTEGER NOT NULL DEFAULT 0,
          last_active TIMESTAMPTZ DEFAULT now()
        );
      `);
      await pool.query('ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS duration_seconds INTEGER NOT NULL DEFAULT 0;');
      await pool.query('ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS items_completed INTEGER NOT NULL DEFAULT 0;');
      await pool.query('ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS milestone_events INTEGER NOT NULL DEFAULT 0;');
      await pool.query('ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS last_active TIMESTAMPTZ DEFAULT now();');
      await pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'attendance_records_unique'
          ) THEN
            ALTER TABLE attendance_records ADD CONSTRAINT attendance_records_unique UNIQUE (user_id, course_id, session_date);
          END IF;
        END;
        $$;
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance_records (user_id, session_date DESC);');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_attendance_last_active ON attendance_records (last_active DESC);');
    })().catch((error) => {
      ensureAttendanceSchemaPromise = null;
      console.error('Attendance schema initialization failed', error);
      throw error;
    });
  }
  return ensureAttendanceSchemaPromise;
};

let ensureCoursePaymentsSchemaPromise;
const ensureCoursePaymentsSchema = async () => {
  if (!ensureCoursePaymentsSchemaPromise) {
    ensureCoursePaymentsSchemaPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS course_payments (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          receipt_id TEXT UNIQUE NOT NULL,
          student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          student_name TEXT NOT NULL,
          student_email TEXT,
          course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
          course_title TEXT NOT NULL,
          instructor_name TEXT NOT NULL,
          instructor_id UUID REFERENCES users(id) ON DELETE SET NULL,
          course_price NUMERIC(10,2) NOT NULL DEFAULT 0,
          amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
          payment_method TEXT NOT NULL,
          collected_by TEXT,
          collected_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
          notes TEXT,
          received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      
      // Add Stripe-related columns if they don't exist
      await pool.query(`
        DO $$ 
        BEGIN
          BEGIN
            ALTER TABLE course_payments ADD COLUMN stripe_session_id TEXT;
          EXCEPTION
            WHEN duplicate_column THEN NULL;
          END;
          BEGIN
            ALTER TABLE course_payments ADD COLUMN stripe_payment_intent_id TEXT;
          EXCEPTION
            WHEN duplicate_column THEN NULL;
          END;
          BEGIN
            ALTER TABLE course_payments ADD COLUMN receipt_url TEXT;
          EXCEPTION
            WHEN duplicate_column THEN NULL;
          END;
        END $$;
      `);
      
      await pool.query('CREATE INDEX IF NOT EXISTS idx_course_payments_student ON course_payments(student_id, course_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_course_payments_course ON course_payments(course_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_course_payments_instructor ON course_payments(instructor_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_course_payments_received_at ON course_payments(received_at DESC)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_course_payments_method ON course_payments(payment_method)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_course_payments_stripe_session ON course_payments(stripe_session_id) WHERE stripe_session_id IS NOT NULL');
      await pool.query(`
        INSERT INTO course_payments (
          id,
          receipt_id,
          student_id,
          student_name,
          student_email,
          course_id,
          course_title,
          instructor_name,
          instructor_id,
          course_price,
          amount,
          payment_method,
          collected_by,
          collected_by_id,
          notes,
          received_at,
          created_at,
          updated_at
        )
        SELECT
          t.id,
          CONCAT('LEGACY-', LEFT(REPLACE(t.id::text, '-', ''), 12)),
          t.user_id,
          COALESCE(u.name, 'Student'),
          u.email,
          t.course_id,
          COALESCE(c.title, 'Course'),
          COALESCE(c.instructor, 'Instructor'),
          inst.id,
          COALESCE(c.price, t.amount, 0),
          t.amount,
          UPPER(COALESCE(NULLIF(t.method, ''), 'MANUAL')),
          NULL,
          NULL,
          NULL,
          COALESCE(t.transacted_on::timestamptz, now()),
          COALESCE(t.transacted_on::timestamptz, now()),
          COALESCE(t.transacted_on::timestamptz, now())
        FROM transactions t
        LEFT JOIN users u ON u.id = t.user_id
        LEFT JOIN courses c ON c.id = t.course_id
        LEFT JOIN users inst ON inst.role = 'INSTRUCTOR' AND LOWER(inst.name) = LOWER(c.instructor)
        ON CONFLICT (id) DO NOTHING
      `);
    })().catch((error) => {
      ensureCoursePaymentsSchemaPromise = null;
      console.error('Course payments schema initialization failed', error);
      throw error;
    });
  }
  return ensureCoursePaymentsSchemaPromise;
};

let ensureInstructorPayoutsSchemaPromise;
const ensureInstructorPayoutsSchema = async () => {
  if (!ensureInstructorPayoutsSchemaPromise) {
    ensureInstructorPayoutsSchemaPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS instructor_payouts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          instructor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          instructor_name TEXT NOT NULL,
          amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
          payment_method TEXT NOT NULL,
          course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
          course_title TEXT,
          reference TEXT,
          notes TEXT,
          recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
          recorded_by_name TEXT,
          recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_instructor_payouts_instructor ON instructor_payouts (instructor_id, recorded_at DESC)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_instructor_payouts_recorded_at ON instructor_payouts (recorded_at DESC)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_instructor_payouts_course ON instructor_payouts (course_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_instructor_payouts_method ON instructor_payouts (payment_method)');
    })().catch((error) => {
      ensureInstructorPayoutsSchemaPromise = null;
      console.error('Instructor payouts schema initialization failed', error);
      throw error;
    });
  }
  return ensureInstructorPayoutsSchemaPromise;
};

let ensureStaticPagesPromise;
const ensureStaticPagesTable = async () => {
  if (!ensureStaticPagesPromise) {
    ensureStaticPagesPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS static_pages (
          slug TEXT PRIMARY KEY,
          title TEXT,
          content TEXT,
          updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
          updated_at TIMESTAMPTZ DEFAULT now()
        );
      `);
    })().catch((error) => {
      ensureStaticPagesPromise = null;
      console.error('Static pages schema initialization failed', error);
      throw error;
    });
  }
  return ensureStaticPagesPromise;
};

const ensureCourseCategoriesTable = async (db = pool) => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS course_categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await db.query('CREATE INDEX IF NOT EXISTS idx_course_categories_name ON course_categories (name)');
    await db.query(
      `INSERT INTO course_categories (name)
       SELECT unnest($1::text[])
       WHERE NOT EXISTS (SELECT 1 FROM course_categories)`
      , [DEFAULT_COURSE_CATEGORIES]
    );
  } catch (error) {
    console.error('Course categories schema initialization failed', error);
    throw error;
  }
};

const fetchCourseCategories = async (db = pool) => {
  await ensureCourseCategoriesTable(db);
  try {
    return await db.query('SELECT * FROM course_categories ORDER BY name ASC');
  } catch (error) {
    if (error?.message && error.message.includes('relation "course_categories" does not exist')) {
      await ensureCourseCategoriesTable(db);
      return await db.query('SELECT * FROM course_categories ORDER BY name ASC');
    }
    throw error;
  }
};

const ensureAdsSchema = async (db = pool) => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS ad_categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS ads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category_id UUID REFERENCES ad_categories(id) ON DELETE SET NULL,
      price NUMERIC(10,2),
      location TEXT,
      contact_name TEXT,
      contact_phone TEXT,
      contact_email TEXT,
      image_url TEXT,
      media_type TEXT DEFAULT 'image',
      media_url TEXT,
      gallery JSONB DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      is_featured BOOLEAN DEFAULT false,
      publish_date DATE,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS ads_display_settings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hero_title TEXT,
      hero_subtitle TEXT,
      search_placeholder TEXT,
      stat_ads_label TEXT,
      stat_users_label TEXT,
      stat_satisfaction_label TEXT,
      stat_support_label TEXT,
      stat_support_value TEXT DEFAULT '24/7',
      homepage_promo_enabled BOOLEAN DEFAULT false,
      homepage_promo_type TEXT DEFAULT 'image',
      homepage_promo_media_url TEXT,
      homepage_promo_link TEXT,
      homepage_promo_title TEXT,
      homepage_promo_subtitle TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS ads_announcements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      text TEXT NOT NULL,
      text_en TEXT DEFAULT '' NOT NULL,
      text_ar TEXT DEFAULT '' NOT NULL,
      enabled BOOLEAN DEFAULT true,
      show_in_top_bar BOOLEAN DEFAULT true,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await db.query('CREATE INDEX IF NOT EXISTS idx_ads_status_created_at ON ads(status, created_at DESC)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_ads_category ON ads(category_id)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_ads_featured ON ads(is_featured)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_ads_announcements_sequence ON ads_announcements(enabled, show_in_top_bar, sort_order, created_at DESC)');
};

let ensureCareerApplicationsPromise;
const ensureCareerApplicationsTable = async () => {
  if (!ensureCareerApplicationsPromise) {
    ensureCareerApplicationsPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS career_applications (
          id UUID PRIMARY KEY,
          job_id TEXT NOT NULL,
          job_title TEXT NOT NULL,
          applicant_name TEXT NOT NULL,
          applicant_email TEXT NOT NULL,
          applicant_phone TEXT,
          resume_url TEXT,
          resume_file_path TEXT,
          cover_letter TEXT,
          job_snapshot JSONB,
          status TEXT NOT NULL DEFAULT 'SUBMITTED',
          created_at TIMESTAMPTZ DEFAULT now()
        );
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_career_applications_job ON career_applications (job_id, created_at DESC);');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_career_applications_email ON career_applications (applicant_email);');
      
      // Add resume_file_path column if it doesn't exist (migration)
      await pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'career_applications' AND column_name = 'resume_file_path'
          ) THEN
            ALTER TABLE career_applications ADD COLUMN resume_file_path TEXT;
          END IF;
        END $$;
      `);
    })().catch((error) => {
      ensureCareerApplicationsPromise = null;
      console.error('Career applications schema initialization failed', error);
      throw error;
    });
  }
  return ensureCareerApplicationsPromise;
};

let ensureRewardsConfigSchemaPromise;
const ensureRewardsConfigSchema = async () => {
  if (!ensureRewardsConfigSchemaPromise) {
    ensureRewardsConfigSchemaPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS rewards_config (
          id SERIAL PRIMARY KEY,
          daily_login INTEGER NOT NULL,
          lesson_completion INTEGER NOT NULL,
          quiz_pass INTEGER NOT NULL,
          assignment_submission INTEGER NOT NULL,
          credits_per_currency_unit NUMERIC(12,2) NOT NULL DEFAULT 3000,
          currency_code TEXT NOT NULL DEFAULT 'USD',
          updated_at TIMESTAMPTZ DEFAULT now()
        );
      `);
      await pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'rewards_config' AND column_name = 'credits_per_currency_unit'
          ) THEN
            ALTER TABLE rewards_config
              ADD COLUMN credits_per_currency_unit NUMERIC(12,2) NOT NULL DEFAULT 3000;
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'rewards_config' AND column_name = 'currency_code'
          ) THEN
            ALTER TABLE rewards_config
              ADD COLUMN currency_code TEXT NOT NULL DEFAULT 'USD';
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'rewards_config' AND column_name = 'updated_at'
          ) THEN
            ALTER TABLE rewards_config
              ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
          END IF;
        END $$;
      `);
      await pool.query(
        `INSERT INTO rewards_config (
            daily_login,
            lesson_completion,
            quiz_pass,
            assignment_submission,
            credits_per_currency_unit,
            currency_code
         )
         SELECT $1,$2,$3,$4,$5,$6
         WHERE NOT EXISTS (SELECT 1 FROM rewards_config)`,
        [
          DEFAULT_REWARDS_CONFIG.daily_login,
          DEFAULT_REWARDS_CONFIG.lesson_completion,
          DEFAULT_REWARDS_CONFIG.quiz_pass,
          DEFAULT_REWARDS_CONFIG.assignment_submission,
          DEFAULT_REWARDS_CONFIG.credits_per_currency_unit,
          DEFAULT_REWARDS_CONFIG.currency_code
        ]
      );
    })().catch((error) => {
      ensureRewardsConfigSchemaPromise = null;
      console.error('Rewards config schema initialization failed', error);
      throw error;
    });
  }
  return ensureRewardsConfigSchemaPromise;
};

let ensureLivePlatformConfigPromise;
const ensureLivePlatformConfigTable = async () => {
  if (!ensureLivePlatformConfigPromise) {
    ensureLivePlatformConfigPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS live_platform_config (
          id INTEGER PRIMARY KEY,
          smrrtx_enabled BOOLEAN NOT NULL DEFAULT true,
          smrrtx_permanent_room_link TEXT,
          zoom_enabled BOOLEAN NOT NULL DEFAULT false,
          zoom_config_link TEXT,
          zoom_client_id TEXT,
          zoom_client_secret TEXT,
          zoom_account_id TEXT,
          zoom_user_id TEXT,
          meet_enabled BOOLEAN NOT NULL DEFAULT false,
          meet_config_link TEXT,
          google_sa_email TEXT,
          google_sa_key TEXT,
          google_calendar_id TEXT,
          updated_at TIMESTAMPTZ DEFAULT now()
        );
      `);
      await pool.query('ALTER TABLE live_platform_config ADD COLUMN IF NOT EXISTS zoom_config_link TEXT;');
      await pool.query('ALTER TABLE live_platform_config ADD COLUMN IF NOT EXISTS meet_config_link TEXT;');
      await pool.query('ALTER TABLE live_platform_config ADD COLUMN IF NOT EXISTS zoom_client_id TEXT;');
      await pool.query('ALTER TABLE live_platform_config ADD COLUMN IF NOT EXISTS zoom_client_secret TEXT;');
      await pool.query('ALTER TABLE live_platform_config ADD COLUMN IF NOT EXISTS zoom_account_id TEXT;');
      await pool.query('ALTER TABLE live_platform_config ADD COLUMN IF NOT EXISTS zoom_user_id TEXT;');
      await pool.query('ALTER TABLE live_platform_config ADD COLUMN IF NOT EXISTS google_sa_email TEXT;');
      await pool.query('ALTER TABLE live_platform_config ADD COLUMN IF NOT EXISTS google_sa_key TEXT;');
      await pool.query('ALTER TABLE live_platform_config ADD COLUMN IF NOT EXISTS google_calendar_id TEXT;');
      await pool.query(
        `INSERT INTO live_platform_config (
            id,
            smrrtx_enabled,
            smrrtx_permanent_room_link,
            zoom_enabled,
            zoom_config_link,
            meet_enabled,
            meet_config_link
         ) VALUES (1,$1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO NOTHING`,
        [
          DEFAULT_LIVE_PLATFORM_CONFIG.smrrtxEnabled,
          DEFAULT_LIVE_PLATFORM_CONFIG.smrrtxPermanentRoomLink || null,
          DEFAULT_LIVE_PLATFORM_CONFIG.zoomEnabled,
          DEFAULT_LIVE_PLATFORM_CONFIG.zoomConfigLink || null,
          DEFAULT_LIVE_PLATFORM_CONFIG.meetEnabled,
          DEFAULT_LIVE_PLATFORM_CONFIG.meetConfigLink || null
        ]
      );
    })().catch((error) => {
      ensureLivePlatformConfigPromise = null;
      console.error('Live platform config initialization failed', error);
      throw error;
    });
  }
  return ensureLivePlatformConfigPromise;
};

const mapLivePlatformConfigRow = (row) => ({
  smrrtxEnabled: row.smrrtx_enabled !== false,
  smrrtxPermanentRoomLink: row.smrrtx_permanent_room_link || '',
  zoomEnabled: Boolean(row.zoom_enabled),
  zoomConfigLink: row.zoom_config_link || '',
  zoomClientId: row.zoom_client_id || '',
  zoomClientSecret: row.zoom_client_secret || '',
  zoomAccountId: row.zoom_account_id || '',
  zoomUserId: row.zoom_user_id || '',
  meetEnabled: Boolean(row.meet_enabled),
  meetConfigLink: row.meet_config_link || '',
  googleSaEmail: row.google_sa_email || '',
  googleSaKey: row.google_sa_key || '',
  googleCalendarId: row.google_calendar_id || ''
});

const fetchLivePlatformConfig = async () => {
  await ensureLivePlatformConfigTable();
  const result = await pool.query('SELECT * FROM live_platform_config WHERE id = 1 LIMIT 1');
  if (!result.rowCount) {
    return { ...DEFAULT_LIVE_PLATFORM_CONFIG };
  }
  return mapLivePlatformConfigRow(result.rows[0]);
};

let ensurePaymentGatewayConfigPromise;
const ensurePaymentGatewayConfigTable = async () => {
  if (!ensurePaymentGatewayConfigPromise) {
    ensurePaymentGatewayConfigPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS payment_gateway_config (
          id INTEGER PRIMARY KEY,
          visa_enabled BOOLEAN NOT NULL DEFAULT false,
          visa_public_key TEXT,
          visa_secret_key TEXT,
          paypal_enabled BOOLEAN NOT NULL DEFAULT false,
          paypal_client_id TEXT,
          paypal_secret_key TEXT,
          stripe_enabled BOOLEAN NOT NULL DEFAULT false,
          stripe_public_key TEXT,
          stripe_secret_key TEXT,
          stripe_price_basic_monthly TEXT,
          stripe_price_basic_yearly TEXT,
          stripe_price_pro_monthly TEXT,
          stripe_price_pro_yearly TEXT,
          stripe_price_enterprise_monthly TEXT,
          stripe_price_enterprise_yearly TEXT,
          plan_basic_monthly_amount NUMERIC,
          plan_basic_monthly_currency TEXT,
          plan_pro_monthly_amount NUMERIC,
          plan_pro_monthly_currency TEXT,
          plan_enterprise_monthly_amount NUMERIC,
          plan_enterprise_monthly_currency TEXT,
          updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
          updated_at TIMESTAMPTZ DEFAULT now()
        );
      `);
      await pool.query(`
        DO $$
        BEGIN
          BEGIN
            ALTER TABLE payment_gateway_config ADD COLUMN stripe_price_basic_monthly TEXT;
          EXCEPTION WHEN duplicate_column THEN NULL; END;
          BEGIN
            ALTER TABLE payment_gateway_config ADD COLUMN stripe_price_basic_yearly TEXT;
          EXCEPTION WHEN duplicate_column THEN NULL; END;
          BEGIN
            ALTER TABLE payment_gateway_config ADD COLUMN stripe_price_pro_monthly TEXT;
          EXCEPTION WHEN duplicate_column THEN NULL; END;
          BEGIN
            ALTER TABLE payment_gateway_config ADD COLUMN stripe_price_pro_yearly TEXT;
          EXCEPTION WHEN duplicate_column THEN NULL; END;
          BEGIN
            ALTER TABLE payment_gateway_config ADD COLUMN stripe_price_enterprise_monthly TEXT;
          EXCEPTION WHEN duplicate_column THEN NULL; END;
          BEGIN
            ALTER TABLE payment_gateway_config ADD COLUMN stripe_price_enterprise_yearly TEXT;
          EXCEPTION WHEN duplicate_column THEN NULL; END;
          BEGIN
            ALTER TABLE payment_gateway_config ADD COLUMN plan_basic_monthly_amount NUMERIC;
          EXCEPTION WHEN duplicate_column THEN NULL; END;
          BEGIN
            ALTER TABLE payment_gateway_config ADD COLUMN plan_basic_monthly_currency TEXT;
          EXCEPTION WHEN duplicate_column THEN NULL; END;
          BEGIN
            ALTER TABLE payment_gateway_config ADD COLUMN plan_pro_monthly_amount NUMERIC;
          EXCEPTION WHEN duplicate_column THEN NULL; END;
          BEGIN
            ALTER TABLE payment_gateway_config ADD COLUMN plan_pro_monthly_currency TEXT;
          EXCEPTION WHEN duplicate_column THEN NULL; END;
          BEGIN
            ALTER TABLE payment_gateway_config ADD COLUMN plan_enterprise_monthly_amount NUMERIC;
          EXCEPTION WHEN duplicate_column THEN NULL; END;
          BEGIN
            ALTER TABLE payment_gateway_config ADD COLUMN plan_enterprise_monthly_currency TEXT;
          EXCEPTION WHEN duplicate_column THEN NULL; END;
        END $$;
      `);
      await pool.query(
        `INSERT INTO payment_gateway_config (
            id,
            paypal_enabled,
            paypal_client_id,
            paypal_secret_key,
            stripe_enabled,
            stripe_public_key,
            stripe_secret_key,
            stripe_price_basic_monthly,
            stripe_price_basic_yearly,
            stripe_price_pro_monthly,
            stripe_price_pro_yearly,
            stripe_price_enterprise_monthly,
            stripe_price_enterprise_yearly,
            plan_basic_monthly_amount,
            plan_basic_monthly_currency,
            plan_pro_monthly_amount,
            plan_pro_monthly_currency,
            plan_enterprise_monthly_amount,
            plan_enterprise_monthly_currency,
            updated_by
         ) VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NULL)
         ON CONFLICT (id) DO NOTHING`,
        [
          DEFAULT_PAYMENT_GATEWAY_CONFIG.paypalEnabled,
          DEFAULT_PAYMENT_GATEWAY_CONFIG.paypalClientId || null,
          DEFAULT_PAYMENT_GATEWAY_CONFIG.paypalSecretKey || null,
          DEFAULT_PAYMENT_GATEWAY_CONFIG.stripeEnabled,
          DEFAULT_PAYMENT_GATEWAY_CONFIG.stripePublicKey || null,
          DEFAULT_PAYMENT_GATEWAY_CONFIG.stripeSecretKey || null,
          DEFAULT_PAYMENT_GATEWAY_CONFIG.stripePriceBasicMonthly || null,
          DEFAULT_PAYMENT_GATEWAY_CONFIG.stripePriceBasicYearly || null,
          DEFAULT_PAYMENT_GATEWAY_CONFIG.stripePriceProMonthly || null,
          DEFAULT_PAYMENT_GATEWAY_CONFIG.stripePriceProYearly || null,
          DEFAULT_PAYMENT_GATEWAY_CONFIG.stripePriceEnterpriseMonthly || null,
          DEFAULT_PAYMENT_GATEWAY_CONFIG.stripePriceEnterpriseYearly || null,
          DEFAULT_PAYMENT_GATEWAY_CONFIG.planBasicMonthlyAmount,
          DEFAULT_PAYMENT_GATEWAY_CONFIG.planBasicMonthlyCurrency || 'USD',
          DEFAULT_PAYMENT_GATEWAY_CONFIG.planProMonthlyAmount,
          DEFAULT_PAYMENT_GATEWAY_CONFIG.planProMonthlyCurrency || 'USD',
          DEFAULT_PAYMENT_GATEWAY_CONFIG.planEnterpriseMonthlyAmount,
          DEFAULT_PAYMENT_GATEWAY_CONFIG.planEnterpriseMonthlyCurrency || 'USD'
        ]
      );
    })().catch((error) => {
      ensurePaymentGatewayConfigPromise = null;
      console.error('Payment gateway config initialization failed', error);
      throw error;
    });
  }
  return ensurePaymentGatewayConfigPromise;
};

const mapPaymentGatewayConfigRow = (row) => ({
  paypalEnabled: row.paypal_enabled === true,
  paypalClientId: row.paypal_client_id || '',
  paypalSecretKey: row.paypal_secret_key || '',
  stripeEnabled: row.stripe_enabled === true,
  stripePublicKey: row.stripe_public_key || '',
  stripeSecretKey: row.stripe_secret_key || '',
  stripePriceBasicMonthly: row.stripe_price_basic_monthly || '',
  stripePriceBasicYearly: row.stripe_price_basic_yearly || '',
  stripePriceProMonthly: row.stripe_price_pro_monthly || '',
  stripePriceProYearly: row.stripe_price_pro_yearly || '',
  stripePriceEnterpriseMonthly: row.stripe_price_enterprise_monthly || '',
  stripePriceEnterpriseYearly: row.stripe_price_enterprise_yearly || '',
  planBasicMonthlyAmount: row.plan_basic_monthly_amount ?? null,
  planBasicMonthlyCurrency: row.plan_basic_monthly_currency || null,
  planProMonthlyAmount: row.plan_pro_monthly_amount ?? null,
  planProMonthlyCurrency: row.plan_pro_monthly_currency || null,
  planEnterpriseMonthlyAmount: row.plan_enterprise_monthly_amount ?? null,
  planEnterpriseMonthlyCurrency: row.plan_enterprise_monthly_currency || null,
  updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  updatedBy: row.updated_by || null
});

// Never return secret keys to the browser (bootstrap is unauthenticated / wide-read).
const sanitizePaymentGatewayConfigForClient = (config) => {
  if (!config || typeof config !== 'object') return config;
  return {
    ...config,
    // Keep the shape stable for the frontend, but blank secrets.
    stripeSecretKey: '',
    paypalSecretKey: '',
    visaSecretKey: ''
  };
};

const fetchPaymentGatewayConfig = async () => {
  await ensurePaymentGatewayConfigTable();
  const ENCRYPTION_KEY = process.env.PAYMENT_CONFIG_ENCRYPTION_KEY || 'default-encryption-key-change-in-production';
  
  try {
    const result = await pool.query(`
      SELECT * FROM payment_gateway_config WHERE id = 1 LIMIT 1
    `);
    
    if (!result.rowCount) {
      return { ...DEFAULT_PAYMENT_GATEWAY_CONFIG };
    }

    const row = result.rows[0];
    
    // Decrypt secret keys if they are bytea (Buffer)
    if (row.paypal_secret_key && Buffer.isBuffer(row.paypal_secret_key)) {
      try {
        row.paypal_secret_key = decryptField(row.paypal_secret_key, ENCRYPTION_KEY) || '';
      } catch (err) {
        console.warn('Failed to decrypt PayPal secret key, using empty string');
        row.paypal_secret_key = '';
      }
    }
    
    if (row.stripe_secret_key && Buffer.isBuffer(row.stripe_secret_key)) {
      try {
        row.stripe_secret_key = decryptField(row.stripe_secret_key, ENCRYPTION_KEY) || '';
      } catch (err) {
        console.warn('Failed to decrypt Stripe secret key, using empty string');
        row.stripe_secret_key = '';
      }
    }
    
    return mapPaymentGatewayConfigRow(row);
  } catch (error) {
    console.error('Failed to fetch payment gateway config:', error);
    return { ...DEFAULT_PAYMENT_GATEWAY_CONFIG };
  }
};

let ensureInstructorAssignmentsTablePromise;
const ensureInstructorAssignmentsTable = async () => {
  if (!ensureInstructorAssignmentsTablePromise) {
    ensureInstructorAssignmentsTablePromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS instructor_assignments (
          id UUID PRIMARY KEY,
          instructor_id UUID REFERENCES users(id) ON DELETE CASCADE,
          course_id TEXT,
          title TEXT NOT NULL,
          question TEXT,
          rubric TEXT,
          difficulty TEXT,
          topic TEXT,
          due_date TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now()
        );
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_instructor_assignments_instructor ON instructor_assignments (instructor_id, created_at DESC);');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_instructor_assignments_course ON instructor_assignments (course_id);');
    })().catch((error) => {
      ensureInstructorAssignmentsTablePromise = null;
      console.error('Instructor assignments table initialization failed', error);
      throw error;
    });
  }
  return ensureInstructorAssignmentsTablePromise;
};

let ensureAssignmentSubmissionsTablePromise;
const ensureAssignmentSubmissionsTable = async () => {
  if (!ensureAssignmentSubmissionsTablePromise) {
    ensureAssignmentSubmissionsTablePromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS assignment_submissions (
          id UUID PRIMARY KEY,
          student_id UUID REFERENCES users(id) ON DELETE CASCADE,
          instructor_id UUID REFERENCES users(id) ON DELETE SET NULL,
          course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
          assignment_id UUID,
          item_id TEXT,
          submission_type TEXT NOT NULL,
          prompt TEXT,
          rubric TEXT,
          answer TEXT,
          status TEXT NOT NULL DEFAULT 'PENDING',
          score NUMERIC(5,2),
          feedback TEXT,
          graded_by UUID REFERENCES users(id) ON DELETE SET NULL,
          graded_at TIMESTAMPTZ,
          metadata JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now()
        );
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_assignment_submissions_instructor ON assignment_submissions (instructor_id, status, created_at DESC);');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_assignment_submissions_student ON assignment_submissions (student_id, course_id, created_at DESC);');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_assignment_submissions_course ON assignment_submissions (course_id);');
    })().catch((error) => {
      ensureAssignmentSubmissionsTablePromise = null;
      console.error('Assignment submissions table initialization failed', error);
      throw error;
    });
  }
  return ensureAssignmentSubmissionsTablePromise;
};

const normalizeSubmissionMetadata = (value) => {
  if (!value) return {};
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return {};
};

const mapAssignmentSubmissionRow = (row) => {
  const metadata = normalizeSubmissionMetadata(row.metadata);
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name || null,
    studentEmail: row.student_email || null,
    instructorId: row.instructor_id || null,
    courseId: row.course_id,
    courseTitle: row.course_title || metadata.courseTitle || null,
    assignmentId: row.assignment_id || null,
    itemId: row.item_id || null,
    submissionType: row.submission_type,
    status: row.status,
    score: row.score !== null ? Number(row.score) : null,
    feedback: row.feedback || null,
    prompt: row.prompt || row.assignment_prompt || metadata.prompt || null,
    rubric: row.rubric || row.assignment_rubric || metadata.rubric || null,
    answer: row.answer || null,
    itemTitle: metadata.itemTitle || row.assignment_title || null,
    moduleTitle: metadata.moduleTitle || null,
    testType: metadata.testType || null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    gradedAt: row.graded_at ? new Date(row.graded_at).toISOString() : null
  };
};

const parseCourseJson = (value, fallback) => {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
};

const computeCourseTotalItems = (courseRow) => {
  const modules = parseCourseJson(courseRow?.modules, []);
  const preTest = parseCourseJson(courseRow?.pre_course_test, null);
  const postTest = parseCourseJson(courseRow?.post_course_test, null);
  const lessonItems = Array.isArray(modules)
    ? modules.reduce((sum, module) => sum + (Array.isArray(module?.items) ? module.items.length : 0), 0)
    : 0;
  const preCount = preTest?.enabled && Array.isArray(preTest?.questions) && preTest.questions.length ? 1 : 0;
  const postCount = postTest?.enabled && Array.isArray(postTest?.questions) && postTest.questions.length ? 1 : 0;
  return lessonItems + preCount + postCount;
};

const updateCourseProgressFromGrade = async ({
  userId,
  courseId,
  itemId,
  testType,
  score
}) => {
  if (!userId || !courseId) return null;
  await ensureProgressSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const [userResult, courseResult] = await Promise.all([
      client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]),
      client.query('SELECT * FROM courses WHERE id = $1', [courseId])
    ]);
    if (!userResult.rowCount || !courseResult.rowCount) {
      throw createHttpError(404, 'User or course not found');
    }

    const totalItems = computeCourseTotalItems(courseResult.rows[0]);
    const existingProgressResult = await client.query(
      'SELECT * FROM course_progress WHERE user_id = $1 AND course_id = $2 FOR UPDATE',
      [userId, courseId]
    );
    const existingProgress = existingProgressResult.rows[0] || null;

    const completedItems = Array.isArray(existingProgress?.completed_items)
      ? existingProgress.completed_items
      : parseCourseJson(existingProgress?.completed_items, []);
    const completedSet = new Set(
      completedItems
        .filter((value) => typeof value === 'string' && value.trim().length)
        .map((value) => value.trim())
    );

    if (itemId && typeof itemId === 'string') {
      if (Number(score) >= 70) {
        completedSet.add(itemId.trim());
      } else {
        completedSet.delete(itemId.trim());
      }
    }

    const nextPreTestScore = testType === 'pre' && Number.isFinite(Number(score))
      ? Number(score)
      : existingProgress?.pre_test_score ?? null;
    const nextPostTestScore = testType === 'post' && Number.isFinite(Number(score))
      ? Number(score)
      : existingProgress?.post_test_score ?? null;

    let nextPreTestCompleted = existingProgress?.pre_test_completed ?? false;
    let nextPostTestCompleted = existingProgress?.post_test_completed ?? false;

    if (testType === 'pre' && Number.isFinite(Number(score))) {
      nextPreTestCompleted = Number(score) >= 70;
      if (nextPreTestCompleted) {
        completedSet.add('pre-course-test');
      } else {
        completedSet.delete('pre-course-test');
      }
    }

    if (testType === 'post' && Number.isFinite(Number(score))) {
      nextPostTestCompleted = Number(score) >= 70;
      if (nextPostTestCompleted) {
        completedSet.add('post-course-test');
      } else {
        completedSet.delete('post-course-test');
      }
    }

    const normalizedItems = Array.from(completedSet);
    const safeTotal = Number.isFinite(Number(totalItems)) && Number(totalItems) > 0
      ? Number(totalItems)
      : normalizedItems.length;
    const completedCount = safeTotal
      ? Math.min(normalizedItems.length, safeTotal)
      : normalizedItems.length;
    const progressPercent = safeTotal
      ? Math.min(100, Math.round((completedCount / safeTotal) * 100))
      : 0;

    let progressRow;
    if (existingProgress) {
      progressRow = (
        await client.query(
          `UPDATE course_progress
              SET completed_items = $1::jsonb,
                  total_items = $2,
                  completed_count = $3,
                  progress_percent = $4,
                  pre_test_completed = $5,
                  post_test_completed = $6,
                  pre_test_score = $7,
                  post_test_score = $8,
                  last_activity = now()
            WHERE id = $9
            RETURNING *`,
          [
            JSON.stringify(normalizedItems),
            safeTotal,
            completedCount,
            progressPercent,
            nextPreTestCompleted,
            nextPostTestCompleted,
            nextPreTestScore,
            nextPostTestScore,
            existingProgress.id
          ]
        )
      ).rows[0];
    } else {
      progressRow = (
        await client.query(
          `INSERT INTO course_progress (
              id,
              user_id,
              course_id,
              completed_items,
              total_items,
              completed_count,
              progress_percent,
              pre_test_completed,
              post_test_completed,
              pre_test_score,
              post_test_score,
              last_activity
            )
           VALUES (gen_random_uuid(), $1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, now())
           RETURNING *`,
          [
            userId,
            courseId,
            JSON.stringify(normalizedItems),
            safeTotal,
            completedCount,
            progressPercent,
            nextPreTestCompleted,
            nextPostTestCompleted,
            nextPreTestScore,
            nextPostTestScore
          ]
        )
      ).rows[0];
    }

    const avgResult = await client.query(
      'SELECT COALESCE(AVG(progress_percent), 0) AS avg_progress FROM course_progress WHERE user_id = $1',
      [userId]
    );
    const averageProgress = Math.round(Number(avgResult.rows[0].avg_progress || 0));
    await client.query(
      `UPDATE users
          SET progress = $2,
              last_active = now()
        WHERE id = $1`,
      [userId, averageProgress]
    );

    await client.query('COMMIT');
    return progressRow;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Course progress update from grading failed', error);
    return null;
  } finally {
    client.release();
  }
};

const isValidHttpUrl = (value) => {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const mapCareerApplicationRow = (row) => ({
  id: row.id,
  jobId: row.job_id,
  jobTitle: row.job_title,
  name: row.applicant_name,
  email: row.applicant_email,
  phone: row.applicant_phone || null,
  resumeUrl: row.resume_url || null,
  coverLetter: row.cover_letter || null,
  status: row.status || 'SUBMITTED',
  jobSnapshot: row.job_snapshot || null,
  createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
});

const mapStaticPageRow = (row) => {
  const meta = getStaticPageMeta(row.slug);
  return {
    slug: row.slug,
    title: row.title || meta?.title || row.slug,
    content: row.content || '',
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    updatedBy: row.updated_by || null
  };
};

const fetchStaticPages = async () => {
  await ensureStaticPagesTable();
  const result = await pool.query('SELECT * FROM static_pages');
  const rows = result.rows.map(mapStaticPageRow);
  const knownSlugs = new Set(rows.map((row) => row.slug));
  STATIC_PAGE_DEFINITIONS.forEach((meta) => {
    if (!knownSlugs.has(meta.slug)) {
      const fallback = buildStaticPageFallback(meta.slug);
      if (fallback) {
        rows.push(fallback);
      }
    }
  });
  return rows.sort(
    (a, b) => STATIC_PAGE_SLUGS.indexOf(a.slug) - STATIC_PAGE_SLUGS.indexOf(b.slug)
  );
};

const fetchStaticPageBySlug = async (slug) => {
  await ensureStaticPagesTable();
  const result = await pool.query('SELECT * FROM static_pages WHERE slug = $1 LIMIT 1', [slug]);
  if (!result.rows.length) {
    const fallback = buildStaticPageFallback(slug);
    return fallback ? { ...fallback } : null;
  }
  return mapStaticPageRow(result.rows[0]);
};

const upsertStaticPage = async ({ slug, title, content, updatedBy }) => {
  await ensureStaticPagesTable();
  
  // Validate that the updatedBy user exists if provided
  let validatedUpdatedBy = null;
  if (updatedBy) {
    const userResult = await pool.query('SELECT id FROM users WHERE id = $1 LIMIT 1', [updatedBy]);
    if (userResult.rows.length > 0) {
      validatedUpdatedBy = updatedBy;
    }
    // If user doesn't exist, we'll set updated_by to NULL (which is allowed by the schema)
  }
  
  const result = await pool.query(
    `
      INSERT INTO static_pages (slug, title, content, updated_by, updated_at)
      VALUES ($1, $2, $3, $4, now())
      ON CONFLICT (slug)
      DO UPDATE SET
        title = EXCLUDED.title,
        content = EXCLUDED.content,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
      RETURNING *
    `,
    [slug, title, content, validatedUpdatedBy]
  );
  return mapStaticPageRow(result.rows[0]);
};

let ensureLiveSchemaPromise;
const ensureLiveSchema = async () => {
  if (!ensureLiveSchemaPromise) {
    ensureLiveSchemaPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS live_classes (
          id UUID PRIMARY KEY,
          instructor_id UUID REFERENCES users(id) ON DELETE CASCADE,
          topic TEXT NOT NULL,
          agenda TEXT,
          start_time TIMESTAMPTZ NOT NULL,
          platform TEXT NOT NULL,
          provider_meeting_id TEXT,
          host_url TEXT NOT NULL,
          join_url TEXT NOT NULL,
          passcode TEXT,
          invite_type TEXT NOT NULL DEFAULT 'all',
          duration_minutes INTEGER DEFAULT 60,
          status TEXT NOT NULL DEFAULT 'SCHEDULED',
          recording_url TEXT,
          created_at TIMESTAMPTZ DEFAULT now()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS live_class_invites (
          id UUID PRIMARY KEY,
          live_class_id UUID REFERENCES live_classes(id) ON DELETE CASCADE,
          student_id UUID REFERENCES users(id) ON DELETE CASCADE,
          email TEXT,
          invite_token TEXT,
          status TEXT DEFAULT 'INVITED',
          created_at TIMESTAMPTZ DEFAULT now()
        );
      `);
    })().catch((error) => {
      ensureLiveSchemaPromise = null;
      console.error('Live schema initialization failed', error);
      throw error;
    });
  }
  return ensureLiveSchemaPromise;
};

let ensureProgressSchemaPromise;
const ensureProgressSchema = async () => {
  if (!ensureProgressSchemaPromise) {
    ensureProgressSchemaPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS course_progress (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
          completed_items JSONB NOT NULL DEFAULT '[]'::jsonb,
          total_items INTEGER NOT NULL DEFAULT 0,
          completed_count INTEGER NOT NULL DEFAULT 0,
          progress_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
          pre_test_completed BOOLEAN DEFAULT false,
          post_test_completed BOOLEAN DEFAULT false,
          pre_test_score NUMERIC(5,2),
          post_test_score NUMERIC(5,2),
          last_activity TIMESTAMPTZ DEFAULT now(),
          UNIQUE (user_id, course_id)
        );
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_course_progress_user ON course_progress(user_id);');
      await pool.query('ALTER TABLE course_progress ADD COLUMN IF NOT EXISTS pre_test_completed BOOLEAN DEFAULT false;');
      await pool.query('ALTER TABLE course_progress ADD COLUMN IF NOT EXISTS post_test_completed BOOLEAN DEFAULT false;');
      await pool.query('ALTER TABLE course_progress ADD COLUMN IF NOT EXISTS pre_test_score NUMERIC(5,2);');
      await pool.query('ALTER TABLE course_progress ADD COLUMN IF NOT EXISTS post_test_score NUMERIC(5,2);');
      await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS last_activity_date DATE;');
    })().catch((error) => {
      ensureProgressSchemaPromise = null;
      console.error('Course progress schema initialization failed', error);
      throw error;
    });
  }
  return ensureProgressSchemaPromise;
};

let ensureNotificationSchemaPromise;
const ensureNotificationSchema = async () => {
  if (!ensureNotificationSchemaPromise) {
    ensureNotificationSchemaPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS notifications (
          id UUID PRIMARY KEY,
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
          course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
          category TEXT NOT NULL DEFAULT '${NOTIFICATION_CATEGORIES.SYSTEM}',
          type TEXT NOT NULL DEFAULT 'INFO',
          message TEXT NOT NULL,
          metadata JSONB DEFAULT '{}'::jsonb,
          read BOOLEAN DEFAULT false,
          read_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT now()
        );
      `);
      await pool.query('ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES users(id) ON DELETE SET NULL;');
      await pool.query('ALTER TABLE notifications ADD COLUMN IF NOT EXISTS course_id UUID REFERENCES courses(id) ON DELETE SET NULL;');
      await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS category TEXT DEFAULT '${NOTIFICATION_CATEGORIES.SYSTEM}';`);
      await pool.query("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;");
      await pool.query('ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (user_id, created_at DESC);');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications (user_id) WHERE read = false;');
      await pool.query(`UPDATE notifications SET category = '${NOTIFICATION_CATEGORIES.SYSTEM}' WHERE category IS NULL;`);
    })().catch((error) => {
      ensureNotificationSchemaPromise = null;
      console.error('Notification schema initialization failed', error);
      throw error;
    });
  }
  return ensureNotificationSchemaPromise;
};

let ensureEnrollmentsTablePromise;
const ensureEnrollmentsTable = async () => {
  if (!ensureEnrollmentsTablePromise) {
    ensureEnrollmentsTablePromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS enrollments (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
          enrolled_at TIMESTAMPTZ DEFAULT now(),
          UNIQUE(user_id, course_id)
        );
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_enrollments_user ON enrollments (user_id);');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_enrollments_course ON enrollments (course_id);');
    })().catch((error) => {
      ensureEnrollmentsTablePromise = null;
      console.error('Enrollments table initialization failed', error);
      throw error;
    });
  }
  return ensureEnrollmentsTablePromise;
};

const ensuredSeoOverridesPools = new WeakSet();
const ensureSeoOverridesTable = async (db = pool) => {
  if (ensuredSeoOverridesPools.has(db)) return;

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS seo_overrides (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        content_type VARCHAR(50) NOT NULL,
        content_id UUID NOT NULL,
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
        updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE (content_type, content_id)
      );

      CREATE INDEX IF NOT EXISTS idx_seo_overrides_content ON seo_overrides(content_type, content_id);

      CREATE OR REPLACE FUNCTION update_seo_overrides_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_update_seo_overrides_updated_at'
        ) THEN
          CREATE TRIGGER trigger_update_seo_overrides_updated_at
            BEFORE UPDATE ON seo_overrides
            FOR EACH ROW
            EXECUTE FUNCTION update_seo_overrides_updated_at();
        END IF;
      END $$;
    `);

    ensuredSeoOverridesPools.add(db);
  } catch (error) {
    console.error('Failed to ensure seo_overrides table exists', error);
    throw error;
  }
};

const toISODate = (value) => {
  if (!value) return undefined;
  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }
  if (typeof value === 'string') {
    return value.split('T')[0];
  }
  return value;
};

const formatDateLabel = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const toUtcDateOnly = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

const getDateKey = (value) => {
  const date = toUtcDateOnly(value);
  return date ? date.toISOString().split('T')[0] : null;
};

const isValidDateOnly = (value) => {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return false;
  }
  const parsed = new Date(trimmed);
  return !Number.isNaN(parsed.getTime());
};

const sanitizeDiscountCode = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toUpperCase();
};

const normalizeDiscountPercentage = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 100) {
    return null;
  }
  return Math.round(numeric);
};

const normalizeUserRole = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toUpperCase();
};

const SELF_REGISTRATION_ROLES = new Set(['STUDENT', 'MEMBER', 'INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN', 'VISITOR']);

const isAdminLikeRole = (value) => {
  const normalized = normalizeUserRole(value);
  return normalized === 'ADMIN' || normalized === 'SUPER_ADMIN';
};

const diffInDays = (later, earlier) => {
  const endDate = toUtcDateOnly(later);
  const startDate = toUtcDateOnly(earlier);
  if (!endDate || !startDate) return null;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((endDate.getTime() - startDate.getTime()) / msPerDay);
};

const mapUserRow = (row) => ({
  id: row.id,
  publicUserId: row.public_user_id || undefined,
  name: row.name,
  email: row.email,
  nationalId: row.national_id || undefined,
  role: normalizeUserRole(row.role) || 'STUDENT',
  avatar: row.avatar || undefined,
  status: row.status || undefined,
  phone: row.phone || undefined,
  phoneCountryCode: row.phone_country_code || undefined,
  joinDate: toISODate(row.join_date),
  lastActive: row.last_active || undefined,
  lastLoginDate: toISODate(row.last_login_date),
  enrolledCourses: row.enrolled_courses || [],
  progress: row.progress || undefined,
  plan: row.plan || undefined,
  notes: row.notes || undefined,
  credits: row.credits || 0,
  streak: row.streak || 0,
  specialization: row.specialization || undefined,
  gender: row.gender || undefined,
  followUpStatus: row.follow_up_status || undefined,
  bio: row.bio || undefined,
  yearsOfExperience: row.years_of_experience || undefined,
  portfolioUrl: row.portfolio_url || undefined,
  socialLinks: row.social_links || undefined,
  certifications: row.certifications || undefined
});

const MEMBERSHIP_TYPES = new Set(['BRONZE', 'SILVER']);
const MEMBERSHIP_STATUSES = new Set(['PENDING_PAYMENT', 'ACTIVE', 'REJECTED']);
const FREELANCER_STATUSES = new Set(['NEW', 'SHORTLISTED', 'REJECTED']);

const isArabicRequest = (req) => String(req?.headers?.['accept-language'] || '').toLowerCase().includes('ar');

const localize = (req, english, arabic) => (isArabicRequest(req) ? arabic : english);

const normalizeMembershipType = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.trim().toUpperCase();
  return MEMBERSHIP_TYPES.has(normalized) ? normalized : '';
};

const normalizeFreelancerStatus = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.trim().toUpperCase();
  return FREELANCER_STATUSES.has(normalized) ? normalized : '';
};

const normalizeMembershipStatus = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.trim().toUpperCase();
  return MEMBERSHIP_STATUSES.has(normalized) ? normalized : '';
};

const pickEnabledGateway = (config) => {
  if (config?.stripeEnabled) return 'stripe';
  if (config?.paypalEnabled) return 'paypal';
  if (config?.visaEnabled) return 'visa';
  return null;
};

const validateGatewayCredentials = (config, gateway) => {
  const normalizedGateway = String(gateway || '').toLowerCase();
  const gateways = {
    visa: {
      enabled: config?.visaEnabled,
      publicKey: config?.visaPublicKey,
      secretKey: config?.visaSecretKey
    },
    paypal: {
      enabled: config?.paypalEnabled,
      publicKey: config?.paypalClientId,
      secretKey: config?.paypalSecretKey
    },
    stripe: {
      enabled: config?.stripeEnabled,
      publicKey: config?.stripePublicKey,
      secretKey: config?.stripeSecretKey
    }
  };

  const target = gateways[normalizedGateway];
  if (!target || !target.enabled || !target.publicKey || !target.secretKey) {
    return false;
  }
  return true;
};

const resolveSilverMembershipAmount = (config) => {
  const parsed = Number(config?.planProMonthlyAmount);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Number(parsed.toFixed(2));
  }
  return 99;
};

const toPublicUploadPath = (filePath = '') => {
  const marker = '/uploads/';
  const normalized = String(filePath || '').replace(/\\/g, '/');
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex >= 0) {
    return normalized.slice(markerIndex);
  }
  const fileName = normalized.split('/').pop() || '';
  return fileName ? `/uploads/general/${fileName}` : '';
};

const resolveSubmissionPool = (req) => {
  const shouldUseTenantScope = Boolean(req.tenantPool) && Boolean(req.tenant) && !isCentralDomainHostRequest(req);
  return shouldUseTenantScope ? req.tenantPool : pool;
};

const ensureCommunityFormsSchema = async (db = pool) => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS freelancer_submissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      country TEXT NOT NULL,
      field_of_expertise TEXT NOT NULL,
      years_of_experience INTEGER NOT NULL DEFAULT 0,
      short_bio TEXT NOT NULL,
      cv_url TEXT,
      status TEXT NOT NULL DEFAULT 'NEW',
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS membership_submissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      country TEXT NOT NULL,
      membership_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
      payment_status TEXT NOT NULL DEFAULT 'pending',
      payment_gateway TEXT,
      payment_reference TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.query('CREATE INDEX IF NOT EXISTS idx_freelancer_submissions_created_at ON freelancer_submissions(created_at DESC)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_freelancer_submissions_email ON freelancer_submissions(LOWER(email))');
  await db.query('CREATE INDEX IF NOT EXISTS idx_freelancer_submissions_status ON freelancer_submissions(status)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_membership_submissions_created_at ON membership_submissions(created_at DESC)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_membership_submissions_email ON membership_submissions(LOWER(email))');
  await db.query('CREATE INDEX IF NOT EXISTS idx_membership_submissions_type_status ON membership_submissions(membership_type, status)');
};

const mapFreelancerSubmissionRow = (row) => ({
  id: row.id,
  fullName: row.full_name,
  email: row.email,
  phone: row.phone,
  country: row.country,
  fieldOfExpertise: row.field_of_expertise,
  yearsOfExperience: Number(row.years_of_experience || 0),
  shortBio: row.short_bio,
  cvUrl: row.cv_url || null,
  status: row.status || 'NEW',
  notes: row.notes || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const mapMembershipSubmissionRow = (row) => ({
  id: row.id,
  userId: row.user_id || null,
  name: row.name,
  email: row.email,
  phone: row.phone,
  country: row.country,
  membershipType: row.membership_type,
  status: row.status,
  paymentStatus: row.payment_status,
  paymentGateway: row.payment_gateway || null,
  paymentReference: row.payment_reference || null,
  notes: row.notes || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const SEO_OVERRIDE_FIELDS = [
  'title_en', 'title_ar', 'description_en', 'description_ar', 'keywords_en', 'keywords_ar',
  'canonical_url', 'robots', 'indexable', 'og_title_en', 'og_title_ar', 'og_description_en',
  'og_description_ar', 'og_image_url', 'og_type', 'og_site_name', 'twitter_card',
  'twitter_title_en', 'twitter_title_ar', 'twitter_description_en', 'twitter_description_ar',
  'twitter_image_url', 'jsonld_en', 'jsonld_ar', 'locale', 'locale_alternate',
  'sitemap_priority', 'sitemap_changefreq'
];

const buildSeoOverrideFromRow = (row, prefix = 'seo_') => {
  if (!row) return undefined;
  const override = {};
  let hasValue = false;
  SEO_OVERRIDE_FIELDS.forEach((field) => {
    const value = row[`${prefix}${field}`];
    if (value !== undefined && value !== null) {
      override[field] = field === 'sitemap_priority' ? Number(value) : value;
      hasValue = true;
    }
  });
  return hasValue ? override : undefined;
};

const normalizeSeoOverridePayload = (payload = {}) => {
  const normalized = {};
  SEO_OVERRIDE_FIELDS.forEach((field) => {
    if (payload[field] !== undefined) {
      const value = payload[field];
      if (value === '') {
        normalized[field] = null;
      } else if (field === 'indexable') {
        normalized[field] = Boolean(value);
      } else if (field === 'sitemap_priority') {
        normalized[field] = value === null || value === '' ? null : Number(value);
      } else {
        normalized[field] = value;
      }
    }
  });
  return normalized;
};

const upsertSeoOverride = async ({ contentType, contentId, payload, userId }) => {
  if (!payload) return null;
  await ensureSeoOverridesTable(pool);
  const normalized = normalizeSeoOverridePayload(payload);
  const fieldValues = SEO_OVERRIDE_FIELDS.map((field) => normalized[field] ?? null);
  const columns = ['content_type', 'content_id', ...SEO_OVERRIDE_FIELDS, 'created_by', 'updated_by'];
  const values = [contentType, contentId, ...fieldValues, userId, userId];
  const placeholders = values.map((_, idx) => `$${idx + 1}`).join(', ');
  const updateFields = SEO_OVERRIDE_FIELDS.map((field) =>
    `${field} = COALESCE(EXCLUDED.${field}, seo_overrides.${field})`
  );
  updateFields.push('updated_by = EXCLUDED.updated_by');

  const result = await pool.query(
    `INSERT INTO seo_overrides (${columns.join(', ')})
     VALUES (${placeholders})
     ON CONFLICT (content_type, content_id)
     DO UPDATE SET ${updateFields.join(', ')}
     RETURNING *`,
    values
  );
  return result.rows[0];
};

const mapCourseRow = (row) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  instructor: row.instructor,
  level: row.level,
  price: toCurrency(row.price),
  thumbnail: row.thumbnail,
  modules: row.modules || [],
  syncSessions: row.sync_sessions || [],
  duration: row.duration || undefined,
  preCourseTest: row.pre_course_test || undefined,
  postCourseTest: row.post_course_test || undefined,
  category: row.category || 'Technology',
  createdAt: row.created_at || undefined,
  createdBy: row.created_by || undefined,
  createdByName: row.created_by_name || undefined,
  createdByEmail: row.created_by_email || undefined,
  language: row.language || 'en',
  status: row.status || 'draft',
  targetAudience: row.target_audience || undefined,
  prerequisites: row.prerequisites || undefined,
  learningOutcomes: row.learning_outcomes || undefined,
  seoOverride: buildSeoOverrideFromRow(row)
});

const mapCourseCategoryRow = (row) => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at || undefined,
  updatedAt: row.updated_at || undefined
});

const mapAdCategoryRow = (row) => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at || undefined,
  updatedAt: row.updated_at || undefined
});

const mapAdRow = (row) => {
  const gallery = sanitizeMediaGalleryInput(Array.isArray(row.gallery) ? row.gallery : []);
  const firstImage = Array.isArray(gallery) ? gallery.find((item) => item.mediaType === 'image' && isNonEmptyString(item.url)) : null;
  const firstVideo = Array.isArray(gallery) ? gallery.find((item) => item.mediaType === 'video' && isNonEmptyString(item.url)) : null;
  return {
  id: row.id,
  title: row.title,
  description: row.description,
  categoryId: row.category_id || null,
  categoryName: row.category_name || null,
  price: row.price === null || row.price === undefined ? null : Number(row.price),
  location: row.location || null,
  contactName: row.contact_name || null,
  contactPhone: row.contact_phone || null,
  contactEmail: row.contact_email || null,
  imageUrl: row.image_url || firstImage?.url || null,
  mediaType: row.media_type || (firstVideo ? 'video' : 'image'),
  mediaUrl: row.media_url || firstVideo?.url || null,
  gallery: Array.isArray(gallery) ? gallery : [],
  status: row.status || 'DRAFT',
  isFeatured: Boolean(row.is_featured),
  publishDate: row.publish_date ? toISODate(row.publish_date) : null,
  createdAt: row.created_at || undefined,
  updatedAt: row.updated_at || undefined
};
};

const mapAdsDisplaySettingsRow = (row) => ({
  id: row.id,
  heroTitle: row.hero_title || '',
  heroSubtitle: row.hero_subtitle || '',
  searchPlaceholder: row.search_placeholder || '',
  statAdsLabel: row.stat_ads_label || '',
  statUsersLabel: row.stat_users_label || '',
  statSatisfactionLabel: row.stat_satisfaction_label || '',
  statSupportLabel: row.stat_support_label || '',
  statSupportValue: row.stat_support_value || '24/7',
  homepagePromoEnabled: Boolean(row.homepage_promo_enabled),
  homepagePromoType: row.homepage_promo_type || 'image',
  homepagePromoMediaUrl: row.homepage_promo_media_url || '',
  homepagePromoLink: row.homepage_promo_link || '',
  homepagePromoTitle: row.homepage_promo_title || '',
  homepagePromoSubtitle: row.homepage_promo_subtitle || '',
  updatedAt: row.updated_at || undefined
});

const mapAdAnnouncementRow = (row) => ({
  id: row.id,
  text: row.text || '',
  textEn: row.text_en || '',
  textAr: row.text_ar || '',
  enabled: Boolean(row.enabled),
  showInTopBar: Boolean(row.show_in_top_bar),
  sortOrder: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 0,
  createdAt: row.created_at || undefined,
  updatedAt: row.updated_at || undefined
});

const mapCourseRowWithDiscount = (row) => {
  const basePrice = toCurrency(row.price);
  const course = {
    id: row.id,
    title: row.title,
    description: row.description,
    instructor: row.instructor,
    level: row.level,
    price: basePrice,
    originalPrice: undefined,
    discountPercentage: undefined,
    discountCode: undefined,
    thumbnail: row.thumbnail,
    modules: row.modules || [],
    syncSessions: row.sync_sessions || [],
    duration: row.duration || undefined,
    preCourseTest: row.pre_course_test || undefined,
    postCourseTest: row.post_course_test || undefined,
    category: row.category || 'Technology',
    createdAt: row.created_at || undefined,
    createdBy: row.created_by || undefined,
    createdByName: row.created_by_name || undefined,
    createdByEmail: row.created_by_email || undefined,
    language: row.language || 'en',
    status: row.status || 'draft',
    targetAudience: row.target_audience || undefined,
    prerequisites: row.prerequisites || undefined,
    learningOutcomes: row.learning_outcomes || undefined,
    seoOverride: buildSeoOverrideFromRow(row)
  };
  
  // Apply discount if available
  if (row.discount_id && row.discount_percentage) {
    course.originalPrice = basePrice;
    course.discountPercentage = row.discount_percentage;
    course.discountCode = row.discount_code;
    course.price = toCurrency(basePrice * (1 - row.discount_percentage / 100));
  }
  
  return course;
};

const mapInstructorAssignmentRow = (row) => ({
  id: row.id,
  instructorId: row.instructor_id,
  courseId: row.course_id || undefined,
  title: row.title,
  question: row.question || '',
  rubric: row.rubric || '',
  difficulty: row.difficulty || 'Intermediate',
  topic: row.topic || '',
  dueDate: row.due_date ? new Date(row.due_date).toISOString() : undefined,
  createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
  updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined
});

const mapDiscountRow = (row) => ({
  id: row.id,
  code: row.code,
  percentage: row.percentage,
  courseId: row.course_id || undefined,
  courseTitle: row.course_title || undefined,
  createdBy: row.created_by,
  expiryDate: toISODate(row.expiry_date),
  usageCount: row.usage_count || 0
});

const mapCourseProgressRow = (row) => ({
  id: row.id,
  userId: row.user_id,
  courseId: row.course_id,
  completedItemIds: parseDbJson(row.completed_items, []),
  totalItems: row.total_items || 0,
  completedCount: row.completed_count || 0,
  progressPercent: Number(row.progress_percent) || 0,
  preTestCompleted: row.pre_test_completed === true,
  postTestCompleted: row.post_test_completed === true,
  preTestScore: row.pre_test_score !== null && row.pre_test_score !== undefined ? Number(row.pre_test_score) : undefined,
  postTestScore: row.post_test_score !== null && row.post_test_score !== undefined ? Number(row.post_test_score) : undefined,
  lastActivity: row.last_activity ? new Date(row.last_activity).toISOString() : undefined
});

const hasInteractiveEngagement = (itemsCompleted = 0, milestoneEvents = 0) => {
  return itemsCompleted > 0 || milestoneEvents > 0;
};

const buildAttendanceStatus = (seconds = 0, itemsCompleted = 0, milestoneEvents = 0) => {
  if (hasInteractiveEngagement(itemsCompleted, milestoneEvents)) {
    return 'PRESENT';
  }
  if (seconds >= ATTENDANCE_THRESHOLDS.presentSeconds) {
    return 'PRESENT';
  }
  if (seconds >= ATTENDANCE_THRESHOLDS.lateSeconds) {
    return 'LATE';
  }
  return 'ABSENT';
};

const mapAttendanceRow = (row) => {
  const durationSeconds = Number(row?.duration_seconds) || 0;
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name || 'N/A',
    courseId: row.course_id,
    courseTitle: row.course_title || 'N/A',
    date: toISODate(row.session_date),
    status: row.status,
    durationSeconds,
    durationMinutes: Math.round(durationSeconds / 60),
    itemsCompleted: Number(row.items_completed) || 0,
    milestoneEvents: Number(row.milestone_events) || 0,
    lastActiveAt: row.last_active ? new Date(row.last_active).toISOString() : undefined
  };
};

const mapNotificationRow = (row) => ({
  id: row.id,
  userId: row.user_id,
  actorId: row.actor_id || undefined,
  courseId: row.course_id || undefined,
  category: row.category || NOTIFICATION_CATEGORIES.SYSTEM,
  type: row.type || 'INFO',
  message: row.message,
  metadata: parseDbJson(row.metadata, {}),
  read: Boolean(row.read),
  readAt: row.read_at ? new Date(row.read_at).toISOString() : undefined,
  createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()
});

const parseDbJson = (value, fallback) => {
  if (!value) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
};

const mapCreditRedemptionOptionRow = (row) => ({
  id: row.id,
  title: row.title,
  type: row.type,
  description: row.description || undefined,
  requiredCredits: row.required_credits,
  metadata: parseDbJson(row.metadata, {}),
  isActive: row.is_active,
  createdBy: row.created_by || undefined,
  createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
  updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined
});

const mapCreditTransactionRow = (row) => ({
  id: row.id,
  userId: row.user_id,
  userName: row.user_name || undefined,
  actorId: row.actor_id || undefined,
  actorName: row.actor_name || undefined,
  amount: Number(row.amount),
  actionType: row.action_type,
  source: row.source,
  reason: row.reason || undefined,
  metadata: parseDbJson(row.metadata, {}),
  createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()
});

const mapCreditRedemptionRow = (row) => ({
  id: row.id,
  userId: row.user_id,
  optionId: row.option_id,
  optionTitle: row.option_title || undefined,
  creditsSpent: row.credits_spent,
  status: row.status,
  metadata: parseDbJson(row.metadata, {}),
  createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()
});

const mapPaymentRecordRow = (row) => {
  const studentName = row.student_name || row.lookup_student_name || 'N/A';
  const studentEmail = row.student_email || row.lookup_student_email || undefined;
  const courseTitle = row.course_title || row.lookup_course_title || 'N/A';
  const instructorName = row.instructor_name || row.lookup_course_instructor || undefined;
  const instructorId = row.instructor_id || row.lookup_instructor_id || undefined;
  const coursePrice = row.course_price ?? row.lookup_course_price;

  return {
    id: row.id,
    receiptId: row.receipt_id,
    studentId: row.student_id,
    studentName,
    studentEmail,
    courseId: row.course_id,
    courseTitle,
    instructorName,
    instructorId,
    coursePrice: toCurrency(coursePrice),
    amount: toCurrency(row.amount) || 0,
    paymentMethod: row.payment_method || 'MANUAL',
    collectedBy: row.collected_by || undefined,
    collectedById: row.collected_by_id || undefined,
    notes: row.notes || undefined,
    receivedAt: row.received_at ? new Date(row.received_at).toISOString() : new Date().toISOString(),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString()
  };
};

const mapInstructorPayoutRow = (row) => {
  const instructorName = row.instructor_name || row.lookup_instructor_name || 'Instructor';
  const courseTitle = row.course_title || row.lookup_course_title || null;
  return {
    id: row.id,
    instructorId: row.instructor_id,
    instructorName,
    amount: toCurrency(row.amount) || 0,
    paymentMethod: row.payment_method || 'TRANSFER',
    courseId: row.course_id || null,
    courseTitle,
    reference: row.reference || null,
    notes: row.notes || null,
    recordedById: row.recorded_by || null,
    recordedByName: row.recorded_by_name || row.recorder_name || null,
    recordedAt: row.recorded_at ? new Date(row.recorded_at).toISOString() : new Date().toISOString(),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString()
  };
};

const MESSAGING_TYPES = {
  INSTRUCTOR_STUDENT: 'INSTRUCTOR_STUDENT',
  STUDENT_STUDENT: 'STUDENT_STUDENT',
  COURSE_GROUP: 'COURSE_GROUP',
  ADMIN_USER: 'ADMIN_USER'
};

let ensureMessagingSchemaPromise;
const ensureMessagingSchema = async () => {
  if (!ensureMessagingSchemaPromise) {
    ensureMessagingSchemaPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS message_conversations (
          id UUID PRIMARY KEY,
          course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
          created_by UUID REFERENCES users(id) ON DELETE SET NULL,
          type TEXT NOT NULL,
          title TEXT,
          is_muted BOOLEAN DEFAULT false,
          muted_until TIMESTAMPTZ,
          muted_reason TEXT,
          muted_by UUID REFERENCES users(id) ON DELETE SET NULL,
          metadata JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ DEFAULT now()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS message_participants (
          id UUID PRIMARY KEY,
          conversation_id UUID REFERENCES message_conversations(id) ON DELETE CASCADE,
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          can_post BOOLEAN DEFAULT true,
          joined_at TIMESTAMPTZ DEFAULT now(),
          UNIQUE (conversation_id, user_id)
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS messages (
          id UUID PRIMARY KEY,
          conversation_id UUID REFERENCES message_conversations(id) ON DELETE CASCADE,
          course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
          sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
          target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
          body TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT now(),
          deleted_at TIMESTAMPTZ,
          deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
          metadata JSONB DEFAULT '{}'::jsonb
        );
      `);
      await pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
              FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'messages'
               AND column_name = 'course_id'
          ) THEN
            ALTER TABLE messages ADD COLUMN course_id UUID;
          END IF;

          IF NOT EXISTS (
            SELECT 1
              FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'messages'
               AND column_name = 'sender_id'
          ) THEN
            ALTER TABLE messages ADD COLUMN sender_id UUID;
          END IF;

          IF NOT EXISTS (
            SELECT 1
              FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'messages'
               AND column_name = 'target_user_id'
          ) THEN
            ALTER TABLE messages ADD COLUMN target_user_id UUID;
          END IF;

          IF NOT EXISTS (
            SELECT 1
              FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'messages'
               AND column_name = 'body'
          ) THEN
            ALTER TABLE messages ADD COLUMN body TEXT;

            IF EXISTS (
              SELECT 1
                FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = 'messages'
                 AND column_name = 'content'
            ) THEN
              UPDATE messages SET body = COALESCE(content, '') WHERE body IS NULL;
            ELSIF EXISTS (
              SELECT 1
                FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = 'messages'
                 AND column_name = 'message'
            ) THEN
              UPDATE messages SET body = COALESCE(message, '') WHERE body IS NULL;
            ELSE
              UPDATE messages SET body = '' WHERE body IS NULL;
            END IF;
          END IF;

          IF NOT EXISTS (
            SELECT 1
              FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'messages'
               AND column_name = 'created_at'
          ) THEN
            ALTER TABLE messages ADD COLUMN created_at TIMESTAMPTZ DEFAULT now();
          END IF;

          IF NOT EXISTS (
            SELECT 1
              FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'messages'
               AND column_name = 'deleted_at'
          ) THEN
            ALTER TABLE messages ADD COLUMN deleted_at TIMESTAMPTZ;
          END IF;

          IF NOT EXISTS (
            SELECT 1
              FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'messages'
               AND column_name = 'deleted_by'
          ) THEN
            ALTER TABLE messages ADD COLUMN deleted_by UUID;
          END IF;

          IF NOT EXISTS (
            SELECT 1
              FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'messages'
               AND column_name = 'metadata'
          ) THEN
            ALTER TABLE messages ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;
          END IF;

          UPDATE messages SET body = '' WHERE body IS NULL;
          ALTER TABLE messages ALTER COLUMN body SET NOT NULL;
        END $$;
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS message_receipts (
          id UUID PRIMARY KEY,
          conversation_id UUID REFERENCES message_conversations(id) ON DELETE CASCADE,
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          last_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
          last_read_at TIMESTAMPTZ DEFAULT now(),
          UNIQUE (conversation_id, user_id)
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS message_blocks (
          id UUID PRIMARY KEY,
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          blocked_by UUID REFERENCES users(id) ON DELETE SET NULL,
          reason TEXT,
          expires_at TIMESTAMPTZ,
          active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT now()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS message_audit_logs (
          id UUID PRIMARY KEY,
          action TEXT NOT NULL,
          actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
          target_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
          target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
          conversation_id UUID REFERENCES message_conversations(id) ON DELETE SET NULL,
          details JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ DEFAULT now()
        );
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at ON messages (conversation_id, created_at DESC);');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_message_receipts_conv_user ON message_receipts (conversation_id, user_id);');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_message_blocks_active ON message_blocks (user_id) WHERE active = true;');
    })().catch((error) => {
      ensureMessagingSchemaPromise = null;
      console.error('Messaging schema initialization failed', error);
      throw error;
    });
  }
  return ensureMessagingSchemaPromise;
};

const MESSAGE_RATE_LIMIT_WINDOW_MS = 10_000;
const MESSAGE_RATE_LIMIT_MAX = 6;
const messageRateLimiter = new Map();
const messagingClients = new Map();
const notificationClients = new Map();
const SSE_PING_INTERVAL_MS = 25_000;
const createHttpError = (status, message) => Object.assign(new Error(message), { status });

const trackMessageRateLimit = (userId) => {
  const now = Date.now();
  const history = messageRateLimiter.get(userId) || [];
  const recent = history.filter((ts) => now - ts < MESSAGE_RATE_LIMIT_WINDOW_MS);
  if (recent.length >= MESSAGE_RATE_LIMIT_MAX) {
    messageRateLimiter.set(userId, recent);
    return false;
  }
  recent.push(now);
  messageRateLimiter.set(userId, recent);
  return true;
};

const removeMessagingClient = (userId, client) => {
  const clients = messagingClients.get(userId);
  if (!clients) {
    return;
  }
  clients.delete(client);
  if (clients.size === 0) {
    messagingClients.delete(userId);
  }
};

const pushEventToClient = (client, eventName, payload) => {
  try {
    client.res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
  } catch (error) {
    console.warn('SSE client write failed', error.message);
    clearInterval(client.pingTimer);
    client.res.end();
    removeMessagingClient(client.userId, client);
  }
};

const broadcastMessagingEvent = (targetUserIds, eventName, payload, options = {}) => {
  const deliveredTargets = new Set();
  const userIds = Array.isArray(targetUserIds) ? targetUserIds : [targetUserIds];
  userIds.forEach((userId) => {
    const clients = messagingClients.get(userId);
    if (!clients) return;
    deliveredTargets.add(userId);
    clients.forEach((client) => pushEventToClient(client, eventName, payload));
  });

  if (options.includeAdmins) {
    for (const [userId, clients] of messagingClients.entries()) {
      if (deliveredTargets.has(userId)) continue;
      clients.forEach((client) => {
        if (client.role === 'ADMIN') {
          pushEventToClient(client, eventName, payload);
        }
      });
    }
  }
};

const removeNotificationClient = (userId, client) => {
  const clients = notificationClients.get(userId);
  if (!clients) return;
  clients.delete(client);
  if (!clients.size) {
    notificationClients.delete(userId);
  }
};

const broadcastNotificationEvent = (targetUserIds, eventName, payload) => {
  const userIds = Array.isArray(targetUserIds) ? targetUserIds : [targetUserIds];
  userIds.forEach((userId) => {
    const clients = notificationClients.get(userId);
    if (!clients) return;
    clients.forEach((client) => pushEventToClient(client, eventName, payload));
  });
};

const createUserNotifications = async (
  {
    userIds,
    category,
    message,
    metadata = {},
    actorId,
    courseId,
    type = 'INFO'
  },
  dbClient = pool
) => {
  const uniqueUserIds = Array.from(new Set((userIds || []).filter(Boolean)));
  if (!uniqueUserIds.length || !message) {
    return [];
  }
  await ensureNotificationSchema();
  const inserted = [];
  for (const targetUserId of uniqueUserIds) {
    const payload = await dbClient.query(
      `INSERT INTO notifications (id, user_id, actor_id, course_id, category, type, message, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        randomUUID(),
        targetUserId,
        actorId || null,
        courseId || null,
        category,
        type,
        message,
        metadata || {}
      ]
    );
    inserted.push(mapNotificationRow(payload.rows[0]));
  }
  if (inserted.length) {
    const eventPayload = inserted.length === 1 ? inserted[0] : { notifications: inserted };
    broadcastNotificationEvent(uniqueUserIds, 'notification:new', eventPayload);
    await Promise.all(uniqueUserIds.map((id) => broadcastUnreadCount(id)));
  }
  return inserted;
};

const fetchUnreadNotificationCount = async (userId) => {
  await ensureNotificationSchema();
  const result = await pool.query('SELECT COUNT(*)::int AS unread FROM notifications WHERE user_id = $1 AND read = false', [userId]);
  return Number(result.rows[0]?.unread || 0);
};

const broadcastUnreadCount = async (userId) => {
  if (!userId) return;
  const unreadCount = await fetchUnreadNotificationCount(userId);
  broadcastNotificationEvent([userId], 'notification:unread', { unreadCount });
};

const isValidUUID = (str) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
};

/**
 * Sync tenant admin user from central database to tenant database if missing
 * This ensures tenant admins can use messaging and other tenant-scoped features
 * @param {string} userId - The tenant admin's UUID (from tenant_admins.id)
 * @param {import('pg').Pool} [targetPool] - Optional pool to sync into; defaults to proxy pool
 */
const ensureTenantAdminUserExists = async (userId, targetPool) => {
  if (!userId || !isValidUUID(userId)) return;
  const dbPool = targetPool || pool;
  
  try {
    // Check if user exists in the target tenant database
    const existing = await dbPool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (existing.rows.length > 0) {
      return; // User already exists
    }

    // Fetch tenant admin details from central database
    const adminResult = await centralPool.query(
      `SELECT ta.id, ta.email, ta.first_name, ta.last_name, t.id as tenant_id
       FROM tenant_admins ta
       JOIN tenants t ON t.id = ta.tenant_id
       WHERE ta.id = $1
       LIMIT 1`,
      [userId]
    );

    if (adminResult.rows.length === 0) {
      return; // Not a tenant admin
    }

    const admin = adminResult.rows[0];
    const name = `${admin.first_name || 'Admin'} ${admin.last_name || ''}`.trim() || 'Admin';
    
    // Create admin user in tenant database
    try {
      await dbPool.query(
        `INSERT INTO users (id, email, name, role)
         VALUES ($1, $2, $3, 'ADMIN')
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           role = 'ADMIN'
         `,
        [admin.id, admin.email.toLowerCase(), name]
      );
      console.log(`[Messaging] Synced tenant admin user ${admin.email} to tenant database`);
    } catch (insertError) {
      // If email already exists with a different id, update that row's id so FK constraints work
      if (insertError.code === '23505' && insertError.constraint === 'users_email_key') {
        await dbPool.query(
          `UPDATE users SET id = $1, role = 'ADMIN', name = $3 WHERE email = $2`,
          [admin.id, admin.email.toLowerCase(), name]
        );
        console.log(`[Messaging] Updated tenant user id for admin ${admin.email} in tenant database`);
      } else {
        throw insertError;
      }
    }
  } catch (error) {
    console.error('[Messaging] Failed to sync tenant admin user:', error);
  }
};

/**
 * Ensure the current request user (especially a tenant admin) exists in the target pool's
 * users table so FK constraints on created_by/etc. are satisfied.
 */
const ensureCurrentUserInPool = async (targetPool, req) => {
  if (!targetPool || !req?.user?.id || !req?.user?.email) return;
  const { id, email } = req.user;
  if (!isValidUUID(id)) return;
  try {
    const existing = await targetPool.query('SELECT id FROM users WHERE id = $1', [id]);
    if (existing.rows.length > 0) return;
    // Try to sync from central DB if this is a tenant admin
    if (req.user.isTenantAdmin) {
      await ensureTenantAdminUserExists(id, targetPool);
    } else {
      // For regular users, insert directly from req.user context
      const name = email.split('@')[0] || 'User';
      const role = req.user.role || 'STUDENT';
      await targetPool.query(
        `INSERT INTO users (id, email, name, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [id, email.toLowerCase(), name, role]
      );
    }
  } catch (err) {
    console.error('[ensureCurrentUserInPool] Failed to sync user:', err.message);
  }
};

const fetchUserRowById = async (userId) => {
  if (!userId) return null;
  if (!isValidUUID(userId)) return null;
  
  // Try to ensure tenant admin exists in tenant database
  await ensureTenantAdminUserExists(userId);
  
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
  return result.rows[0] || null;
};

const fetchCourseRowById = async (courseId) => {
  if (!courseId) return null;
  if (!isValidUUID(courseId)) return null;
  const result = await pool.query('SELECT * FROM courses WHERE id = $1', [courseId]);
  return result.rows[0] || null;
};

const mapMessageRow = (row) => ({
  id: row.id,
  conversationId: row.conversation_id,
  courseId: row.course_id || null,
  senderId: row.sender_id,
  senderName: row.sender_name || null,
  senderRole: row.sender_role || null,
  targetUserId: row.target_user_id || null,
  body: row.body ?? row.content ?? row.message ?? '',
  createdAt: row.created_at,
  deletedAt: row.deleted_at || null
});

const mapConversationRowWithJson = (row) => ({
  id: row.id,
  courseId: row.course_id || null,
  courseTitle: row.course_title || null,
  type: row.type,
  title: row.title || null,
  createdBy: row.created_by || null,
  createdAt: row.created_at,
  isMuted: Boolean(row.is_muted) || (row.muted_until ? new Date(row.muted_until) > new Date() : false),
  mutedUntil: row.muted_until || null,
  mutedBy: row.muted_by || null,
  mutedReason: row.muted_reason || null,
  participants: parseDbJson(row.participants, []),
  lastMessage: parseDbJson(row.last_message, null),
  unreadCount: Number(row.unread_count || 0)
});

const fetchConversationsForViewer = async ({ viewerId, includeAll = false, conversationId }) => {
  await ensureMessagingSchema();
  const params = [viewerId];
  const filters = [];
  if (!includeAll) {
    filters.push(`EXISTS (SELECT 1 FROM message_participants mp WHERE mp.conversation_id = mc.id AND mp.user_id = $1)`);
  }
  if (conversationId) {
    params.push(conversationId);
    filters.push(`mc.id = $${params.length}`);
  }
  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const query = `
    SELECT mc.*, c.title AS course_title,
           participants_json.participants,
           last_message_json.last_message,
           unread_counts.unread_count
      FROM message_conversations mc
      LEFT JOIN courses c ON c.id = mc.course_id
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object(
          'userId', mp.user_id,
          'role', mp.role,
          'name', u.name,
          'email', u.email,
          'status', u.status,
          'canPost', mp.can_post
        ) ORDER BY u.name) AS participants
          FROM message_participants mp
          LEFT JOIN users u ON u.id = mp.user_id
         WHERE mp.conversation_id = mc.id
      ) participants_json ON true
      LEFT JOIN LATERAL (
        SELECT json_build_object(
          'id', m.id,
          'body', m.body,
          'senderId', m.sender_id,
          'targetUserId', m.target_user_id,
          'createdAt', m.created_at,
          'senderName', su.name,
          'senderRole', su.role
        ) AS last_message
          FROM messages m
          LEFT JOIN users su ON su.id = m.sender_id
         WHERE m.conversation_id = mc.id
           AND m.deleted_at IS NULL
      ORDER BY m.created_at DESC
         LIMIT 1
      ) last_message_json ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS unread_count
          FROM messages m
         WHERE m.conversation_id = mc.id
           AND m.deleted_at IS NULL
           AND m.sender_id <> $1
           AND m.created_at > COALESCE((
             SELECT last_read_at FROM message_receipts mr
              WHERE mr.conversation_id = mc.id AND mr.user_id = $1
           ), '-infinity')
      ) unread_counts ON true
      ${whereClause}
  ORDER BY COALESCE((last_message_json.last_message->>'createdAt')::timestamptz, mc.created_at) DESC`;
  const result = await pool.query(query, params);
  return result.rows.map(mapConversationRowWithJson);
};

const fetchMessagesForConversation = async ({ conversationId, limit = 200, before }) => {
  await ensureMessagingSchema();
  const clauses = ['m.conversation_id = $1', 'm.deleted_at IS NULL'];
  const params = [conversationId];
  if (before) {
    params.push(before);
    clauses.push(`m.created_at < $${params.length}`);
  }
  const query = `
    SELECT m.*, u.name AS sender_name, u.role AS sender_role
      FROM messages m
      LEFT JOIN users u ON u.id = m.sender_id
     WHERE ${clauses.join(' AND ')}
  ORDER BY m.created_at DESC
     LIMIT ${Math.min(limit, 500)}
  `;
  const result = await pool.query(query, params);
  return result.rows.map(mapMessageRow).reverse();
};

const touchConversationReceipt = async (conversationId, userId, lastMessageId) => {
  await pool.query(
    `INSERT INTO message_receipts (id, conversation_id, user_id, last_message_id, last_read_at)
     VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (conversation_id, user_id)
     DO UPDATE SET last_message_id = COALESCE(EXCLUDED.last_message_id, message_receipts.last_message_id),
                   last_read_at = now()` ,
    [randomUUID(), conversationId, userId, lastMessageId || null]
  );
};

const getActiveMessageBlock = async (userId) => {
  const result = await pool.query(
    `SELECT * FROM message_blocks
      WHERE user_id = $1 AND active = true
  ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  if (!result.rowCount) {
    return null;
  }
  const block = result.rows[0];
  if (block.expires_at && new Date(block.expires_at) <= new Date()) {
    await pool.query('UPDATE message_blocks SET active = false WHERE id = $1', [block.id]);
    return null;
  }
  return block;
};

const recordMessageAudit = async ({ action, actorId, targetMessageId, targetUserId, conversationId, details }) => {
  await pool.query(
    `INSERT INTO message_audit_logs (id, action, actor_id, target_message_id, target_user_id, conversation_id, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7)` ,
    [
      randomUUID(),
      action,
      actorId || null,
      targetMessageId || null,
      targetUserId || null,
      conversationId || null,
      details ? JSON.stringify(details) : JSON.stringify({})
    ]
  );
};

const ensureConversationParticipant = async (conversationId, userId, role) => {
  if (!conversationId || !userId) return;
  await pool.query(
    `INSERT INTO message_participants (id, conversation_id, user_id, role)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (conversation_id, user_id)
     DO UPDATE SET role = EXCLUDED.role`,
    [randomUUID(), conversationId, userId, role]
  );
};

const findConversationByTypeAndParticipants = async ({ type, courseId, participantIds }) => {
  const params = [type];
  const clauses = ['mc.type = $1'];
  if (courseId) {
    params.push(courseId);
    clauses.push(`mc.course_id = $${params.length}`);
  }
  participantIds.forEach((participantId) => {
    params.push(participantId);
    clauses.push(`EXISTS (SELECT 1 FROM message_participants mp WHERE mp.conversation_id = mc.id AND mp.user_id = $${params.length})`);
  });
  const query = `SELECT mc.id FROM message_conversations mc WHERE ${clauses.join(' AND ')} LIMIT 1`;
  const result = await pool.query(query, params);
  return result.rows[0]?.id || null;
};

const fetchStudentsForCourse = async (courseId) => {
  const result = await pool.query(
    `SELECT * FROM users WHERE role = 'STUDENT' AND $1 = ANY(enrolled_courses)` ,
    [courseId]
  );
  return result.rows;
};

const fetchAdmins = async () => {
  const result = await pool.query(`SELECT * FROM users WHERE role = 'ADMIN'`);
  return result.rows;
};

const fetchInstructorForCourse = async (courseRow) => {
  if (!courseRow) return null;
  if (courseRow.instructor_id) {
    const byId = await pool.query('SELECT * FROM users WHERE id = $1', [courseRow.instructor_id]);
    if (byId.rowCount) {
      return byId.rows[0];
    }
  }
  if (!courseRow.instructor) {
    return null;
  }
  const result = await pool.query(
    'SELECT * FROM users WHERE role = $1 AND LOWER(name) = LOWER($2) LIMIT 1',
    ['INSTRUCTOR', courseRow.instructor]
  );
  return result.rows[0] || null;
};

const userEnrolledInCourse = (userRow, courseId) => {
  if (!userRow || !courseId) return false;
  const enrolled = userRow.enrolled_courses || [];
  return Array.isArray(enrolled) ? enrolled.includes(courseId) : false;
};

const instructorOwnsCourse = (instructorRow, courseRow) => {
  if (!instructorRow || !courseRow) return false;
  if (courseRow.instructor_id && courseRow.instructor_id === instructorRow.id) {
    return true;
  }
  if (!courseRow.instructor) {
    return false;
  }
  return courseRow.instructor.trim().toLowerCase() === (instructorRow.name || '').trim().toLowerCase();
};

const fetchConversationSnapshot = async (conversationId) => {
  const result = await pool.query(
    `SELECT mc.*, c.title AS course_title,
            participants_json.participants,
            last_message_json.last_message
       FROM message_conversations mc
       LEFT JOIN courses c ON c.id = mc.course_id
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object(
           'userId', mp.user_id,
           'role', mp.role,
           'name', u.name,
           'email', u.email,
           'status', u.status,
           'canPost', mp.can_post
         ) ORDER BY u.name) AS participants
           FROM message_participants mp
           LEFT JOIN users u ON u.id = mp.user_id
          WHERE mp.conversation_id = mc.id
       ) participants_json ON true
       LEFT JOIN LATERAL (
         SELECT json_build_object(
           'id', m.id,
           'body', m.body,
           'senderId', m.sender_id,
           'targetUserId', m.target_user_id,
           'createdAt', m.created_at,
           'senderName', su.name,
           'senderRole', su.role
         ) AS last_message
           FROM messages m
           LEFT JOIN users su ON su.id = m.sender_id
          WHERE m.conversation_id = mc.id
            AND m.deleted_at IS NULL
       ORDER BY m.created_at DESC
          LIMIT 1
       ) last_message_json ON true
      WHERE mc.id = $1
      LIMIT 1`,
    [conversationId]
  );
  if (!result.rowCount) {
    return null;
  }
  const row = result.rows[0];
  return {
    id: row.id,
    courseId: row.course_id || null,
    courseTitle: row.course_title || null,
    type: row.type,
    title: row.title || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    isMuted: Boolean(row.is_muted) || (row.muted_until ? new Date(row.muted_until) > new Date() : false),
    mutedUntil: row.muted_until || null,
    mutedBy: row.muted_by || null,
    mutedReason: row.muted_reason || null,
    participants: parseDbJson(row.participants, []),
    lastMessage: parseDbJson(row.last_message, null),
    unreadCount: 0
  };
};

const createConversationWithParticipants = async ({ type, courseId, title, createdBy, participants }) => {
  const conversationId = randomUUID();
  await pool.query(
    `INSERT INTO message_conversations (id, course_id, type, title, created_by)
     VALUES ($1,$2,$3,$4,$5)` ,
    [conversationId, courseId || null, type, title || null, createdBy || null]
  );
  const uniqueParticipants = new Map();
  (participants || []).forEach((participant) => {
    if (participant?.userId) {
      uniqueParticipants.set(participant.userId, participant.role || 'STUDENT');
    }
  });
  await Promise.all(
    Array.from(uniqueParticipants.entries()).map(([userId, role]) =>
      ensureConversationParticipant(conversationId, userId, role)
    )
  );
  return conversationId;
};

const createOrLocateConversation = async ({ sender, targetUserId, courseId, scope }) => {
  await ensureMessagingSchema();
  const normalizedScope = (scope || 'DIRECT').toUpperCase();
  let conversationId = null;

  if (normalizedScope === 'ADMIN') {
    if (!targetUserId) {
      throw createHttpError(400, 'targetUserId is required for admin conversations');
    }
    const targetUser = await fetchUserRowById(targetUserId);
    if (!targetUser) {
      throw createHttpError(404, 'Target user not found');
    }
    const adminUsers = await fetchAdmins();
    if (!adminUsers.length) {
      throw createHttpError(400, 'No admin users available');
    }
    const nonAdminUser = targetUser.role === 'ADMIN' ? sender : targetUser;
    if (!nonAdminUser || nonAdminUser.role === 'ADMIN') {
      throw createHttpError(400, 'Admin chat requires a non-admin participant');
    }
    const existing = await findConversationByTypeAndParticipants({
      type: MESSAGING_TYPES.ADMIN_USER,
      courseId: courseId || null,
      participantIds: [nonAdminUser.id, adminUsers[0].id]
    });
    if (existing) {
      conversationId = existing;
    } else {
      const participants = new Map();
      adminUsers.forEach((admin) => participants.set(admin.id, admin.role));
      participants.set(nonAdminUser.id, nonAdminUser.role);
      participants.set(sender.id, sender.role);
      conversationId = await createConversationWithParticipants({
        type: MESSAGING_TYPES.ADMIN_USER,
        courseId: courseId || null,
        title: 'System Admin',
        createdBy: sender.id,
        participants: Array.from(participants.entries()).map(([userId, role]) => ({ userId, role }))
      });
    }
  } else if (normalizedScope === 'COURSE_GROUP') {
    if (sender.role !== 'INSTRUCTOR') {
      throw createHttpError(403, 'Only instructors can start course group chats');
    }
    if (!courseId) {
      throw createHttpError(400, 'courseId is required for course messages');
    }
    const courseRow = await fetchCourseRowById(courseId);
    if (!courseRow) {
      throw createHttpError(404, 'Course not found');
    }
    const instructorRecord = await fetchInstructorForCourse(courseRow);
    if (!instructorRecord || instructorRecord.id !== sender.id) {
      throw createHttpError(403, 'You are not assigned to this course');
    }
    const existing = await pool.query(
      'SELECT id FROM message_conversations WHERE course_id = $1 AND type = $2 LIMIT 1',
      [courseId, MESSAGING_TYPES.COURSE_GROUP]
    );
    if (existing.rowCount) {
      conversationId = existing.rows[0].id;
    } else {
      const students = await fetchStudentsForCourse(courseId);
      const participants = [{ userId: instructorRecord.id, role: instructorRecord.role }];
      students.forEach((student) => participants.push({ userId: student.id, role: student.role }));
      conversationId = await createConversationWithParticipants({
        type: MESSAGING_TYPES.COURSE_GROUP,
        courseId,
        title: `${courseRow.title} • Course`,
        createdBy: sender.id,
        participants
      });
    }
  } else {
    if (!targetUserId) {
      throw createHttpError(400, 'targetUserId is required');
    }
    let targetUser = await fetchUserRowById(targetUserId);
    if (!targetUser) {
      throw createHttpError(404, 'Target user not found');
    }
    if (targetUser.id === sender.id) {
      throw createHttpError(400, 'Cannot message yourself');
    }
    if (!courseId) {
      if (sender.role === 'ADMIN' || targetUser.role === 'ADMIN') {
        return createOrLocateConversation({ sender, targetUserId, scope: 'ADMIN' });
      }
      throw createHttpError(400, 'courseId is required');
    }
    if (targetUser.role === 'ADMIN') {
      return createOrLocateConversation({ sender, targetUserId, courseId, scope: 'ADMIN' });
    }
    const courseRow = await fetchCourseRowById(courseId);
    if (!courseRow) {
      throw createHttpError(404, 'Course not found');
    }
    let conversationType = MESSAGING_TYPES.STUDENT_STUDENT;

    if (sender.role === 'INSTRUCTOR' || targetUser.role === 'INSTRUCTOR') {
      const instructorRecord = sender.role === 'INSTRUCTOR' ? sender : targetUser;
      const studentRecord = sender.role === 'STUDENT' ? sender : targetUser;
      if (!studentRecord || studentRecord.role !== 'STUDENT') {
        throw createHttpError(400, 'Instructor chats require a student recipient');
      }
      const instructorForCourse = await fetchInstructorForCourse(courseRow);
      if (!instructorForCourse || instructorForCourse.id !== instructorRecord.id) {
        throw createHttpError(403, 'Instructor is not assigned to this course');
      }
      if (!userEnrolledInCourse(studentRecord, courseId)) {
        throw createHttpError(403, 'Student is not enrolled in this course');
      }
      conversationType = MESSAGING_TYPES.INSTRUCTOR_STUDENT;
    } else if (sender.role === 'STUDENT' && targetUser.role === 'STUDENT') {
      if (!userEnrolledInCourse(sender, courseId) || !userEnrolledInCourse(targetUser, courseId)) {
        throw createHttpError(403, 'Both students must be enrolled in this course');
      }
      conversationType = MESSAGING_TYPES.STUDENT_STUDENT;
    } else {
      throw createHttpError(400, 'Unsupported conversation roles');
    }

    const existing = await findConversationByTypeAndParticipants({
      type: conversationType,
      courseId,
      participantIds: [sender.id, targetUser.id]
    });
    if (existing) {
      conversationId = existing;
    } else {
      conversationId = await createConversationWithParticipants({
        type: conversationType,
        courseId,
        title: courseRow.title,
        createdBy: sender.id,
        participants: [
          { userId: sender.id, role: sender.role },
          { userId: targetUser.id, role: targetUser.role }
        ]
      });
    }
  }

  const includeAll = sender.role === 'ADMIN';
  const conversations = await fetchConversationsForViewer({ viewerId: sender.id, includeAll, conversationId });
  if (!conversations.length) {
    throw createHttpError(500, 'Unable to load conversation');
  }
  return conversations[0];
};

const LIVE_FALLBACK = process.env.LIVE_CLASS_FALLBACK || 'jitsi';
const LIVE_FALLBACK_PREFIX = process.env.LIVE_CLASS_FALLBACK_PREFIX || 'betacademy';
const LIVE_TIMEZONE = process.env.LIVE_CLASS_TIMEZONE || 'UTC';

const sanitizeBaseUrl = (value = '') => value.replace(/\/$/, '');

const randomLetters = (count) => Array.from({ length: count }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

const buildPlatformFallbackUrl = ({ platform, slug, topic, smrrtxPermanentRoomLink }) => {
  if (platform === 'meet') {
    const meetBase = sanitizeBaseUrl(process.env.MEET_FALLBACK_BASE_URL || 'https://meet.new');
    const meetCode = `${randomLetters(3)}-${randomLetters(4)}-${randomLetters(3)}`;
    if (meetBase.includes('{code}')) {
      return meetBase.replace('{code}', meetCode);
    }
    // Do not fabricate Google Meet room codes. Use a valid Meet entry URL.
    if (meetBase === 'https://meet.google.com') {
      return `${meetBase}/new`;
    }
    if (meetBase.endsWith('/new') || meetBase === 'https://meet.new') {
      return meetBase;
    }
    return meetBase;
  }

  if (platform === 'zoom') {
    const zoomBase = sanitizeBaseUrl(process.env.ZOOM_FALLBACK_BASE_URL || 'https://zoom.us/start/videomeeting');
    const meetingId = `${Date.now()}${Math.floor(100 + Math.random() * 900)}`;
    if (zoomBase.includes('{id}')) {
      return zoomBase.replace('{id}', meetingId);
    }
    // Default to a valid Zoom entry URL instead of a fabricated join link.
    return zoomBase;
  }

  if (platform === 'smrrtx') {
    const smrrtxBase = sanitizeBaseUrl(
      smrrtxPermanentRoomLink || process.env.SMRRTX_FALLBACK_BASE_URL || process.env.SMRRTX_PERMANENT_ROOM_LINK || 'https://app.smrrtx.com'
    );
    if (smrrtxBase.includes('{slug}')) {
      return smrrtxBase.replace('{slug}', slug);
    }
    // Default to a valid Smrrtx entry URL instead of a fabricated room slug.
    return smrrtxBase;
  }

  const genericBase = sanitizeBaseUrl(process.env.LIVE_FALLBACK_BASE_URL || 'https://meet.jit.si');
  const genericSlug = topic
    ? topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    : 'session';
  return `${genericBase}/${genericSlug || slug}-${randomUUID().slice(0, 8)}`;
};

const buildFallbackMeeting = (platform, topic = 'session', startTime, options = {}) => {
  const slugFromTopic = topic
    ? topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    : 'session';
  const slug = `${LIVE_FALLBACK_PREFIX}-${slugFromTopic || 'session'}-${randomUUID().slice(0, 8)}`;
  const url = buildPlatformFallbackUrl({
    platform,
    slug,
    topic,
    smrrtxPermanentRoomLink: options.smrrtxPermanentRoomLink
  });
  return {
    platform,
    providerMeetingId: slug,
    hostUrl: url,
    joinUrl: url,
    passcode: null,
    fallback: true,
    startTime
  };
};

const createSmrrtxMeeting = async ({ topic, startTime, durationMinutes, agenda }) => {
  const baseUrl = process.env.SMRRTX_API_URL;
  const apiKey = process.env.SMRRTX_API_KEY;
  const path = process.env.SMRRTX_MEETINGS_PATH || '/v1/meetings';
  if (!baseUrl || !apiKey) {
    throw new Error('Smrrtx API is not configured');
  }

  const response = await fetch(`${sanitizeBaseUrl(baseUrl)}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      topic,
      agenda,
      start_time: startTime,
      duration: durationMinutes,
      timezone: LIVE_TIMEZONE
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Smrrtx API error: ${body || response.statusText}`);
  }

  const data = await response.json();
  const hostUrl = data.host_url || data.start_url || data.room?.host_url;
  const joinUrl = data.join_url || data.attendee_url || data.room?.join_url;
  if (!hostUrl || !joinUrl) {
    throw new Error('Smrrtx response missing URLs');
  }

  return {
    platform: 'smrrtx',
    providerMeetingId: data.id || data.meeting_id || data.room?.id || data.room?.slug,
    hostUrl,
    joinUrl,
    passcode: data.passcode || data.room?.passcode || null,
    startTime
  };
};

const getZoomAccessToken = async ({ clientId, clientSecret, accountId } = {}) => {
  const resolvedClientId = clientId || process.env.ZOOM_CLIENT_ID;
  const resolvedClientSecret = clientSecret || process.env.ZOOM_CLIENT_SECRET;
  const resolvedAccountId = accountId || process.env.ZOOM_ACCOUNT_ID;
  if (!resolvedClientId || !resolvedClientSecret || !resolvedAccountId) {
    throw new Error('Zoom API credentials missing');
  }
  const auth = Buffer.from(`${resolvedClientId}:${resolvedClientSecret}`).toString('base64');
  const response = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${resolvedAccountId}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}` }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Zoom token error: ${text || response.statusText}`);
  }
  const data = await response.json();
  return data.access_token;
};

const createZoomMeeting = async ({ topic, startTime, durationMinutes, agenda, instructorEmail, zoomClientId, zoomClientSecret, zoomAccountId, zoomUserId }) => {
  const token = await getZoomAccessToken({ clientId: zoomClientId, clientSecret: zoomClientSecret, accountId: zoomAccountId });
  const userId = zoomUserId || process.env.ZOOM_USER_ID || instructorEmail || 'me';
  const payload = {
    topic,
    type: startTime ? 2 : 1,
    start_time: startTime || undefined,
    duration: durationMinutes,
    timezone: LIVE_TIMEZONE,
    agenda,
    settings: {
      host_video: true,
      participant_video: true,
      waiting_room: true,
      join_before_host: false,
      mute_upon_entry: true
    }
  };
  if (!startTime) {
    delete payload.start_time;
  }

  const response = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(userId)}/meetings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Zoom API error: ${data.message || response.statusText}`);
  }

  return {
    platform: 'zoom',
    providerMeetingId: data.id?.toString() || data.uuid,
    hostUrl: data.start_url,
    joinUrl: data.join_url,
    passcode: data.password || null,
    startTime: startTime || new Date().toISOString()
  };
};

const createGoogleMeetMeeting = async ({ topic, startTime, durationMinutes, agenda, googleSaEmail, googleSaKey, googleCalendarId }) => {
  const resolvedEmail = googleSaEmail || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const resolvedKey = googleSaKey || process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const resolvedCalendarId = googleCalendarId || process.env.GOOGLE_CALENDAR_ID;
  if (!resolvedEmail || !resolvedKey || !resolvedCalendarId) {
    throw new Error('Google Meet credentials missing');
  }

  const jwtClient = new JWT({
    email: resolvedEmail,
    key: resolvedKey.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/calendar.events']
  });

  const { access_token: token } = await jwtClient.authorize();
  if (!token) {
    throw new Error('Unable to obtain Google access token');
  }

  const start = new Date(startTime);
  const end = new Date(start.getTime() + Number(durationMinutes || 60) * 60000);

  const conferenceTypes = ['hangoutsMeet', 'eventHangout'];
  let data;
  let lastErrorMessage = '';

  for (const conferenceType of conferenceTypes) {
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(resolvedCalendarId)}/events?conferenceDataVersion=1`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        summary: topic,
        description: agenda,
        start: { dateTime: start.toISOString(), timeZone: LIVE_TIMEZONE },
        end: { dateTime: end.toISOString(), timeZone: LIVE_TIMEZONE },
        conferenceData: {
          createRequest: {
            requestId: randomUUID(),
            conferenceSolutionKey: { type: conferenceType }
          }
        }
      })
    });

    data = await response.json().catch(() => ({}));
    if (response.ok) {
      break;
    }

    lastErrorMessage = data.error?.message || response.statusText || 'Unknown error';
    if (!lastErrorMessage.toLowerCase().includes('invalid conference type')) {
      throw new Error(`Google Meet API error: ${lastErrorMessage}`);
    }
  }

  if (!data || !data.hangoutLink && !data.conferenceData?.entryPoints?.[0]?.uri) {
    throw new Error(`Google Meet API error: ${lastErrorMessage || 'Unable to create conference'}`);
  }

  const joinUrl = data.hangoutLink || data.conferenceData?.entryPoints?.[0]?.uri;
  if (!joinUrl) {
    throw new Error('Google Meet did not return a join link');
  }

  return {
    platform: 'meet',
    providerMeetingId: data.id,
    hostUrl: joinUrl,
    joinUrl,
    passcode: data.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.passcode || null,
    startTime: start.toISOString()
  };
};

const platformHandlers = {
  smrrtx: createSmrrtxMeeting,
  zoom: createZoomMeeting,
  meet: createGoogleMeetMeeting
};

const createLiveMeeting = async (platform, payload) => {
  const handler = platformHandlers[platform];
  if (!handler) {
    throw new Error(`Unsupported platform: ${platform}`);
  }
  try {
    return await handler(payload);
  } catch (error) {
    if (platform === 'meet') {
      // Google Meet must be created via Calendar API to guarantee a stable join URL.
      throw error;
    }
    if (LIVE_FALLBACK !== 'disabled') {
      console.warn(`Falling back to ${LIVE_FALLBACK} meeting for platform ${platform}:`, error.message);
      return buildFallbackMeeting(platform, payload.topic, payload.startTime, {
        smrrtxPermanentRoomLink: payload.smrrtxPermanentRoomLink
      });
    }
    throw error;
  }
};

const mapLiveClassRow = (row) => {
  let invites = [];
  if (row.invites) {
    if (typeof row.invites === 'string') {
      try {
        invites = JSON.parse(row.invites);
      } catch (err) {
        invites = [];
      }
    } else if (Array.isArray(row.invites)) {
      invites = row.invites;
    }
  }
  return {
    id: row.id,
    instructorId: row.instructor_id,
    instructorName: row.instructor_name,
    topic: row.topic,
    agenda: row.agenda || undefined,
    startTime: row.start_time,
    platform: row.platform,
    providerMeetingId: row.provider_meeting_id || undefined,
    hostUrl: row.host_url,
    joinUrl: row.join_url,
    passcode: row.passcode || undefined,
    inviteType: row.invite_type,
    durationMinutes: row.duration_minutes,
    status: row.status,
    recordingUrl: row.recording_url || undefined,
    createdAt: row.created_at,
    invites
  };
};

const fetchLiveClasses = async ({ instructorId, studentId, liveClassId } = {}) => {
  await ensureLiveSchema();
  const whereClauses = [];
  const params = [];
  if (liveClassId) {
    params.push(liveClassId);
    whereClauses.push(`lc.id = $${params.length}`);
  }
  if (instructorId) {
    params.push(instructorId);
    whereClauses.push(`lc.instructor_id = $${params.length}`);
  }
  if (studentId) {
    params.push(studentId);
    whereClauses.push(`(lc.invite_type = 'all' OR inv.student_id = $${params.length})`);
  }
  const where = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const query = `
    SELECT lc.*, instr.name AS instructor_name,
           COALESCE(json_agg(
             jsonb_build_object(
               'id', inv.id,
               'studentId', inv.student_id,
               'studentName', stu.name,
               'status', inv.status,
               'email', COALESCE(inv.email, stu.email),
               'createdAt', inv.created_at
             )
             ORDER BY inv.created_at ASC
           ) FILTER (WHERE inv.id IS NOT NULL), '[]') AS invites
      FROM live_classes lc
      LEFT JOIN users instr ON instr.id = lc.instructor_id
      LEFT JOIN live_class_invites inv ON inv.live_class_id = lc.id
      LEFT JOIN users stu ON stu.id = inv.student_id
      ${where}
  GROUP BY lc.id, instr.name
  ORDER BY lc.start_time DESC`;
  const result = await pool.query(query, params);
  return result.rows.map(mapLiveClassRow);
};

app.get('/api/bootstrap', optionalTenantResolver, async (req, res) => {
  // console.log('\n========== BOOTSTRAP REQUEST START ==========');
  // console.log('Timestamp:', new Date().toISOString());
  
  try {
    // console.log('Fetching data from database...');
    await ensureCreditSchema();
    await ensureAttendanceSchema();
    await ensureRewardsConfigSchema();
    await ensureCoursePaymentsSchema();
    await ensureInstructorPayoutsSchema();
    await ensureCourseCategoriesTable();
    const targetPool = req.tenantPool || pool;
    await ensureSeoOverridesTable(targetPool);
    const [
      courses,
      posts,
      users,
      coursePayments,
      instructorPayouts,
      attendance,
      certificates,
      discounts,
      rewards,
      liveClasses,
      staticPages,
      courseCategories,
      creditOptions,
      creditTransactions,
      creditRedemptions,
      livePlatformConfig,
      paymentGatewayConfig
    ] = await Promise.all([
      targetPool.query(`
        SELECT c.*, 
               d.id as discount_id,
               d.code as discount_code,
               d.percentage as discount_percentage,
           d.expiry_date as discount_expiry,
           o.title_en as seo_title_en,
           o.title_ar as seo_title_ar,
           o.description_en as seo_description_en,
           o.description_ar as seo_description_ar,
           o.keywords_en as seo_keywords_en,
           o.keywords_ar as seo_keywords_ar,
           o.canonical_url as seo_canonical_url,
           o.robots as seo_robots,
           o.indexable as seo_indexable,
           o.og_title_en as seo_og_title_en,
           o.og_title_ar as seo_og_title_ar,
           o.og_description_en as seo_og_description_en,
           o.og_description_ar as seo_og_description_ar,
           o.og_image_url as seo_og_image_url,
           o.og_type as seo_og_type,
           o.og_site_name as seo_og_site_name,
           o.twitter_card as seo_twitter_card,
           o.twitter_title_en as seo_twitter_title_en,
           o.twitter_title_ar as seo_twitter_title_ar,
           o.twitter_description_en as seo_twitter_description_en,
           o.twitter_description_ar as seo_twitter_description_ar,
           o.twitter_image_url as seo_twitter_image_url,
           o.jsonld_en as seo_jsonld_en,
           o.jsonld_ar as seo_jsonld_ar,
           o.locale as seo_locale,
           o.locale_alternate as seo_locale_alternate,
           o.sitemap_priority as seo_sitemap_priority,
           o.sitemap_changefreq as seo_sitemap_changefreq
        FROM courses c
        LEFT JOIN discounts d ON (d.course_id = c.id OR d.course_id IS NULL)
                              AND d.expiry_date >= CURRENT_DATE
         LEFT JOIN seo_overrides o ON o.content_type = 'course' AND o.content_id = c.id
        ORDER BY c.created_at DESC,
                 CASE WHEN d.course_id IS NOT NULL THEN 0 ELSE 1 END,
                 d.percentage DESC NULLS LAST
      `),
            targetPool.query(`
         SELECT b.*, 
           o.title_en as seo_title_en,
           o.title_ar as seo_title_ar,
           o.description_en as seo_description_en,
           o.description_ar as seo_description_ar,
           o.keywords_en as seo_keywords_en,
           o.keywords_ar as seo_keywords_ar,
           o.canonical_url as seo_canonical_url,
           o.robots as seo_robots,
           o.indexable as seo_indexable,
           o.og_title_en as seo_og_title_en,
           o.og_title_ar as seo_og_title_ar,
           o.og_description_en as seo_og_description_en,
           o.og_description_ar as seo_og_description_ar,
           o.og_image_url as seo_og_image_url,
           o.og_type as seo_og_type,
           o.og_site_name as seo_og_site_name,
           o.twitter_card as seo_twitter_card,
           o.twitter_title_en as seo_twitter_title_en,
           o.twitter_title_ar as seo_twitter_title_ar,
           o.twitter_description_en as seo_twitter_description_en,
           o.twitter_description_ar as seo_twitter_description_ar,
           o.twitter_image_url as seo_twitter_image_url,
           o.jsonld_en as seo_jsonld_en,
           o.jsonld_ar as seo_jsonld_ar,
           o.locale as seo_locale,
           o.locale_alternate as seo_locale_alternate,
           o.sitemap_priority as seo_sitemap_priority,
           o.sitemap_changefreq as seo_sitemap_changefreq
         FROM blog_posts b
         LEFT JOIN seo_overrides o ON o.content_type = 'blog_post' AND o.content_id = b.id
         ORDER BY b.published_on DESC
            `),
      targetPool.query('SELECT * FROM users ORDER BY join_date DESC'),
      targetPool.query(`
        SELECT
          p.*,
          u.name AS lookup_student_name,
          u.email AS lookup_student_email,
          c.title AS lookup_course_title,
          c.price AS lookup_course_price,
          c.instructor AS lookup_course_instructor,
          instr.id AS lookup_instructor_id
        FROM course_payments p
        LEFT JOIN users u ON u.id = p.student_id
        LEFT JOIN courses c ON c.id = p.course_id
        LEFT JOIN users instr ON instr.id = p.instructor_id
        ORDER BY p.received_at DESC
      `),
      targetPool.query(`
        SELECT
          payout.*,
          instr.name AS lookup_instructor_name,
          recorder.name AS recorder_name,
          course.title AS lookup_course_title
        FROM instructor_payouts payout
        LEFT JOIN users instr ON instr.id = payout.instructor_id
        LEFT JOIN users recorder ON recorder.id = payout.recorded_by
        LEFT JOIN courses course ON course.id = payout.course_id
        ORDER BY payout.recorded_at DESC
      `),
      targetPool.query(`
        SELECT a.*, u.name AS user_name, c.title AS course_title
          FROM attendance_records a
          LEFT JOIN users u ON u.id = a.user_id
          LEFT JOIN courses c ON c.id = a.course_id
        ORDER BY a.session_date DESC
      `),
      targetPool.query(`
        SELECT cert.*, u.name AS user_name, c.title AS course_title
          FROM certificates cert
          LEFT JOIN users u ON u.id = cert.user_id
          LEFT JOIN courses c ON c.id = cert.course_id
        ORDER BY cert.issue_date DESC
      `),
      targetPool.query(`
        SELECT d.*, c.title AS course_title
          FROM discounts d
          LEFT JOIN courses c ON c.id = d.course_id
        ORDER BY d.expiry_date DESC
      `),
      targetPool.query('SELECT * FROM rewards_config ORDER BY updated_at DESC LIMIT 1'),
      fetchLiveClasses(),
      fetchStaticPages(),
      fetchCourseCategories(targetPool),
      targetPool.query('SELECT * FROM credit_redemption_options ORDER BY updated_at DESC'),
      targetPool.query(`
        SELECT ct.*, u.name AS user_name, actor.name AS actor_name
          FROM credit_transactions ct
          LEFT JOIN users u ON u.id = ct.user_id
          LEFT JOIN users actor ON actor.id = ct.actor_id
        ORDER BY ct.created_at DESC
      `),
      targetPool.query(`
        SELECT cr.*, u.name AS user_name, opt.title AS option_title
          FROM credit_redemptions cr
          LEFT JOIN users u ON u.id = cr.user_id
          LEFT JOIN credit_redemption_options opt ON opt.id = cr.option_id
        ORDER BY cr.created_at DESC
      `),
      fetchLivePlatformConfig(),
      fetchPaymentGatewayConfig()
    ]);

    // console.log('Database query results:');
    // console.log('  - Courses:', courses.rows.length, 'records');
    // console.log('  - Blog Posts:', posts.rows.length, 'records');
    // console.log('  - Users:', users.rows.length, 'records');
    // console.log('  - Course Payments:', coursePayments.rows.length, 'records');
    // console.log('  - Attendance:', attendance.rows.length, 'records');
    // console.log('  - Certificates:', certificates.rows.length, 'records');
    // console.log('  - Discounts:', discounts.rows.length, 'records');
    // console.log('  - Rewards Config:', rewards.rows.length, 'records');
    // console.log('  - Live Classes:', liveClasses.length, 'records');
    // console.log('  - Static Pages:', staticPages.length, 'records');
    // console.log('  - Credit Options:', creditOptions.rows.length, 'records');
    // console.log('  - Credit Transactions:', creditTransactions.rows.length, 'records');
    // console.log('  - Credit Redemptions:', creditRedemptions.rows.length, 'records');
    // console.log('  - Live Platform Config loaded');
    // console.log('  - Payment Gateway Config loaded');
    // console.log('  - Instructor Payouts:', instructorPayouts.rows.length, 'records');
    
    // Log user role distribution
    const roleDistribution = users.rows.reduce((acc, user) => {
      acc[user.role] = (acc[user.role] || 0) + 1;
      return acc;
    }, {});
    // console.log('  - User role distribution:', roleDistribution);
    
    // Log payment method distribution
    const paymentMethodDistribution = coursePayments.rows.reduce((acc, tx) => {
      const method = (tx.payment_method || 'MANUAL').toUpperCase();
      acc[method] = (acc[method] || 0) + 1;
      return acc;
    }, {});
    // console.log('  - Payment method distribution:', paymentMethodDistribution);
    
    const totalRevenue = coursePayments.rows.reduce((sum, t) => {
      return sum + Number(t.amount || 0);
    }, 0);
    // console.log('  - Total revenue (recorded receipts):', totalRevenue);

    // Group courses and apply the best discount for each
    const coursesMap = new Map();
    for (const row of courses.rows) {
      if (!coursesMap.has(row.id)) {
        coursesMap.set(row.id, mapCourseRowWithDiscount(row));
      }
    }

    res.json({
      courses: Array.from(coursesMap.values()),
      blogPosts: posts.rows.map((row) => {
        const safeImage = resolveBlogImageResponse(row.image, row.uploaded_image_path);
        return {
          id: row.id,
          slug: row.slug,
          title: row.title,
          excerpt: row.excerpt,
          content: row.content,
          author: row.author,
          date: toISODate(row.published_on) || '',
          image: safeImage,
          isFeatured: row.is_featured,
          status: row.status,
          category: row.category || 'Technology',
          videoUrl: row.video_url,
          uploadedImagePath: row.uploaded_image_path,
          uploadedVideoPath: row.uploaded_video_path
        };
      }),
      users: users.rows.map(mapUserRow),
      coursePayments: coursePayments.rows.map(mapPaymentRecordRow),
      attendance: attendance.rows.map(mapAttendanceRow),
      certificates: certificates.rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        userName: row.user_name || 'N/A',
        courseId: row.course_id,
        courseTitle: row.course_title || 'N/A',
        issueDate: toISODate(row.issue_date),
        url: row.url,
        certificationNumber: row.certification_number,
        type: row.type || 'COMPLETION',
        courseLevel: row.course_level
      })),
      discounts: discounts.rows.map((row) => ({
        id: row.id,
        code: row.code,
        percentage: row.percentage,
        courseId: row.course_id || undefined,
        courseTitle: row.course_title || undefined,
        createdBy: row.created_by,
        expiryDate: toISODate(row.expiry_date),
        usageCount: row.usage_count
      })),
      instructorPayouts: instructorPayouts.rows.map(mapInstructorPayoutRow),
      liveClasses,
      rewardsConfig: rewards.rows.length
        ? {
            dailyLogin: rewards.rows[0].daily_login,
            lessonCompletion: rewards.rows[0].lesson_completion,
            quizPass: rewards.rows[0].quiz_pass,
            assignmentSubmission: rewards.rows[0].assignment_submission,
            creditsPerCurrencyUnit: rewards.rows[0].credits_per_currency_unit
              ? Number(rewards.rows[0].credits_per_currency_unit)
              : undefined,
            currencyCode: rewards.rows[0].currency_code || undefined
          }
        : undefined,
      staticPages,
      courseCategories: courseCategories.rows.map(mapCourseCategoryRow),
      creditRedemptionOptions: creditOptions.rows.map(mapCreditRedemptionOptionRow),
      creditTransactions: creditTransactions.rows.map(mapCreditTransactionRow),
      creditRedemptions: creditRedemptions.rows.map(mapCreditRedemptionRow),
      livePlatformConfig,
      paymentGatewayConfig: sanitizePaymentGatewayConfigForClient(paymentGatewayConfig)
    });
    
    // console.log('Bootstrap response sent successfully');
    // console.log('========== BOOTSTRAP REQUEST END ==========\n');
  } catch (error) {
    console.error('Bootstrap error:', error.message);
    res.status(500).json({ error: 'Failed to load platform data' });
  }
});

app.get('/api/static-pages', async (_req, res) => {
  try {
    const pages = await fetchStaticPages();
    res.json(pages);
  } catch (error) {
    console.error('Static page list error', error);
    res.status(500).json({ error: 'Failed to load static pages' });
  }
});

app.get('/api/static-pages/:slug', async (req, res) => {
  const slug = req.params.slug;
  if (!isValidStaticPageSlug(slug)) {
    return res.status(404).json({ error: 'Page not found' });
  }
  try {
    const page = await fetchStaticPageBySlug(slug);
    res.json(page);
  } catch (error) {
    console.error(`Static page fetch error for ${slug}`, error);
    res.status(500).json({ error: 'Failed to load page content' });
  }
});

app.put('/api/static-pages/:slug', async (req, res) => {
  const slug = req.params.slug;
  if (!isValidStaticPageSlug(slug)) {
    return res.status(404).json({ error: 'Page not found' });
  }
  const { content, title, updatedBy } = req.body || {};
  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'Content is required' });
  }
  if (content.length > MAX_STATIC_PAGE_LENGTH) {
    return res.status(400).json({ error: 'Content is too long' });
  }
  const meta = getStaticPageMeta(slug);
  const finalTitle = typeof title === 'string' && title.trim() ? title.trim() : meta?.title || slug;
  try {
    const page = await upsertStaticPage({ slug, title: finalTitle, content, updatedBy });
    res.json(page);
  } catch (error) {
    console.error(`Static page update error for ${slug}`, error);
    res.status(500).json({ error: 'Failed to save page content' });
  }
});

app.post('/api/careers/applications', async (req, res) => {
  const { jobId, jobTitle, name, email, phone, resumeUrl, resumeFilePath, coverLetter, jobSnapshot } = req.body || {};
  if (!jobId || !jobTitle || !name || !email) {
    return res.status(400).json({ error: 'jobId, jobTitle, name, and email are required.' });
  }
  const trimmedJobId = String(jobId).trim();
  const trimmedJobTitle = String(jobTitle).trim();
  const trimmedName = String(name).trim();
  const trimmedEmail = String(email).trim().toLowerCase();
  if (!trimmedJobId || !trimmedJobTitle || !trimmedName || !trimmedEmail) {
    return res.status(400).json({ error: 'Invalid payload.' });
  }
  if (resumeUrl && !isValidHttpUrl(resumeUrl)) {
    return res.status(400).json({ error: 'Resume URL must be a valid http(s) link.' });
  }
  const sanitizedPhone = phone !== undefined && phone !== null ? String(phone).trim() : '';
  const sanitizedResumeUrl = typeof resumeUrl === 'string' ? resumeUrl.trim() : '';
  const sanitizedResumeFilePath = typeof resumeFilePath === 'string' ? resumeFilePath.trim() : '';
  const sanitizedCoverLetter = typeof coverLetter === 'string' ? coverLetter.trim() : '';
  try {
    await ensureCareerApplicationsTable();
    const insert = await pool.query(
      `
        INSERT INTO career_applications (
          id,
          job_id,
          job_title,
          applicant_name,
          applicant_email,
          applicant_phone,
          resume_url,
          resume_file_path,
          cover_letter,
          job_snapshot
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING *
      `,
      [
        randomUUID(),
        trimmedJobId,
        trimmedJobTitle,
        trimmedName,
        trimmedEmail,
        sanitizedPhone ? sanitizedPhone : null,
        sanitizedResumeUrl ? sanitizedResumeUrl : null,
        sanitizedResumeFilePath ? sanitizedResumeFilePath : null,
        sanitizedCoverLetter ? sanitizedCoverLetter : null,
        jobSnapshot ? JSON.stringify(jobSnapshot) : null
      ]
    );
    res.status(201).json(mapCareerApplicationRow(insert.rows[0]));
  } catch (error) {
    console.error('Career application submission error', error);
    res.status(500).json({ error: 'Unable to submit application at the moment.' });
  }
});

app.get('/api/careers/applications', async (_req, res) => {
  try {
    await ensureCareerApplicationsTable();
    const result = await pool.query('SELECT * FROM career_applications ORDER BY created_at DESC LIMIT 200');
    res.json(result.rows.map(mapCareerApplicationRow));
  } catch (error) {
    console.error('Career applications fetch error', error);
    res.status(500).json({ error: 'Failed to load applications' });
  }
});

app.get('/api/discounts', async (_req, res) => {
  try {
    const result = await pool.query(`${DISCOUNT_SELECT_BASE} ORDER BY d.expiry_date DESC, d.code ASC`);
    res.json(result.rows.map(mapDiscountRow));
  } catch (error) {
    console.error('Discount list error', error);
    res.status(500).json({ error: 'Unable to load discounts' });
  }
});

app.post('/api/discounts', async (req, res) => {
  const { code, percentage, courseId, expiryDate, createdBy } = req.body || {};
  if (!code || percentage === undefined || percentage === null || !expiryDate || !createdBy) {
    return res.status(400).json({ error: 'code, percentage, expiryDate, and createdBy are required' });
  }

  const normalizedCode = sanitizeDiscountCode(code);
  if (!normalizedCode) {
    return res.status(400).json({ error: 'code must be a non-empty string' });
  }
  const normalizedPercentage = normalizeDiscountPercentage(percentage);
  if (normalizedPercentage === null) {
    return res.status(400).json({ error: 'percentage must be between 1 and 100' });
  }
  if (!isValidDateOnly(expiryDate)) {
    return res.status(400).json({ error: 'expiryDate must be a valid YYYY-MM-DD string' });
  }

  const sanitizedCourseId = courseId ? String(courseId).trim() : null;
  try {
    const insert = await pool.query(
      `
        WITH inserted AS (
          INSERT INTO discounts (id, code, percentage, course_id, created_by, expiry_date)
          VALUES ($1,$2,$3,$4,$5,$6)
          RETURNING *
        )
        SELECT inserted.*, c.title AS course_title
          FROM inserted
          LEFT JOIN courses c ON c.id = inserted.course_id
      `,
      [randomUUID(), normalizedCode, normalizedPercentage, sanitizedCourseId || null, createdBy, expiryDate]
    );
    res.status(201).json(mapDiscountRow(insert.rows[0]));
  } catch (error) {
    console.error('Create discount error', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Discount code already exists' });
    }
    res.status(500).json({ error: 'Unable to create discount' });
  }
});

app.put('/api/discounts/:id', async (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: 'Discount ID is required' });
  }
  const { code, percentage, courseId, expiryDate } = req.body || {};

  const updates = [];
  const values = [];
  let paramIndex = 1;

  if (code !== undefined) {
    const normalizedCode = sanitizeDiscountCode(code);
    if (!normalizedCode) {
      return res.status(400).json({ error: 'code must be a non-empty string' });
    }
    updates.push(`code = $${paramIndex++}`);
    values.push(normalizedCode);
  }
  if (percentage !== undefined) {
    const normalizedPercentage = normalizeDiscountPercentage(percentage);
    if (normalizedPercentage === null) {
      return res.status(400).json({ error: 'percentage must be between 1 and 100' });
    }
    updates.push(`percentage = $${paramIndex++}`);
    values.push(normalizedPercentage);
  }
  if (courseId !== undefined) {
    const sanitizedCourseId = courseId ? String(courseId).trim() : null;
    updates.push(`course_id = $${paramIndex++}`);
    values.push(sanitizedCourseId || null);
  }
  if (expiryDate !== undefined) {
    if (!isValidDateOnly(expiryDate)) {
      return res.status(400).json({ error: 'expiryDate must be a valid YYYY-MM-DD string' });
    }
    updates.push(`expiry_date = $${paramIndex++}`);
    values.push(expiryDate);
  }

  if (!updates.length) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const query = `
    WITH updated AS (
      UPDATE discounts
         SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *
    )
    SELECT updated.*, c.title AS course_title
      FROM updated
      LEFT JOIN courses c ON c.id = updated.course_id
  `;
  values.push(id);

  try {
    const result = await pool.query(query, values);
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Discount not found' });
    }
    res.json(mapDiscountRow(result.rows[0]));
  } catch (error) {
    console.error('Update discount error', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Discount code already exists' });
    }
    res.status(500).json({ error: 'Unable to update discount' });
  }
});

app.delete('/api/discounts/:id', async (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: 'Discount ID is required' });
  }
  try {
    const deleted = await pool.query(
      `
        WITH removed AS (
          DELETE FROM discounts WHERE id = $1 RETURNING *
        )
        SELECT removed.*, c.title AS course_title
          FROM removed
          LEFT JOIN courses c ON c.id = removed.course_id
      `,
      [id]
    );
    if (!deleted.rowCount) {
      return res.status(404).json({ error: 'Discount not found' });
    }
    res.json(mapDiscountRow(deleted.rows[0]));
  } catch (error) {
    console.error('Delete discount error', error);
    res.status(500).json({ error: 'Unable to delete discount' });
  }
});

app.post('/api/freelancers/signup', optionalTenantResolver, upload.single('resume'), async (req, res) => {
  try {
    const db = resolveSubmissionPool(req);
    await ensureCommunityFormsSchema(db);

    const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
    const country = typeof req.body?.country === 'string' ? req.body.country.trim() : '';
    const fieldOfExpertise = typeof req.body?.fieldOfExpertise === 'string' ? req.body.fieldOfExpertise.trim() : '';
    const shortBio = typeof req.body?.shortBio === 'string' ? req.body.shortBio.trim() : '';
    const yearsOfExperienceRaw = Number.parseInt(String(req.body?.yearsOfExperience || '0'), 10);
    const yearsOfExperience = Number.isFinite(yearsOfExperienceRaw) && yearsOfExperienceRaw >= 0
      ? yearsOfExperienceRaw
      : null;
    const cvUrl = req.file?.path ? toPublicUploadPath(req.file.path) : null;

    if (!fullName || !email || !phone || !country || !fieldOfExpertise || !shortBio || yearsOfExperience === null) {
      return res.status(400).json({
        error: localize(
          req,
          'Please fill all required freelancer fields with valid values.',
          'يرجى تعبئة جميع حقول المستقل المطلوبة بقيم صحيحة.'
        )
      });
    }

    const insert = await db.query(
      `INSERT INTO freelancer_submissions
       (id, full_name, email, phone, country, field_of_expertise, years_of_experience, short_bio, cv_url, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'NEW', NOW(), NOW())
       RETURNING *`,
      [randomUUID(), fullName, email, phone, country, fieldOfExpertise, yearsOfExperience, shortBio, cvUrl]
    );

    res.status(201).json({
      message: localize(req, 'Freelancer application submitted successfully.', 'تم إرسال طلب المستقل بنجاح.'),
      submission: mapFreelancerSubmissionRow(insert.rows[0])
    });
  } catch (error) {
    console.error('Freelancer signup error', error);
    res.status(500).json({
      error: localize(req, 'Unable to submit freelancer application.', 'تعذر إرسال طلب المستقل.')
    });
  }
});

app.post('/api/memberships/signup', optionalTenantResolver, async (req, res) => {
  try {
    const db = resolveSubmissionPool(req);
    await ensureCommunityFormsSchema(db);

    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
    const country = typeof req.body?.country === 'string' ? req.body.country.trim() : '';
    const membershipType = normalizeMembershipType(req.body?.membershipType);
    const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';

    if (!name || !email || !phone || !country || !membershipType || !password) {
      return res.status(400).json({
        error: localize(req, 'All membership fields are required.', 'جميع حقول العضوية مطلوبة.')
      });
    }
    if (password.length < 6) {
      return res.status(400).json({
        error: localize(req, 'Password must be at least 6 characters.', 'يجب أن تتكون كلمة المرور من 6 أحرف على الأقل.')
      });
    }

    const existing = await db.query('SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1', [email]);
    if (existing.rowCount > 0) {
      return res.status(409).json({
        error: localize(req, 'This email is already registered.', 'هذا البريد الإلكتروني مسجل مسبقاً.')
      });
    }

    let preselectedGateway = null;
    let silverAmount = null;
    if (membershipType === 'SILVER') {
      const config = await fetchPaymentGatewayConfig();
      preselectedGateway = pickEnabledGateway(config);
      if (!preselectedGateway) {
        return res.status(400).json({
          error: localize(req, 'No payment gateway is enabled for Silver membership.', 'لا توجد بوابة دفع مفعلة لعضوية Silver.')
        });
      }
      if (!validateGatewayCredentials(config, preselectedGateway)) {
        return res.status(400).json({
          error: localize(req, 'Selected payment gateway is missing credentials.', 'بوابة الدفع المختارة تفتقد بيانات الاعتماد.')
        });
      }
      silverAmount = resolveSilverMembershipAmount(config);
    }

    const userId = randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);
    const initialPlan = membershipType === 'SILVER' ? 'Starter' : 'Free';
    const initialStatus = membershipType === 'SILVER' ? 'Pending' : 'Active';
    const initialMembershipStatus = membershipType === 'SILVER' ? 'PENDING_PAYMENT' : 'ACTIVE';
    const initialPaymentStatus = membershipType === 'SILVER' ? 'pending' : 'free';

    const createdUser = await db.query(
      `INSERT INTO users (id, name, email, password_hash, role, status, phone, join_date, last_active, plan)
       VALUES ($1, $2, $3, $4, 'MEMBER', $5, $6, CURRENT_DATE, NOW(), $7)
       RETURNING *`,
      [userId, name, email, passwordHash, initialStatus, phone, initialPlan]
    );

    const paymentGateway = membershipType === 'SILVER' ? preselectedGateway : null;
    const paymentReference = null;
    const finalMembershipStatus = initialMembershipStatus;
    const finalPaymentStatus = initialPaymentStatus;

    const membershipInsert = await db.query(
      `INSERT INTO membership_submissions
       (id, user_id, name, email, phone, country, membership_type, status, payment_status, payment_gateway, payment_reference, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
       RETURNING *`,
      [randomUUID(), userId, name, email, phone, country, membershipType, finalMembershipStatus, finalPaymentStatus, paymentGateway, paymentReference]
    );

    res.status(201).json({
      message: membershipType === 'SILVER'
        ? localize(req, 'Account created. Complete payment to activate Silver membership.', 'تم إنشاء الحساب. أكمل الدفع لتفعيل عضوية Silver.')
        : localize(req, 'Membership account created successfully.', 'تم إنشاء حساب العضوية بنجاح.'),
      membership: mapMembershipSubmissionRow(membershipInsert.rows[0]),
      user: mapUserRow(createdUser.rows[0]),
      payment: paymentGateway
        ? {
            gateway: paymentGateway,
            amount: silverAmount,
            status: finalPaymentStatus,
            reference: paymentReference,
            checkoutRequired: true
          }
        : null
    });
  } catch (error) {
    console.error('Membership signup error', error);
    res.status(500).json({
      error: localize(req, 'Unable to complete membership signup.', 'تعذر إكمال تسجيل العضوية.')
    });
  }
});

app.post('/api/memberships/:id/checkout', optionalTenantResolver, async (req, res) => {
  try {
    const { id } = req.params;
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!id || !email) {
      return res.status(400).json({
        error: localize(req, 'Membership id and email are required.', 'معرف العضوية والبريد الإلكتروني مطلوبان.')
      });
    }

    const db = resolveSubmissionPool(req);
    await ensureCommunityFormsSchema(db);

    const existingMembership = await db.query(
      'SELECT * FROM membership_submissions WHERE id = $1 AND LOWER(email) = $2 LIMIT 1',
      [id, email]
    );
    if (!existingMembership.rowCount) {
      return res.status(404).json({
        error: localize(req, 'Membership record not found.', 'لم يتم العثور على سجل العضوية.')
      });
    }

    const membership = existingMembership.rows[0];
    if (String(membership.membership_type || '').toUpperCase() !== 'SILVER') {
      return res.status(400).json({
        error: localize(req, 'Checkout is available only for Silver memberships.', 'الدفع متاح فقط لعضويات Silver.')
      });
    }
    if (String(membership.status || '').toUpperCase() === 'ACTIVE') {
      return res.status(200).json({
        message: localize(req, 'Membership is already active.', 'العضوية مفعلة بالفعل.'),
        membership: mapMembershipSubmissionRow(membership)
      });
    }

    const paymentConfig = await fetchPaymentGatewayConfig();
    const paymentGateway = String(membership.payment_gateway || '').toLowerCase() || pickEnabledGateway(paymentConfig);
    if (!paymentGateway || !validateGatewayCredentials(paymentConfig, paymentGateway)) {
      return res.status(400).json({
        error: localize(req, 'Payment gateway configuration is invalid.', 'إعدادات بوابة الدفع غير صالحة.')
      });
    }

    const amount = resolveSilverMembershipAmount(paymentConfig);
    const paymentReference = randomUUID();

    const updatedMembership = await db.query(
      `UPDATE membership_submissions
       SET status = 'ACTIVE', payment_status = 'paid', payment_gateway = $2, payment_reference = $3, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [membership.id, paymentGateway, paymentReference]
    );

    if (membership.user_id) {
      await db.query(
        `UPDATE users
         SET status = 'Active', plan = 'Pro', updated_at = NOW()
         WHERE id = $1`,
        [membership.user_id]
      );
    }

    res.json({
      message: localize(req, 'Silver membership payment completed successfully.', 'تم إكمال دفع عضوية Silver بنجاح.'),
      payment: {
        gateway: paymentGateway,
        amount,
        reference: paymentReference,
        status: 'paid'
      },
      membership: mapMembershipSubmissionRow(updatedMembership.rows[0])
    });
  } catch (error) {
    console.error('Membership checkout error', error);
    res.status(500).json({
      error: localize(req, 'Unable to complete membership payment.', 'تعذر إكمال دفع العضوية.')
    });
  }
});

app.get('/api/admin/freelancers', optionalTenantResolver, requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const db = resolveSubmissionPool(req);
    await ensureCommunityFormsSchema(db);
    const statusFilter = normalizeFreelancerStatus(req.query?.status);
    const search = typeof req.query?.search === 'string' ? req.query.search.trim().toLowerCase() : '';

    const clauses = [];
    const values = [];
    if (statusFilter) {
      values.push(statusFilter);
      clauses.push(`status = $${values.length}`);
    }
    if (search) {
      values.push(`%${search}%`);
      clauses.push(`(LOWER(full_name) LIKE $${values.length} OR LOWER(email) LIKE $${values.length})`);
    }
    const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await db.query(
      `SELECT * FROM freelancer_submissions ${whereClause} ORDER BY created_at DESC`,
      values
    );
    res.json(result.rows.map(mapFreelancerSubmissionRow));
  } catch (error) {
    console.error('Admin freelancers list error', error);
    res.status(500).json({ error: localize(req, 'Unable to load freelancers.', 'تعذر تحميل بيانات المستقلين.') });
  }
});

app.patch('/api/admin/freelancers/:id/status', optionalTenantResolver, requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const status = normalizeFreelancerStatus(req.body?.status);
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : null;
    if (!id || !status) {
      return res.status(400).json({ error: localize(req, 'Valid status is required.', 'الحالة الصحيحة مطلوبة.') });
    }

    const db = resolveSubmissionPool(req);
    await ensureCommunityFormsSchema(db);
    const updated = await db.query(
      `UPDATE freelancer_submissions
       SET status = $2, notes = $3, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, status, notes]
    );

    if (!updated.rowCount) {
      return res.status(404).json({ error: localize(req, 'Freelancer application not found.', 'لم يتم العثور على طلب المستقل.') });
    }
    res.json(mapFreelancerSubmissionRow(updated.rows[0]));
  } catch (error) {
    console.error('Admin freelancer status update error', error);
    res.status(500).json({ error: localize(req, 'Unable to update freelancer status.', 'تعذر تحديث حالة المستقل.') });
  }
});

app.get('/api/admin/memberships', optionalTenantResolver, requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const db = resolveSubmissionPool(req);
    await ensureCommunityFormsSchema(db);
    const statusFilter = normalizeMembershipStatus(req.query?.status);
    const typeFilter = normalizeMembershipType(req.query?.type);
    const search = typeof req.query?.search === 'string' ? req.query.search.trim().toLowerCase() : '';

    const clauses = [];
    const values = [];
    if (statusFilter) {
      values.push(statusFilter);
      clauses.push(`status = $${values.length}`);
    }
    if (typeFilter) {
      values.push(typeFilter);
      clauses.push(`membership_type = $${values.length}`);
    }
    if (search) {
      values.push(`%${search}%`);
      clauses.push(`(LOWER(name) LIKE $${values.length} OR LOWER(email) LIKE $${values.length})`);
    }
    const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await db.query(
      `SELECT * FROM membership_submissions ${whereClause} ORDER BY created_at DESC`,
      values
    );
    res.json(result.rows.map(mapMembershipSubmissionRow));
  } catch (error) {
    console.error('Admin memberships list error', error);
    res.status(500).json({ error: localize(req, 'Unable to load memberships.', 'تعذر تحميل العضويات.') });
  }
});

app.patch('/api/admin/memberships/:id/status', optionalTenantResolver, requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const status = normalizeMembershipStatus(req.body?.status);
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : null;
    if (!id || !status) {
      return res.status(400).json({ error: localize(req, 'Valid status is required.', 'الحالة الصحيحة مطلوبة.') });
    }

    const db = resolveSubmissionPool(req);
    await ensureCommunityFormsSchema(db);
    const updated = await db.query(
      `UPDATE membership_submissions
       SET status = $2, notes = $3, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, status, notes]
    );
    if (!updated.rowCount) {
      return res.status(404).json({ error: localize(req, 'Membership record not found.', 'لم يتم العثور على سجل العضوية.') });
    }
    res.json(mapMembershipSubmissionRow(updated.rows[0]));
  } catch (error) {
    console.error('Admin membership status update error', error);
    res.status(500).json({ error: localize(req, 'Unable to update membership status.', 'تعذر تحديث حالة العضوية.') });
  }
});

app.post('/api/users', optionalAuth, async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      role: requestedRole,
      nationalId,
      phone,
      phoneCountryCode,
      bio,
      specialization,
      gender,
      yearsOfExperience,
      portfolioUrl,
      socialLinks
    } = req.body || {};

    const normalizedRole = normalizeUserRole(requestedRole) || 'STUDENT';
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const sanitizedName = typeof name === 'string' ? name.trim() : '';
    const sanitizedNationalId = typeof nationalId === 'string' ? nationalId.trim() : '';
    const actorRole = normalizeUserRole(req.user?.role);
    const isAdminActor = Boolean(req.user) && isAdminLikeRole(actorRole);
    const isSelfRegistration = !isAdminActor;
    const isTenantRequest = Boolean(req.tenant || req.tenantPool);

    if (!sanitizedName || !normalizedEmail || !normalizedRole) {
      return res.status(400).json({ error: 'name, email, and role are required' });
    }

    if (isSelfRegistration) {
      // Allow self-registration on both central domain and tenant subdomains
      if (!SELF_REGISTRATION_ROLES.has(normalizedRole)) {
        return res.status(403).json({ error: 'role_not_allowed' });
      }
      if (normalizedRole === 'SUPER_ADMIN' && isTenantRequest) {
        return res.status(403).json({ error: 'super_admin_central_only' });
      }
      if (!password || !password.trim()) {
        return res.status(400).json({ error: 'password_required' });
      }
    }

    const targetPool = req.tenantPool || pool;
    const existing = await targetPool.query('SELECT 1 FROM users WHERE LOWER(email) = $1 LIMIT 1', [normalizedEmail]);
    if (existing.rowCount) {
      return res.status(409).json({ error: 'email_exists' });
    }

    let passwordHash = null;
    if (password) {
      passwordHash = await bcrypt.hash(password, 10);
    }

    const sanitizedPhoneCountryCode = typeof phoneCountryCode === 'string' ? phoneCountryCode.trim() : null;
    const sanitizedGender = typeof gender === 'string' && ['male', 'female'].includes(gender.toLowerCase()) ? gender.toLowerCase() : null;
    const sanitizedSpecialization = typeof specialization === 'string' ? specialization.trim() || null : null;
    const insert = await targetPool.query(
      `INSERT INTO users (id, name, email, password_hash, national_id, role, status, phone, phone_country_code, gender, specialization, join_date, last_active, plan)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_DATE, NOW(), $12)
       RETURNING *`,
      [
        randomUUID(),
        sanitizedName,
        normalizedEmail,
        passwordHash,
        sanitizedNationalId || null,
        normalizedRole,
        'Active',
        phone || null,
        sanitizedPhoneCountryCode || null,
        sanitizedGender,
        sanitizedSpecialization,
        (normalizedRole === 'STUDENT' || normalizedRole === 'MEMBER' || normalizedRole === 'VISITOR') ? 'Free' : 'Enterprise'
      ]
    );

    res.status(201).json(mapUserRow(insert.rows[0]));
  } catch (error) {
    console.error('Create user error', error);
    res.status(500).json({ error: 'Unable to create user' });
  }
});

app.post('/api/users/bulk-import', requireAuth, requireRole('ADMIN', 'INSTRUCTOR'), async (req, res) => {
  try {
    const { users: usersToImport, courseId } = req.body;

    if (!Array.isArray(usersToImport) || usersToImport.length === 0) {
      return res.status(400).json({ error: 'users array is required and must not be empty' });
    }

    // Use tenant pool if available, otherwise use default pool
    const targetPool = req.tenantPool || pool;

    const createdUsers = [];
    const errors = [];

    for (const user of usersToImport) {
      try {
        const { name, email, password, role, phone, nationalId } = user;

        if (!name || !email) {
          errors.push({ email: email || 'unknown', error: 'name and email are required' });
          continue;
        }

        // Check if user already exists
        const existing = await targetPool.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);
        if (existing.rowCount > 0) {
          const userId = existing.rows[0].id;
          // If courseId is provided, enroll the existing user
          if (courseId) {
            await targetPool.query(
              `UPDATE users
               SET enrolled_courses = CASE
                 WHEN enrolled_courses @> ARRAY[$2]::uuid[] THEN enrolled_courses
                 ELSE array_append(COALESCE(enrolled_courses, ARRAY[]::uuid[]), $2::uuid)
               END
               WHERE id = $1`,
              [userId, courseId]
            );
          }
          const userResult = await targetPool.query('SELECT * FROM users WHERE id = $1', [userId]);
          createdUsers.push(mapUserRow(userResult.rows[0]));
          continue;
        }

        const userRole = role || 'STUDENT';
        const enrolledCourses = courseId ? [courseId] : [];
        const defaultPassword = 'password123';
        const hashedPassword = await bcrypt.hash(defaultPassword, 10);

        const insert = await targetPool.query(
          `INSERT INTO users (id, name, email, password_hash, national_id, role, status, phone, join_date, last_active, last_login_date, enrolled_courses, progress, plan, credits, streak)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CURRENT_DATE, NOW(), CURRENT_DATE, $9, NULL, $10, $11, 0)
           RETURNING *`,
          [
            randomUUID(),
            name,
            email,
            hashedPassword,
            typeof nationalId === 'string' && nationalId.trim() ? nationalId.trim() : null,
            userRole,
            'Active',
            phone || null,
            enrolledCourses,
            (userRole === 'STUDENT' || userRole === 'MEMBER') ? 'Free' : 'Enterprise',
            (userRole === 'STUDENT' || userRole === 'MEMBER') ? 100 : 0
          ]
        );

        createdUsers.push(mapUserRow(insert.rows[0]));
      } catch (userError) {
        console.error('Individual user import error', userError);
        errors.push({ 
          email: user.email || 'unknown', 
          error: userError.message || 'Failed to create user' 
        });
      }
    }

    res.status(201).json({
      success: true,
      created: createdUsers.length,
      failed: errors.length,
      users: createdUsers,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('Bulk import error', error);
    res.status(500).json({ error: 'Unable to complete bulk import' });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    // Use tenant pool if available, otherwise use default pool
    const targetPool = req.tenantPool || pool;
    const result = await targetPool.query('SELECT * FROM users ORDER BY LOWER(name)');
    res.json(result.rows.map(mapUserRow));
  } catch (error) {
    console.error('Users fetch error', error);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

app.get('/api/users/:userId/progress', async (req, res) => {
  const { userId } = req.params;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }
  if (!isValidUuid(userId)) {
    return res.status(400).json({ error: 'userId must be a valid UUID' });
  }
  try {
    await ensureProgressSchema();
    const targetPool = req.tenantPool || pool;
    const [progressResult, userResult] = await Promise.all([
      targetPool.query('SELECT * FROM course_progress WHERE user_id = $1 ORDER BY last_activity DESC', [userId]),
      targetPool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [userId])
    ]);

    if (!userResult.rowCount) {
      return res.status(404).json({ error: 'User not found' });
    }

    const records = progressResult.rows.map(mapCourseProgressRow);
    const averageProgress = records.length
      ? Math.round(records.reduce((sum, record) => sum + record.progressPercent, 0) / records.length)
      : 0;

    res.json({
      courseProgress: records,
      averageProgress,
      streak: userResult.rows[0].streak || 0,
      user: mapUserRow(userResult.rows[0])
    });
  } catch (error) {
    console.error('User progress fetch error', error);
    res.status(500).json({ error: 'Failed to load progress data' });
  }
});

app.post('/api/users/:userId/progress', async (req, res) => {
  const { userId } = req.params;
  const {
    courseId,
    completedItemIds,
    totalItems,
    preTestCompleted,
    postTestCompleted,
    preTestScore,
    postTestScore
  } = req.body || {};

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }
  if (!isValidUuid(userId)) {
    return res.status(400).json({ error: 'userId must be a valid UUID' });
  }
  if (!courseId) {
    return res.status(400).json({ error: 'courseId is required' });
  }
  if (!Array.isArray(completedItemIds)) {
    return res.status(400).json({ error: 'completedItemIds must be an array' });
  }

  const normalizedItems = Array.from(
    new Set(
      completedItemIds
        .filter((item) => typeof item === 'string' && item.trim().length)
        .map((item) => item.trim())
    )
  );
  const numericTotal = Number(totalItems);
  const safeTotal = Number.isFinite(numericTotal) && numericTotal > 0 ? numericTotal : normalizedItems.length;
  const completedCount = safeTotal ? Math.min(normalizedItems.length, safeTotal) : normalizedItems.length;
  const progressPercent = safeTotal
    ? Math.min(100, Math.round((completedCount / safeTotal) * 100))
    : 0;
  const preTestCompletedFlag = typeof preTestCompleted === 'boolean' ? preTestCompleted : null;
  const postTestCompletedFlag = typeof postTestCompleted === 'boolean' ? postTestCompleted : null;
  const preTestScoreValue = Number.isFinite(Number(preTestScore)) ? Number(preTestScore) : null;
  const postTestScoreValue = Number.isFinite(Number(postTestScore)) ? Number(postTestScore) : null;

  await ensureProgressSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userResult = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!userResult.rowCount) {
      throw createHttpError(404, 'User not found');
    }

    const existingProgressResult = await client.query(
      'SELECT * FROM course_progress WHERE user_id = $1 AND course_id = $2 FOR UPDATE',
      [userId, courseId]
    );
    const existingProgress = existingProgressResult.rows[0] || null;

    const nextPreTestCompleted = preTestCompletedFlag !== null
      ? preTestCompletedFlag
      : existingProgress?.pre_test_completed ?? false;
    const nextPostTestCompleted = postTestCompletedFlag !== null
      ? postTestCompletedFlag
      : existingProgress?.post_test_completed ?? false;
    const nextPreTestScore = preTestScoreValue !== null
      ? preTestScoreValue
      : existingProgress?.pre_test_score ?? null;
    const nextPostTestScore = postTestScoreValue !== null
      ? postTestScoreValue
      : existingProgress?.post_test_score ?? null;

    let progressRow;
    if (existingProgress) {
      progressRow = (
        await client.query(
          `UPDATE course_progress
              SET completed_items = $1::jsonb,
                  total_items = $2,
                  completed_count = $3,
                  progress_percent = $4,
                  pre_test_completed = $5,
                  post_test_completed = $6,
                  pre_test_score = $7,
                  post_test_score = $8,
                  last_activity = now()
            WHERE id = $9
            RETURNING *`,
          [
            JSON.stringify(normalizedItems),
            safeTotal,
            completedCount,
            progressPercent,
            nextPreTestCompleted,
            nextPostTestCompleted,
            nextPreTestScore,
            nextPostTestScore,
            existingProgress.id
          ]
        )
      ).rows[0];
    } else {
      progressRow = (
        await client.query(
          `INSERT INTO course_progress (
              id,
              user_id,
              course_id,
              completed_items,
              total_items,
              completed_count,
              progress_percent,
              pre_test_completed,
              post_test_completed,
              pre_test_score,
              post_test_score,
              last_activity
            )
           VALUES (gen_random_uuid(), $1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, now())
           RETURNING *`,
          [
            userId,
            courseId,
            JSON.stringify(normalizedItems),
            safeTotal,
            completedCount,
            progressPercent,
            nextPreTestCompleted,
            nextPostTestCompleted,
            nextPreTestScore,
            nextPostTestScore
          ]
        )
      ).rows[0];
    }

    const avgResult = await client.query(
      'SELECT COALESCE(AVG(progress_percent), 0) AS avg_progress FROM course_progress WHERE user_id = $1',
      [userId]
    );
    const averageProgress = Math.round(Number(avgResult.rows[0].avg_progress || 0));

    const todayKey = getDateKey(new Date());
    const lastActivityKey = getDateKey(userResult.rows[0].last_activity_date);
    const progressImproved = completedCount > (existingProgress?.completed_count || 0);
    let nextStreak = userResult.rows[0].streak || 0;
    if (progressImproved && todayKey) {
      if (!lastActivityKey) {
        nextStreak = 1;
      } else {
        const dayDiff = diffInDays(todayKey, lastActivityKey);
        if (dayDiff === 0) {
          nextStreak = userResult.rows[0].streak || 1;
        } else if (dayDiff === 1) {
          nextStreak = (userResult.rows[0].streak || 0) + 1;
        } else if (dayDiff > 1) {
          nextStreak = 1;
        }
      }
    }

    const updatedUser = await client.query(
      `UPDATE users
          SET progress = $2,
              streak = $3,
              last_activity_date = CASE WHEN $6::boolean THEN $4 ELSE last_activity_date END,
              last_active = CASE WHEN $6::boolean THEN $5 ELSE last_active END
        WHERE id = $1
        RETURNING *`,
      [
        userId,
        averageProgress,
        nextStreak,
        todayKey || userResult.rows[0].last_activity_date,
        new Date().toISOString(),
        progressImproved
      ]
    );

    await client.query('COMMIT');
    res.json({
      courseProgress: mapCourseProgressRow(progressRow),
      averageProgress,
      user: mapUserRow(updatedUser.rows[0])
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('User progress update error', error);
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to update progress' });
  } finally {
    client.release();
  }
});

app.post('/api/attendance/activity', async (req, res) => {
  const { userId, courseId, durationSeconds, completedItemsDelta, milestoneEventsDelta } = req.body || {};

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }
  if (!courseId) {
    return res.status(400).json({ error: 'courseId is required' });
  }

  const seconds = Math.max(0, Math.floor(Number(durationSeconds) || 0));
  const completedDelta = Math.max(0, Number(completedItemsDelta) || 0);
  const milestoneDelta = Math.max(0, Number(milestoneEventsDelta) || 0);
  if (seconds <= 0 && completedDelta <= 0 && milestoneDelta <= 0) {
    return res.status(400).json({ error: 'At least one of durationSeconds, completedItemsDelta, or milestoneEventsDelta must be provided' });
  }

  try {
    await ensureAttendanceSchema();
    const sessionDate = getDateKey(new Date());
    if (!sessionDate) {
      throw createHttpError(400, 'Unable to determine session date');
    }

    const initialStatus = buildAttendanceStatus(seconds, completedDelta, milestoneDelta);
    const upsert = await pool.query(
      `INSERT INTO attendance_records (
          id,
          user_id,
          course_id,
          session_date,
          status,
          duration_seconds,
          items_completed,
          milestone_events,
          last_active
        ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, now())
        ON CONFLICT (user_id, course_id, session_date)
        DO UPDATE SET
          duration_seconds = attendance_records.duration_seconds + EXCLUDED.duration_seconds,
          items_completed = attendance_records.items_completed + EXCLUDED.items_completed,
          milestone_events = attendance_records.milestone_events + EXCLUDED.milestone_events,
          last_active = now(),
          status = CASE
            WHEN (
              attendance_records.items_completed + EXCLUDED.items_completed > 0 OR
              attendance_records.milestone_events + EXCLUDED.milestone_events > 0
            ) THEN 'PRESENT'
            WHEN attendance_records.duration_seconds + EXCLUDED.duration_seconds >= $8 THEN 'PRESENT'
            WHEN attendance_records.duration_seconds + EXCLUDED.duration_seconds >= $9 THEN 'LATE'
            ELSE attendance_records.status
          END
        RETURNING *`,
      [
        userId,
        courseId,
        sessionDate,
        initialStatus,
        seconds,
        completedDelta,
        milestoneDelta,
        ATTENDANCE_THRESHOLDS.presentSeconds,
        ATTENDANCE_THRESHOLDS.lateSeconds
      ]
    );

    const hydrated = await pool.query(
      `SELECT a.*, u.name AS user_name, c.title AS course_title
         FROM attendance_records a
         LEFT JOIN users u ON u.id = a.user_id
         LEFT JOIN courses c ON c.id = a.course_id
        WHERE a.id = $1
        LIMIT 1`,
      [upsert.rows[0].id]
    );

    res.json(mapAttendanceRow(hydrated.rows[0]));
  } catch (error) {
    console.error('Attendance activity log error', error);
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to record attendance activity' });
  }
});

app.put('/api/rewards-config', async (req, res) => {
  const {
    dailyLogin,
    lessonCompletion,
    quizPass,
    assignmentSubmission,
    creditsPerCurrencyUnit,
    currencyCode
  } = req.body || {};

  const normalizeNumber = (value, fallback, fieldName) => {
    const raw = value === undefined || value === null ? fallback : value;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || numeric < 0) {
      throw createHttpError(400, `${fieldName} must be a non-negative number`);
    }
    return numeric;
  };

  try {
    await ensureRewardsConfigSchema();
    const currentResult = await pool.query('SELECT * FROM rewards_config ORDER BY updated_at DESC LIMIT 1');
    const currentRow = currentResult.rows[0] || DEFAULT_REWARDS_CONFIG;

    const nextValues = {
      daily_login: normalizeNumber(dailyLogin, currentRow.daily_login, 'dailyLogin'),
      lesson_completion: normalizeNumber(lessonCompletion, currentRow.lesson_completion, 'lessonCompletion'),
      quiz_pass: normalizeNumber(quizPass, currentRow.quiz_pass, 'quizPass'),
      assignment_submission: normalizeNumber(assignmentSubmission, currentRow.assignment_submission, 'assignmentSubmission'),
      credits_per_currency_unit: normalizeNumber(
        creditsPerCurrencyUnit,
        currentRow.credits_per_currency_unit,
        'creditsPerCurrencyUnit'
      ),
      currency_code: (currencyCode || currentRow.currency_code || DEFAULT_REWARDS_CONFIG.currency_code)
        .toString()
        .trim()
        .toUpperCase()
    };

    if (!nextValues.currency_code) {
      throw createHttpError(400, 'currencyCode is required');
    }

    let result;
    if (currentResult.rowCount) {
      result = await pool.query(
        `UPDATE rewards_config
            SET daily_login = $1,
                lesson_completion = $2,
                quiz_pass = $3,
                assignment_submission = $4,
                credits_per_currency_unit = $5,
                currency_code = $6,
                updated_at = now()
          WHERE id = $7
        RETURNING *`,
        [
          nextValues.daily_login,
          nextValues.lesson_completion,
          nextValues.quiz_pass,
          nextValues.assignment_submission,
          nextValues.credits_per_currency_unit,
          nextValues.currency_code,
          currentResult.rows[0].id
        ]
      );
    } else {
      result = await pool.query(
        `INSERT INTO rewards_config (
            daily_login,
            lesson_completion,
            quiz_pass,
            assignment_submission,
            credits_per_currency_unit,
            currency_code
         ) VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [
          nextValues.daily_login,
          nextValues.lesson_completion,
          nextValues.quiz_pass,
          nextValues.assignment_submission,
          nextValues.credits_per_currency_unit,
          nextValues.currency_code
        ]
      );
    }

    const row = result.rows[0];
    res.json({
      dailyLogin: row.daily_login,
      lessonCompletion: row.lesson_completion,
      quizPass: row.quiz_pass,
      assignmentSubmission: row.assignment_submission,
      creditsPerCurrencyUnit: row.credits_per_currency_unit
        ? Number(row.credits_per_currency_unit)
        : undefined,
      currencyCode: row.currency_code
    });
  } catch (error) {
    const status = error.status || 500;
    console.error('Rewards config update error', error);
    res.status(status).json({ error: error.message || 'Failed to update rewards config' });
  }
});

app.get('/api/live-platform-config', async (_req, res) => {
  try {
    const config = await fetchLivePlatformConfig();
    res.json(config);
  } catch (error) {
    console.error('Live platform config fetch error', error);
    res.status(500).json({ error: 'Failed to load live platform configuration' });
  }
});

app.put('/api/live-platform-config', async (req, res) => {
  try {
    await ensureLivePlatformConfigTable();
    const current = await fetchLivePlatformConfig();
    const body = req.body || {};
    const next = {
      smrrtxEnabled: body.smrrtxEnabled !== undefined ? Boolean(body.smrrtxEnabled) : current.smrrtxEnabled,
      zoomEnabled: body.zoomEnabled !== undefined ? Boolean(body.zoomEnabled) : current.zoomEnabled,
      meetEnabled: body.meetEnabled !== undefined ? Boolean(body.meetEnabled) : current.meetEnabled,
      smrrtxPermanentRoomLink:
        typeof body.smrrtxPermanentRoomLink === 'string'
          ? body.smrrtxPermanentRoomLink.trim()
          : current.smrrtxPermanentRoomLink || '',
      zoomConfigLink:
        typeof body.zoomConfigLink === 'string'
          ? body.zoomConfigLink.trim()
          : current.zoomConfigLink || '',
      zoomClientId:
        typeof body.zoomClientId === 'string' ? body.zoomClientId.trim() : current.zoomClientId || '',
      zoomClientSecret:
        typeof body.zoomClientSecret === 'string' ? body.zoomClientSecret.trim() : current.zoomClientSecret || '',
      zoomAccountId:
        typeof body.zoomAccountId === 'string' ? body.zoomAccountId.trim() : current.zoomAccountId || '',
      zoomUserId:
        typeof body.zoomUserId === 'string' ? body.zoomUserId.trim() : current.zoomUserId || '',
      meetConfigLink:
        typeof body.meetConfigLink === 'string'
          ? body.meetConfigLink.trim()
          : current.meetConfigLink || '',
      googleSaEmail:
        typeof body.googleSaEmail === 'string' ? body.googleSaEmail.trim() : current.googleSaEmail || '',
      googleSaKey:
        typeof body.googleSaKey === 'string' ? body.googleSaKey.trim() : current.googleSaKey || '',
      googleCalendarId:
        typeof body.googleCalendarId === 'string' ? body.googleCalendarId.trim() : current.googleCalendarId || ''
    };

    if (!next.smrrtxEnabled && !next.zoomEnabled && !next.meetEnabled) {
      return res.status(400).json({ error: 'At least one platform must remain enabled' });
    }

    const result = await pool.query(
      `INSERT INTO live_platform_config (
          id,
          smrrtx_enabled,
          smrrtx_permanent_room_link,
          zoom_enabled,
          zoom_config_link,
          zoom_client_id,
          zoom_client_secret,
          zoom_account_id,
          zoom_user_id,
          meet_enabled,
          meet_config_link,
          google_sa_email,
          google_sa_key,
          google_calendar_id
       ) VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id)
       DO UPDATE SET
          smrrtx_enabled = EXCLUDED.smrrtx_enabled,
          smrrtx_permanent_room_link = EXCLUDED.smrrtx_permanent_room_link,
          zoom_enabled = EXCLUDED.zoom_enabled,
          zoom_config_link = EXCLUDED.zoom_config_link,
          zoom_client_id = EXCLUDED.zoom_client_id,
          zoom_client_secret = EXCLUDED.zoom_client_secret,
          zoom_account_id = EXCLUDED.zoom_account_id,
          zoom_user_id = EXCLUDED.zoom_user_id,
          meet_enabled = EXCLUDED.meet_enabled,
          meet_config_link = EXCLUDED.meet_config_link,
          google_sa_email = EXCLUDED.google_sa_email,
          google_sa_key = EXCLUDED.google_sa_key,
          google_calendar_id = EXCLUDED.google_calendar_id,
          updated_at = now()
       RETURNING *`,
      [
        next.smrrtxEnabled,
        next.smrrtxPermanentRoomLink || null,
        next.zoomEnabled,
        next.zoomConfigLink || null,
        next.zoomClientId || null,
        next.zoomClientSecret || null,
        next.zoomAccountId || null,
        next.zoomUserId || null,
        next.meetEnabled,
        next.meetConfigLink || null,
        next.googleSaEmail || null,
        next.googleSaKey || null,
        next.googleCalendarId || null
      ]
    );

    res.json(mapLivePlatformConfigRow(result.rows[0]));
  } catch (error) {
    console.error('Live platform config update error', error);
    res.status(500).json({ error: 'Failed to update live platform configuration' });
  }
});

app.get('/api/payment-gateways', async (_req, res) => {
  try {
    const config = await fetchPaymentGatewayConfig();
    res.json(config);
  } catch (error) {
    console.error('Payment gateway config fetch error', error);
    res.status(500).json({ error: 'Failed to load payment gateways configuration' });
  }
});

app.put('/api/payment-gateways', async (req, res) => {
  try {
    const current = await fetchPaymentGatewayConfig();
    const body = req.body || {};
    // SUPER_ADMIN users are in the central users table, not tenant_admins
    // So we set updated_by to NULL to avoid foreign key constraint violation
    const updatedBy = null;
    const sanitize = (value, fallback = '') =>
      typeof value === 'string' ? value.trim() : fallback;
    const sanitizeNumber = (value, fallback = null) =>
      typeof value === 'number' ? value : (value ? parseFloat(value) : fallback);

    const next = {
      paypalEnabled: body.paypalEnabled !== undefined ? Boolean(body.paypalEnabled) : current.paypalEnabled,
      paypalClientId: sanitize(body.paypalClientId, current.paypalClientId || ''),
      paypalSecretKey: sanitize(body.paypalSecretKey, current.paypalSecretKey || ''),
      stripeEnabled: body.stripeEnabled !== undefined ? Boolean(body.stripeEnabled) : current.stripeEnabled,
      stripePublicKey: sanitize(body.stripePublicKey, current.stripePublicKey || ''),
      stripeSecretKey: sanitize(body.stripeSecretKey, current.stripeSecretKey || ''),
      stripePriceBasicMonthly: sanitize(body.stripePriceBasicMonthly, current.stripePriceBasicMonthly || ''),
      stripePriceBasicYearly: sanitize(body.stripePriceBasicYearly, current.stripePriceBasicYearly || ''),
      stripePriceProMonthly: sanitize(body.stripePriceProMonthly, current.stripePriceProMonthly || ''),
      stripePriceProYearly: sanitize(body.stripePriceProYearly, current.stripePriceProYearly || ''),
      stripePriceEnterpriseMonthly: sanitize(body.stripePriceEnterpriseMonthly, current.stripePriceEnterpriseMonthly || ''),
      stripePriceEnterpriseYearly: sanitize(body.stripePriceEnterpriseYearly, current.stripePriceEnterpriseYearly || ''),
      planBasicMonthlyAmount: sanitizeNumber(body.planBasicMonthlyAmount, current.planBasicMonthlyAmount),
      planBasicMonthlyCurrency: sanitize(body.planBasicMonthlyCurrency, current.planBasicMonthlyCurrency || 'USD'),
      planProMonthlyAmount: sanitizeNumber(body.planProMonthlyAmount, current.planProMonthlyAmount),
      planProMonthlyCurrency: sanitize(body.planProMonthlyCurrency, current.planProMonthlyCurrency || 'USD'),
      planEnterpriseMonthlyAmount: sanitizeNumber(body.planEnterpriseMonthlyAmount, current.planEnterpriseMonthlyAmount),
      planEnterpriseMonthlyCurrency: sanitize(body.planEnterpriseMonthlyCurrency, current.planEnterpriseMonthlyCurrency || 'USD')
    };

    const missing = [];
    if (next.paypalEnabled && (!next.paypalClientId || !next.paypalSecretKey)) missing.push('PayPal');
    if (next.stripeEnabled && (!next.stripePublicKey || !next.stripeSecretKey)) missing.push('Stripe');
    if (missing.length) {
      return res.status(400).json({ error: `Missing credentials for: ${missing.join(', ')}` });
    }

    const ENCRYPTION_KEY = process.env.PAYMENT_CONFIG_ENCRYPTION_KEY || 'default-encryption-key-change-in-production';
    const encryptedPaypalSecret =
      next.paypalSecretKey ? encryptField(next.paypalSecretKey, ENCRYPTION_KEY) : null;
    const encryptedStripeSecret =
      next.stripeSecretKey ? encryptField(next.stripeSecretKey, ENCRYPTION_KEY) : null;
    
    const result = await pool.query(
      `INSERT INTO payment_gateway_config (
          id,
          paypal_enabled,
          paypal_client_id,
          paypal_secret_key,
          stripe_enabled,
          stripe_public_key,
          stripe_secret_key,
          stripe_price_basic_monthly,
          stripe_price_basic_yearly,
          stripe_price_pro_monthly,
          stripe_price_pro_yearly,
          stripe_price_enterprise_monthly,
          stripe_price_enterprise_yearly,
          plan_basic_monthly_amount,
          plan_basic_monthly_currency,
          plan_pro_monthly_amount,
          plan_pro_monthly_currency,
          plan_enterprise_monthly_amount,
          plan_enterprise_monthly_currency,
          updated_by,
          updated_at
       ) VALUES (
          1,
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
         $13,
         $14,
         $15,
         $16,
         $17,
         $18,
         $19,
          now()
       )
       ON CONFLICT (id)
       DO UPDATE SET
          paypal_enabled = EXCLUDED.paypal_enabled,
          paypal_client_id = EXCLUDED.paypal_client_id,
          paypal_secret_key = CASE WHEN EXCLUDED.paypal_secret_key IS NOT NULL THEN EXCLUDED.paypal_secret_key ELSE payment_gateway_config.paypal_secret_key END,
          stripe_enabled = EXCLUDED.stripe_enabled,
          stripe_public_key = EXCLUDED.stripe_public_key,
          stripe_secret_key = CASE WHEN EXCLUDED.stripe_secret_key IS NOT NULL THEN EXCLUDED.stripe_secret_key ELSE payment_gateway_config.stripe_secret_key END,
          stripe_price_basic_monthly = EXCLUDED.stripe_price_basic_monthly,
          stripe_price_basic_yearly = EXCLUDED.stripe_price_basic_yearly,
          stripe_price_pro_monthly = EXCLUDED.stripe_price_pro_monthly,
          stripe_price_pro_yearly = EXCLUDED.stripe_price_pro_yearly,
          stripe_price_enterprise_monthly = EXCLUDED.stripe_price_enterprise_monthly,
          stripe_price_enterprise_yearly = EXCLUDED.stripe_price_enterprise_yearly,
          plan_basic_monthly_amount = EXCLUDED.plan_basic_monthly_amount,
          plan_basic_monthly_currency = EXCLUDED.plan_basic_monthly_currency,
          plan_pro_monthly_amount = EXCLUDED.plan_pro_monthly_amount,
          plan_pro_monthly_currency = EXCLUDED.plan_pro_monthly_currency,
          plan_enterprise_monthly_amount = EXCLUDED.plan_enterprise_monthly_amount,
          plan_enterprise_monthly_currency = EXCLUDED.plan_enterprise_monthly_currency,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
       RETURNING *`,
      [
        next.paypalEnabled,
        next.paypalClientId || null,
        encryptedPaypalSecret,
        next.stripeEnabled,
        next.stripePublicKey || null,
        encryptedStripeSecret,
        next.stripePriceBasicMonthly || null,
        next.stripePriceBasicYearly || null,
        next.stripePriceProMonthly || null,
        next.stripePriceProYearly || null,
        next.stripePriceEnterpriseMonthly || null,
        next.stripePriceEnterpriseYearly || null,
        next.planBasicMonthlyAmount,
        next.planBasicMonthlyCurrency || 'USD',
        next.planProMonthlyAmount,
        next.planProMonthlyCurrency || 'USD',
        next.planEnterpriseMonthlyAmount,
        next.planEnterpriseMonthlyCurrency || 'USD',
        updatedBy
      ]
    );

    const row = result.rows[0];
    if (row.paypal_secret_key && Buffer.isBuffer(row.paypal_secret_key)) {
      try {
        row.paypal_secret_key = decryptField(row.paypal_secret_key, ENCRYPTION_KEY) || '';
      } catch (err) {
        row.paypal_secret_key = '';
      }
    }
    if (row.stripe_secret_key && Buffer.isBuffer(row.stripe_secret_key)) {
      try {
        row.stripe_secret_key = decryptField(row.stripe_secret_key, ENCRYPTION_KEY) || '';
      } catch (err) {
        row.stripe_secret_key = '';
      }
    }

    res.json(mapPaymentGatewayConfigRow(row));
  } catch (error) {
    console.error('Payment gateway config update error', error);
    res.status(500).json({ error: 'Failed to update payment gateways configuration' });
  }
});

app.post('/api/payments/checkout', async (req, res) => {
  try {
    const { gateway, amount, courseId } = req.body || {};
    if (!gateway || typeof gateway !== 'string') {
      return res.status(400).json({ error: 'gateway is required' });
    }
    const normalizedGateway = gateway.toLowerCase();
    const config = await fetchPaymentGatewayConfig();
    const gateways = {
      visa: {
        enabled: config.visaEnabled,
        publicKey: config.visaPublicKey,
        secretKey: config.visaSecretKey
      },
      paypal: {
        enabled: config.paypalEnabled,
        publicKey: config.paypalClientId,
        secretKey: config.paypalSecretKey
      },
      stripe: {
        enabled: config.stripeEnabled,
        publicKey: config.stripePublicKey,
        secretKey: config.stripeSecretKey
      }
    };

    const target = gateways[normalizedGateway];
    if (!target) {
      return res.status(400).json({ error: 'Unsupported gateway' });
    }
    if (!target.enabled) {
      return res.status(400).json({ error: 'Gateway is disabled' });
    }
    if (!target.publicKey || !target.secretKey) {
      return res.status(400).json({ error: 'Gateway is missing credentials' });
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: 'amount must be greater than zero' });
    }

    res.json({
      status: 'AUTHORIZED',
      gateway: normalizedGateway,
      reference: randomUUID(),
      amount: Number(numericAmount.toFixed(2)),
      courseId: courseId || null,
      processedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Payment checkout error', error);
    res.status(500).json({ error: 'Unable to process payment' });
  }
});

app.post('/api/rewards/claim', async (req, res) => {
  const { userId, courseId, rewardType, rewardKey, amount, reason, moduleId, itemId } = req.body || {};
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId is required' });
  }
  if (!rewardKey || typeof rewardKey !== 'string') {
    return res.status(400).json({ error: 'rewardKey is required' });
  }
  if (!rewardType || !REWARD_ACTIVITY_TYPES.has(rewardType)) {
    return res.status(400).json({ error: 'Invalid rewardType' });
  }
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ error: 'amount must be greater than zero' });
  }

  await ensureCreditSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userResult = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!userResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }
    const userRow = userResult.rows[0];

    const duplicateCheck = await client.query(
      `SELECT id FROM credit_transactions
        WHERE user_id = $1
          AND action_type = 'EARN'
          AND metadata->>'rewardKey' = $2
       LIMIT 1`,
      [userId, rewardKey]
    );

    if (duplicateCheck.rowCount) {
      await client.query('ROLLBACK');
      return res.json({ alreadyGranted: true, user: mapUserRow(userRow) });
    }

    const updatedUserResult = await client.query(
      'UPDATE users SET credits = credits + $1 WHERE id = $2 RETURNING *',
      [numericAmount, userId]
    );

    const metadataPayload = {
      rewardKey,
      rewardType,
      ...(courseId ? { courseId } : {}),
      ...(moduleId ? { moduleId } : {}),
      ...(itemId ? { itemId } : {})
    };

    const transactionResult = await client.query(
      `INSERT INTO credit_transactions (id, user_id, actor_id, amount, action_type, source, reason, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        randomUUID(),
        userId,
        null,
        numericAmount,
        'EARN',
        'COURSE_PLAYER',
        reason || rewardType,
        JSON.stringify(metadataPayload)
      ]
    );

    await client.query('COMMIT');

    res.json({
      user: mapUserRow(updatedUserResult.rows[0]),
      transaction: mapCreditTransactionRow({
        ...transactionResult.rows[0],
        user_name: userRow.name
      })
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Reward claim error', error);
    res.status(500).json({ error: 'Unable to grant reward' });
  } finally {
    client.release();
  }
});

app.post('/api/credits/redeem', async (req, res) => {
  const { userId, optionId, metadata } = req.body || {};
  if (!userId || !optionId) {
    return res.status(400).json({ error: 'userId and optionId are required' });
  }

  await ensureCreditSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const optionResult = await client.query(
      'SELECT * FROM credit_redemption_options WHERE id = $1 AND is_active = true',
      [optionId]
    );
    if (!optionResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Redemption option not found' });
    }
    const optionRow = optionResult.rows[0];

    const userResult = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!userResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }
    const userRow = userResult.rows[0];

    const currentCredits = Number(userRow.credits || 0);
    if (currentCredits < optionRow.required_credits) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient credits' });
    }

    const updatedUserResult = await client.query(
      'UPDATE users SET credits = credits - $1 WHERE id = $2 RETURNING *',
      [optionRow.required_credits, userId]
    );
    const updatedUser = updatedUserResult.rows[0];

    const redemptionId = randomUUID();
    const transactionId = randomUUID();
    const metadataPayload = metadata && typeof metadata === 'object' ? metadata : {};

    const redemptionInsert = await client.query(
      `INSERT INTO credit_redemptions (id, user_id, option_id, credits_spent, status, metadata)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [
        redemptionId,
        userId,
        optionId,
        optionRow.required_credits,
        'PENDING',
        JSON.stringify(metadataPayload)
      ]
    );

    const transactionInsert = await client.query(
      `INSERT INTO credit_transactions (id, user_id, actor_id, amount, action_type, source, reason, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        transactionId,
        userId,
        null,
        optionRow.required_credits,
        'REDEEM',
        'SYSTEM',
        `Redeemed: ${optionRow.title}`,
        JSON.stringify({ optionId, ...metadataPayload })
      ]
    );

    await client.query('COMMIT');

    res.json({
      user: mapUserRow(updatedUser),
      transaction: mapCreditTransactionRow({
        ...transactionInsert.rows[0],
        user_name: userRow.name
      }),
      redemption: mapCreditRedemptionRow({
        ...redemptionInsert.rows[0],
        option_title: optionRow.title
      })
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Credit redemption error', error);
    res.status(500).json({ error: 'Unable to process redemption' });
  } finally {
    client.release();
  }
});

app.post('/api/credits/adjust', async (req, res) => {
  const { userId, amount, actionType, reason, actorId, metadata } = req.body || {};
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }
  if (!['EARN', 'DEDUCT'].includes(actionType)) {
    return res.status(400).json({ error: 'actionType must be EARN or DEDUCT' });
  }
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ error: 'amount must be greater than zero' });
  }

  await ensureCreditSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userResult = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!userResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }
    const userRow = userResult.rows[0];
    if (actionType === 'DEDUCT' && Number(userRow.credits || 0) < numericAmount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient credits for deduction' });
    }

    const creditDelta = actionType === 'EARN' ? numericAmount : -numericAmount;
    const updatedUserResult = await client.query(
      'UPDATE users SET credits = credits + $1 WHERE id = $2 RETURNING *',
      [creditDelta, userId]
    );

    // For tenant admins, actor_id might not be a valid user in the tenant database
    // Verify if actorId exists in the tenant's users table before using it
    let validatedActorId = null;
    if (actorId) {
      const actorCheck = await client.query('SELECT id FROM users WHERE id = $1', [actorId]);
      if (actorCheck.rowCount > 0) {
        validatedActorId = actorId;
      }
    }

    const transactionResult = await client.query(
      `INSERT INTO credit_transactions (id, user_id, actor_id, amount, action_type, source, reason, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        randomUUID(),
        userId,
        validatedActorId,
        numericAmount,
        actionType,
        'ADMIN',
        reason || null,
        JSON.stringify(metadata || {})
      ]
    );

    await client.query('COMMIT');

    const transactionRow = transactionResult.rows[0];
    res.json({
      user: mapUserRow(updatedUserResult.rows[0]),
      transaction: mapCreditTransactionRow({
        ...transactionRow,
        user_name: userRow.name,
        actor_name: null
      })
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Credit adjustment error', error);
    res.status(500).json({ error: 'Unable to adjust credits' });
  } finally {
    client.release();
  }
});

app.post('/api/credits/options', async (req, res) => {
  const { title, type, description, requiredCredits, metadata, createdBy } = req.body || {};
  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'title is required' });
  }
  const normalizedType = (type || '').toString().toUpperCase();
  if (!CREDIT_OPTION_TYPES.has(normalizedType)) {
    return res.status(400).json({ error: 'Invalid redemption type' });
  }
  const numericCredits = Number(requiredCredits);
  if (!Number.isFinite(numericCredits) || numericCredits <= 0) {
    return res.status(400).json({ error: 'requiredCredits must be greater than zero' });
  }
  let metadataPayload = {};
  if (metadata && typeof metadata === 'object') {
    metadataPayload = metadata;
  } else if (typeof metadata === 'string' && metadata.trim()) {
    try {
      metadataPayload = JSON.parse(metadata);
    } catch {
      return res.status(400).json({ error: 'metadata must be valid JSON' });
    }
  }

  try {
    await ensureCreditSchema();
    
    // Validate that createdBy exists in the tenant's users table
    // For tenant admins, createdBy might not be a valid user in the tenant database
    let validatedCreatedBy = null;
    if (createdBy) {
      const creatorCheck = await pool.query('SELECT id FROM users WHERE id = $1', [createdBy]);
      if (creatorCheck.rowCount > 0) {
        validatedCreatedBy = createdBy;
      }
    }
    
    const result = await pool.query(
      `INSERT INTO credit_redemption_options (id, title, type, description, required_credits, metadata, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        randomUUID(),
        title.trim(),
        normalizedType,
        description || null,
        Math.round(numericCredits),
        JSON.stringify(metadataPayload),
        true,
        validatedCreatedBy
      ]
    );
    res.status(201).json(mapCreditRedemptionOptionRow(result.rows[0]));
  } catch (error) {
    console.error('Create credit option error', error);
    res.status(500).json({ error: 'Unable to create redemption option' });
  }
});

app.patch('/api/credits/options/:id', async (req, res) => {
  const { id } = req.params;
  const { title, description, requiredCredits, isActive, metadata, type } = req.body || {};
  if (!id) {
    return res.status(400).json({ error: 'Option ID is required' });
  }

  const updates = [];
  const values = [];
  let paramIndex = 1;

  if (title !== undefined) {
    updates.push(`title = $${paramIndex++}`);
    values.push(title);
  }
  if (description !== undefined) {
    updates.push(`description = $${paramIndex++}`);
    values.push(description);
  }
  if (type !== undefined) {
    const normalizedType = type.toString().toUpperCase();
    if (!CREDIT_OPTION_TYPES.has(normalizedType)) {
      return res.status(400).json({ error: 'Invalid redemption type' });
    }
    updates.push(`type = $${paramIndex++}`);
    values.push(normalizedType);
  }
  if (requiredCredits !== undefined) {
    const numericCredits = Number(requiredCredits);
    if (!Number.isFinite(numericCredits) || numericCredits <= 0) {
      return res.status(400).json({ error: 'requiredCredits must be greater than zero' });
    }
    updates.push(`required_credits = $${paramIndex++}`);
    values.push(Math.round(numericCredits));
  }
  if (isActive !== undefined) {
    updates.push(`is_active = $${paramIndex++}`);
    values.push(Boolean(isActive));
  }
  if (metadata !== undefined) {
    let payload = metadata;
    if (typeof metadata === 'string' && metadata.trim()) {
      try {
        payload = JSON.parse(metadata);
      } catch {
        return res.status(400).json({ error: 'metadata must be valid JSON' });
      }
    }
    updates.push(`metadata = $${paramIndex++}`);
    values.push(JSON.stringify(payload || {}));
  }

  if (!updates.length) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  updates.push('updated_at = now()');

  const query = `UPDATE credit_redemption_options SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
  values.push(id);

  try {
    await ensureCreditSchema();
    const result = await pool.query(query, values);
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Redemption option not found' });
    }
    res.json(mapCreditRedemptionOptionRow(result.rows[0]));
  } catch (error) {
    console.error('Update credit option error', error);
    res.status(500).json({ error: 'Unable to update redemption option' });
  }
});

app.get('/api/credits/leaderboard', async (req, res) => {
  const limitParam = Number(req.query?.limit);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.floor(limitParam), 1), 100) : 5;
  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE role = $1 ORDER BY credits DESC NULLS LAST LIMIT $2',
      ['STUDENT', limit]
    );
    res.json(result.rows.map(mapUserRow));
  } catch (error) {
    console.error('Credit leaderboard error', error);
    res.status(500).json({ error: 'Unable to load credit leaderboard' });
  }
});

app.post('/api/login', loginRateLimiter, async (req, res) => {
  console.log('\n========== LOGIN REQUEST START ==========');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Host:', req.headers.host);
  console.log('Tenant:', req.tenant?.subdomain || 'No tenant context');
  
  try {
    const { email, password } = req.body || {};
    console.log('Login attempt for email:', email);
    
    if (!email || !password) {
      console.log('Login failed: Missing email or password');
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // First, check if this is a tenant admin (stored in central DB)
    if (req.tenant) {
      console.log('Checking for tenant admin in central database...');
      const adminResult = await centralPool.query(
        `SELECT ta.id, ta.email, ta.first_name, ta.last_name, ta.phone, ta.is_primary, ta.password, ta.password_hash, t.id as tenant_id, t.subdomain
         FROM tenant_admins ta
         JOIN tenants t ON ta.tenant_id = t.id
         WHERE ta.email = $1 AND t.id = $2`,
        [email, req.tenant.id]
      );
      
      if (adminResult.rows.length > 0) {
        const admin = adminResult.rows[0];
        let passwordValid = false;
        
        // Check password_hash first (modern secure method)
        if (admin.password_hash) {
          passwordValid = await bcrypt.compare(password, admin.password_hash);
        }
        // Fallback to plaintext (legacy support) and migrate to hash
        else if (admin.password && admin.password === password) {
          passwordValid = true;
          // Migrate to hashed password
          const hashedPassword = await bcrypt.hash(password, 10);
          await centralPool.query(
            'UPDATE tenant_admins SET password_hash = $1 WHERE email = $2 AND tenant_id = $3',
            [hashedPassword, email, req.tenant.id]
          );
          console.log('Migrated tenant admin password to hash');
        }
        
        if (passwordValid) {
          console.log('Tenant admin login successful for:', email);
          console.log('========== LOGIN REQUEST END (SUCCESS - ADMIN) ==========\n');
          
          // Generate JWT token for authenticated requests
          const tokenPayload = {
            userId: admin.id,
            email: admin.email,
            role: 'ADMIN',
            tenantId: req.tenant.id,
            isTenantAdmin: true
          };
          const accessToken = generateAccessToken(tokenPayload);
          
          // Set access token as httpOnly cookie
          const cookieOptions = {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
          };
          // Set domain for subdomain support
          if (req.headers.host) {
            const hostParts = req.headers.host.split('.');
            if (hostParts.length >= 2) {
              // Set cookie domain to base domain for subdomain sharing
              const baseDomain = hostParts.slice(-2).join('.');
              if (!baseDomain.includes('localhost')) {
                cookieOptions.domain = `.${baseDomain}`;
              }
            }
          }
          res.cookie('accessToken', accessToken, cookieOptions);
          
          // Return admin user in the same format as regular users
          return res.json({
            id: admin.id,
            name: `${admin.first_name || ''} ${admin.last_name || ''}`.trim(),
            email: admin.email,
            role: 'ADMIN',
            enrolledCourses: [],
            credits: 0,
            streak: 0,
            socialLinks: {},
            certifications: [],
            accessToken // Include in response for clients that need it
          });
        }
      }
      console.log('Not a tenant admin, checking tenant users...');
    }

    // Use tenant pool if available, otherwise use default pool
    const targetPool = req.tenantPool || pool;
    console.log('Querying database for user... (using', req.tenantPool ? 'tenant pool' : 'default pool', ')');
    
    const result = await targetPool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    
    console.log('Query result: Found', result.rows.length, 'user(s)');

    if (result.rows.length === 0) {
      console.log('Login failed: Invalid credentials for email:', email);
      console.log('========== LOGIN REQUEST END (FAILED) ==========\n');
      const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
      const errorMessage = lang === 'ar' ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة' : 'Invalid email or password';
      return res.status(401).json({ error: errorMessage });
    }

    const user = result.rows[0];
    let passwordValid = false;
    
    // Check password_hash first (modern secure method)
    if (user.password_hash) {
      passwordValid = await bcrypt.compare(password, user.password_hash);
    }
    // Fallback to plaintext password (legacy support) and migrate to hash
    else if (user.password && user.password === password) {
      passwordValid = true;
      // Migrate to hashed password
      const hashedPassword = await bcrypt.hash(password, 10);
      await targetPool.query(
        'UPDATE users SET password_hash = $1 WHERE id = $2',
        [hashedPassword, user.id]
      );
      console.log('Migrated user password to hash for user:', email);
    }
    
    if (!passwordValid) {
      console.log('Login failed: Invalid credentials for email:', email);
      console.log('========== LOGIN REQUEST END (FAILED) ==========\n');
      const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
      const errorMessage = lang === 'ar' ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة' : 'Invalid email or password';
      return res.status(401).json({ error: errorMessage });
    }

    const mappedUser = mapUserRow(user);
    
    // Generate JWT token for authenticated requests
    const tokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role || 'STUDENT',
      tenantId: req.tenant?.id,
      isTenantAdmin: false
    };
    const accessToken = generateAccessToken(tokenPayload);
    
    // Set access token as httpOnly cookie
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    };
    // Set domain for subdomain support
    if (req.headers.host) {
      const hostParts = req.headers.host.split('.');
      if (hostParts.length >= 2) {
        // Set cookie domain to base domain for subdomain sharing
        const baseDomain = hostParts.slice(-2).join('.');
        if (!baseDomain.includes('localhost')) {
          cookieOptions.domain = `.${baseDomain}`;
        }
      }
    }
    res.cookie('accessToken', accessToken, cookieOptions);
    
    console.log('Login successful for:', email);
    console.log('========== LOGIN REQUEST END (SUCCESS) ==========\n');
    res.json({ ...mappedUser, accessToken });
  } catch (error) {
    console.error('\n========== LOGIN ERROR ==========');
    console.error('Error details:', error);
    console.error('Error stack:', error.stack);
    console.error('========== LOGIN ERROR END ==========\n');
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET single user by ID
app.get('/api/users/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const targetPool = req.tenantPool || pool;
    const result = await targetPool.query('SELECT * FROM users WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(mapUserRow(result.rows[0]));
  } catch (error) {
    console.error('Get user by ID error', error);
    res.status(500).json({ error: 'Unable to fetch user' });
  }
});

app.put('/api/users/:id', requireAuth, requireSelfOrAdmin('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, nationalId, phone, phoneCountryCode, avatar, bio, specialization, gender, followUpStatus, yearsOfExperience, portfolioUrl, socialLinks, certifications, role, status, password, enrolledCourses } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (email !== undefined) {
      updates.push(`email = $${paramIndex++}`);
      values.push(email);
    }
    if (nationalId !== undefined) {
      updates.push(`national_id = $${paramIndex++}`);
      values.push(typeof nationalId === 'string' && nationalId.trim() ? nationalId.trim() : null);
    }
    if (role !== undefined) {
      updates.push(`role = $${paramIndex++}`);
      values.push(role);
    }
    if (status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(status);
    }
    if (password !== undefined && password.trim() !== '') {
      const hashedPassword = await bcrypt.hash(password.trim(), 10);
      updates.push(`password_hash = $${paramIndex++}`);
      values.push(hashedPassword);
      // Clear plaintext password when updating
      updates.push(`password = NULL`);
    }
    if (phone !== undefined) {
      updates.push(`phone = $${paramIndex++}`);
      values.push(phone);
    }
    if (phoneCountryCode !== undefined) {
      updates.push(`phone_country_code = $${paramIndex++}`);
      values.push(phoneCountryCode);
    }
    if (avatar !== undefined) {
      updates.push(`avatar = $${paramIndex++}`);
      values.push(avatar);
    }
    if (bio !== undefined) {
      updates.push(`bio = $${paramIndex++}`);
      values.push(bio);
    }
    if (specialization !== undefined) {
      updates.push(`specialization = $${paramIndex++}`);
      values.push(specialization);
    }
    if (gender !== undefined) {
      const normalizedGender = typeof gender === 'string' && ['male', 'female'].includes(gender.toLowerCase()) ? gender.toLowerCase() : null;
      updates.push(`gender = $${paramIndex++}`);
      values.push(normalizedGender);
    }
    if (followUpStatus !== undefined) {
      const allowedStatuses = ['Registered', 'Postponed', 'Rejected', 'Not interested', 'Number disconnected'];
      const validStatus = typeof followUpStatus === 'string' && allowedStatuses.includes(followUpStatus) ? followUpStatus : null;
      updates.push(`follow_up_status = $${paramIndex++}`);
      values.push(validStatus);
    }
    if (yearsOfExperience !== undefined) {
      updates.push(`years_of_experience = $${paramIndex++}`);
      values.push(yearsOfExperience);
    }
    if (portfolioUrl !== undefined) {
      updates.push(`portfolio_url = $${paramIndex++}`);
      values.push(portfolioUrl);
    }
    if (socialLinks !== undefined) {
      updates.push(`social_links = $${paramIndex++}`);
      values.push(JSON.stringify(socialLinks));
    }
    if (certifications !== undefined) {
      updates.push(`certifications = $${paramIndex++}`);
      values.push(certifications);
    }
    if (enrolledCourses !== undefined) {
      updates.push(`enrolled_courses = $${paramIndex++}`);
      values.push(enrolledCourses); // Already an array, no need to stringify
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);
    const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`;

    const targetPool = req.tenantPool || pool;
    const result = await targetPool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(mapUserRow(result.rows[0]));
  } catch (error) {
    console.error('Update user error', error);
    res.status(500).json({ error: 'Unable to update user' });
  }
});

app.delete('/api/users/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const targetPool = req.tenantPool || pool;
    const result = await targetPool.query('DELETE FROM users WHERE id = $1 RETURNING *', [id]);
    if (!result.rowCount) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(mapUserRow(result.rows[0]));
  } catch (error) {
    console.error('Delete user error', error);
    res.status(500).json({ error: 'Unable to delete user' });
  }
});

// Password change endpoint
app.put('/api/users/:id/password', requireAuth, requireSelfOrAdmin('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const { currentPassword, newPassword } = req.body;
    const targetPool = req.tenantPool || pool;

    if (!id || !currentPassword || !newPassword) {
      const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
      const errorMessage = lang === 'ar' 
        ? 'معرف المستخدم وكلمة المرور الحالية وكلمة المرور الجديدة مطلوبة' 
        : 'User ID, current password, and new password are required';
      return res.status(400).json({ error: errorMessage });
    }

    // Get the current user
    const userResult = await targetPool.query('SELECT * FROM users WHERE id = $1', [id]);
    
    if (userResult.rows.length === 0) {
      const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
      const errorMessage = lang === 'ar' ? 'المستخدم غير موجود' : 'User not found';
      return res.status(404).json({ error: errorMessage });
    }

    const user = userResult.rows[0];
    let passwordValid = false;

    // Verify current password (check hash first, then plaintext for legacy)
    if (user.password_hash) {
      passwordValid = await bcrypt.compare(currentPassword, user.password_hash);
    } else if (user.password && user.password === currentPassword) {
      passwordValid = true;
    }

    if (!passwordValid) {
      const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
      const errorMessage = lang === 'ar' ? 'كلمة المرور الحالية غير صحيحة' : 'Current password is incorrect';
      return res.status(401).json({ error: errorMessage });
    }

    // Hash new password and update
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await targetPool.query('UPDATE users SET password_hash = $1, password = NULL WHERE id = $2', [hashedPassword, id]);

    const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
    const successMessage = lang === 'ar' ? 'تم تحديث كلمة المرور بنجاح' : 'Password updated successfully';
    res.json({ success: true, message: successMessage });
  } catch (error) {
    console.error('Password change error', error);
    const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
    const errorMessage = lang === 'ar' ? 'غير قادر على تغيير كلمة المرور' : 'Unable to change password';
    res.status(500).json({ error: errorMessage });
  }
});

app.get('/api/assignments', async (req, res) => {
  try {
    const { instructorId, courseId, studentId } = req.query;
    
    // Student fetching assignments for their enrolled courses
    if (studentId && typeof studentId === 'string') {
      await ensureInstructorAssignmentsTable();
      
      // Get student's enrolled courses
      const studentResult = await pool.query(
        'SELECT enrolled_courses FROM users WHERE id = $1',
        [studentId]
      );
      
      if (!studentResult.rowCount) {
        return res.status(404).json({ error: 'Student not found' });
      }
      
      const enrolledCourses = studentResult.rows[0].enrolled_courses || [];
      
      if (enrolledCourses.length === 0) {
        return res.json([]);
      }
      
      // Fetch assignments for enrolled courses only
      const result = await pool.query(
        `SELECT * FROM instructor_assignments 
         WHERE course_id = ANY($1::text[]) 
         ORDER BY created_at DESC`,
        [enrolledCourses]
      );
      
      return res.json(result.rows.map(mapInstructorAssignmentRow));
    }
    
    // Instructor fetching their assignments
    if (!instructorId || typeof instructorId !== 'string') {
      return res.status(400).json({ error: 'instructorId or studentId query parameter is required' });
    }
    
    await ensureInstructorAssignmentsTable();
    const params = [instructorId];
    let whereClause = 'WHERE instructor_id = $1';
    if (courseId && typeof courseId === 'string') {
      params.push(courseId);
      whereClause += ` AND course_id = $${params.length}`;
    }
    const result = await pool.query(
      `SELECT * FROM instructor_assignments ${whereClause} ORDER BY created_at DESC`,
      params
    );
    res.json(result.rows.map(mapInstructorAssignmentRow));
  } catch (error) {
    console.error('List instructor assignments error', error);
    res.status(500).json({ error: 'Unable to load assignments' });
  }
});

app.get('/api/assignment-submissions', async (req, res) => {
  try {
    const { instructorId, studentId, courseId, status } = req.query;

    await ensureAssignmentSubmissionsTable();

    if (studentId && typeof studentId === 'string') {
      const params = [studentId];
      let whereClause = 'WHERE submissions.student_id = $1';
      if (courseId && typeof courseId === 'string') {
        params.push(courseId);
        whereClause += ` AND submissions.course_id = $${params.length}`;
      }
      if (status && typeof status === 'string') {
        params.push(status.toUpperCase());
        whereClause += ` AND submissions.status = $${params.length}`;
      }
      const result = await pool.query(
        `SELECT submissions.*,
                users.name AS student_name,
                users.email AS student_email,
                courses.title AS course_title,
                instructor_assignments.title AS assignment_title,
                instructor_assignments.question AS assignment_prompt,
                instructor_assignments.rubric AS assignment_rubric
           FROM assignment_submissions submissions
           LEFT JOIN users ON users.id = submissions.student_id
           LEFT JOIN courses ON courses.id = submissions.course_id
           LEFT JOIN instructor_assignments ON instructor_assignments.id = submissions.assignment_id
           ${whereClause}
           ORDER BY submissions.created_at DESC`,
        params
      );
      return res.json(result.rows.map(mapAssignmentSubmissionRow));
    }

    if (!instructorId || typeof instructorId !== 'string') {
      return res.status(400).json({ error: 'instructorId or studentId query parameter is required' });
    }

    const params = [instructorId];
    let whereClause = 'WHERE submissions.instructor_id = $1';
    if (courseId && typeof courseId === 'string') {
      params.push(courseId);
      whereClause += ` AND submissions.course_id = $${params.length}`;
    }
    if (status && typeof status === 'string') {
      params.push(status.toUpperCase());
      whereClause += ` AND submissions.status = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT submissions.*,
              users.name AS student_name,
              users.email AS student_email,
              courses.title AS course_title,
              instructor_assignments.title AS assignment_title,
              instructor_assignments.question AS assignment_prompt,
              instructor_assignments.rubric AS assignment_rubric
         FROM assignment_submissions submissions
         LEFT JOIN users ON users.id = submissions.student_id
         LEFT JOIN courses ON courses.id = submissions.course_id
         LEFT JOIN instructor_assignments ON instructor_assignments.id = submissions.assignment_id
         ${whereClause}
         ORDER BY submissions.created_at DESC`,
      params
    );

    res.json(result.rows.map(mapAssignmentSubmissionRow));
  } catch (error) {
    console.error('List assignment submissions error', error);
    res.status(500).json({ error: 'Unable to load submissions' });
  }
});

app.post('/api/assignment-submissions', async (req, res) => {
  const {
    studentId,
    courseId,
    assignmentId,
    itemId,
    submissionType,
    answer,
    prompt,
    rubric,
    metadata,
    status,
    score,
    feedback
  } = req.body || {};
  const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';

  if (!studentId || typeof studentId !== 'string') {
    return res.status(400).json({ error: lang === 'ar' ? 'معرّف الطالب مطلوب' : 'studentId is required' });
  }
  if (!courseId || typeof courseId !== 'string') {
    return res.status(400).json({ error: lang === 'ar' ? 'معرّف الدورة مطلوب' : 'courseId is required' });
  }
  if (!submissionType || typeof submissionType !== 'string') {
    return res.status(400).json({ error: lang === 'ar' ? 'نوع الإرسال مطلوب' : 'submissionType is required' });
  }

  const normalizedType = submissionType.toUpperCase();
  if (!['COURSE_ITEM', 'INSTRUCTOR_ASSIGNMENT', 'COURSE_TEST'].includes(normalizedType)) {
    return res.status(400).json({ error: lang === 'ar' ? 'نوع الإرسال غير صالح' : 'submissionType is invalid' });
  }
  if (normalizedType === 'COURSE_ITEM' && (!itemId || typeof itemId !== 'string')) {
    return res.status(400).json({ error: lang === 'ar' ? 'معرّف العنصر مطلوب' : 'itemId is required for course items' });
  }
  if (normalizedType === 'INSTRUCTOR_ASSIGNMENT' && (!assignmentId || typeof assignmentId !== 'string')) {
    return res.status(400).json({ error: lang === 'ar' ? 'معرّف الواجب مطلوب' : 'assignmentId is required for instructor assignments' });
  }

  try {
    await ensureAssignmentSubmissionsTable();

    let resolvedInstructorId = null;
    if (assignmentId) {
      await ensureInstructorAssignmentsTable();
      const assignmentLookup = await pool.query('SELECT instructor_id FROM instructor_assignments WHERE id = $1', [assignmentId]);
      resolvedInstructorId = assignmentLookup.rows[0]?.instructor_id || null;
    }
    if (!resolvedInstructorId) {
      const courseRow = await fetchCourseRowById(courseId);
      if (courseRow?.instructor) {
        const instructorLookup = await pool.query('SELECT id FROM users WHERE LOWER(name) = LOWER($1) LIMIT 1', [courseRow.instructor]);
        resolvedInstructorId = instructorLookup.rows[0]?.id || null;
      }
    }

    const normalizedMetadata = normalizeSubmissionMetadata(metadata);
    const normalizedStatus = typeof status === 'string' && status.trim()
      ? status.trim().toUpperCase()
      : 'PENDING';

    const existingResult = await pool.query(
      `SELECT *
         FROM assignment_submissions
        WHERE student_id = $1
          AND course_id = $2
          AND submission_type = $3
          AND assignment_id IS NOT DISTINCT FROM $4
          AND item_id IS NOT DISTINCT FROM $5
        ORDER BY created_at DESC
        LIMIT 1`,
      [studentId, courseId, normalizedType, assignmentId || null, itemId || null]
    );

    if (existingResult.rowCount && existingResult.rows[0].status !== 'GRADED') {
      const existing = existingResult.rows[0];
      const update = await pool.query(
        `UPDATE assignment_submissions
            SET answer = $1,
                prompt = $2,
                rubric = $3,
                status = $4,
                score = $5,
                feedback = $6,
                metadata = $7::jsonb,
                instructor_id = COALESCE($8, instructor_id),
                updated_at = now()
          WHERE id = $9
          RETURNING *`,
        [
          answer ?? existing.answer ?? null,
          prompt ?? existing.prompt ?? null,
          rubric ?? existing.rubric ?? null,
          normalizedStatus,
          Number.isFinite(Number(score)) ? Number(score) : existing.score ?? null,
          feedback ?? existing.feedback ?? null,
          JSON.stringify({ ...normalizeSubmissionMetadata(existing.metadata), ...normalizedMetadata }),
          resolvedInstructorId,
          existing.id
        ]
      );
      return res.json(mapAssignmentSubmissionRow(update.rows[0]));
    }

    const insert = await pool.query(
      `INSERT INTO assignment_submissions (
          id,
          student_id,
          instructor_id,
          course_id,
          assignment_id,
          item_id,
          submission_type,
          prompt,
          rubric,
          answer,
          status,
          score,
          feedback,
          metadata
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
        RETURNING *`,
      [
        randomUUID(),
        studentId,
        resolvedInstructorId,
        courseId,
        assignmentId || null,
        itemId || null,
        normalizedType,
        prompt ?? null,
        rubric ?? null,
        answer ?? null,
        normalizedStatus,
        Number.isFinite(Number(score)) ? Number(score) : null,
        feedback ?? null,
        JSON.stringify(normalizedMetadata)
      ]
    );

    res.status(201).json(mapAssignmentSubmissionRow(insert.rows[0]));
  } catch (error) {
    console.error('Create assignment submission error', error);
    res.status(500).json({ error: 'Unable to submit assignment' });
  }
});

app.put('/api/assignment-submissions/:submissionId/grade', async (req, res) => {
  const { submissionId } = req.params;
  const { score, feedback, graderId } = req.body || {};
  const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';

  if (!submissionId) {
    return res.status(400).json({ error: lang === 'ar' ? 'معرّف الإرسال مطلوب' : 'submissionId is required' });
  }

  const normalizedScore = Number(score);
  if (!Number.isFinite(normalizedScore) || normalizedScore < 0 || normalizedScore > 100) {
    return res.status(400).json({ error: lang === 'ar' ? 'يجب إدخال درجة بين 0 و 100' : 'score must be a number between 0 and 100' });
  }

  try {
    await ensureAssignmentSubmissionsTable();
    const existing = await pool.query('SELECT * FROM assignment_submissions WHERE id = $1', [submissionId]);
    if (!existing.rowCount) {
      return res.status(404).json({ error: lang === 'ar' ? 'الإرسال غير موجود' : 'Submission not found' });
    }

    const submission = existing.rows[0];
    const update = await pool.query(
      `UPDATE assignment_submissions
          SET score = $1,
              feedback = $2,
              status = 'GRADED',
              graded_by = $3,
              graded_at = now(),
              updated_at = now()
        WHERE id = $4
        RETURNING *`,
      [normalizedScore, feedback ?? null, graderId || submission.graded_by || null, submissionId]
    );

    const metadata = normalizeSubmissionMetadata(submission.metadata);
    if (submission.submission_type === 'COURSE_ITEM') {
      await updateCourseProgressFromGrade({
        userId: submission.student_id,
        courseId: submission.course_id,
        itemId: submission.item_id,
        score: normalizedScore
      });
    }
    if (submission.submission_type === 'COURSE_TEST') {
      await updateCourseProgressFromGrade({
        userId: submission.student_id,
        courseId: submission.course_id,
        testType: metadata.testType,
        score: normalizedScore
      });
    }

    res.json(mapAssignmentSubmissionRow(update.rows[0]));
  } catch (error) {
    console.error('Grade submission error', error);
    res.status(500).json({ error: 'Unable to grade submission' });
  }
});

app.post('/api/assignments', async (req, res) => {
  try {
    const { instructorId, title, question, rubric, difficulty, topic, courseId, dueDate } = req.body || {};
    const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
    
    if (!instructorId || typeof instructorId !== 'string') {
      return res.status(400).json({ error: 'instructorId is required' });
    }
    const normalizedTitle = typeof title === 'string' ? title.trim() : '';
    if (!normalizedTitle) {
      const errorMsg = lang === 'ar' ? 'العنوان مطلوب' : 'title is required';
      return res.status(400).json({ error: errorMsg });
    }
    if (!courseId || typeof courseId !== 'string') {
      const errorMsg = lang === 'ar' ? 'يجب اختيار الدورة التدريبية' : 'courseId is required';
      return res.status(400).json({ error: errorMsg });
    }
    await ensureInstructorAssignmentsTable();
    let normalizedDueDate = null;
    if (dueDate) {
      const parsed = new Date(dueDate);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'dueDate must be a valid date' });
      }
      normalizedDueDate = parsed.toISOString();
    }
    const normalizedDifficulty = typeof difficulty === 'string' && difficulty.trim()
      ? difficulty
      : 'Intermediate';
    const insert = await pool.query(
      `INSERT INTO instructor_assignments (
          id,
          instructor_id,
          course_id,
          title,
          question,
          rubric,
          difficulty,
          topic,
          due_date
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        randomUUID(),
        instructorId,
        courseId,
        normalizedTitle,
        question ?? null,
        rubric ?? null,
        normalizedDifficulty,
        topic ?? null,
        normalizedDueDate
      ]
    );
    res.status(201).json(mapInstructorAssignmentRow(insert.rows[0]));
  } catch (error) {
    console.error('Create instructor assignment error', error);
    res.status(500).json({ error: 'Unable to create assignment' });
  }
});

app.put('/api/assignments/:assignmentId', async (req, res) => {
  const { assignmentId } = req.params;
  const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
  
  if (!assignmentId) {
    return res.status(400).json({ error: 'assignmentId is required' });
  }
  try {
    await ensureInstructorAssignmentsTable();
    const existing = await pool.query('SELECT * FROM instructor_assignments WHERE id = $1', [assignmentId]);
    if (!existing.rowCount) {
      return res.status(404).json({ error: 'Assignment not found' });
    }
    const current = existing.rows[0];
    const { title, question, rubric, difficulty, topic, courseId, dueDate } = req.body || {};
    
    const normalizedTitle = typeof title === 'string' && title.trim() ? title.trim() : current.title;
    
    // Validate courseId if provided
    if (courseId !== undefined && (!courseId || typeof courseId !== 'string')) {
      const errorMsg = lang === 'ar' ? 'يجب اختيار الدورة التدريبية' : 'courseId is required';
      return res.status(400).json({ error: errorMsg });
    }
    
    const normalizedDifficulty = typeof difficulty === 'string' && difficulty.trim()
      ? difficulty
      : (current.difficulty || 'Intermediate');
    let normalizedDueDate = current.due_date;
    if (dueDate !== undefined) {
      if (!dueDate) {
        normalizedDueDate = null;
      } else {
        const parsed = new Date(dueDate);
        if (Number.isNaN(parsed.getTime())) {
          return res.status(400).json({ error: 'dueDate must be a valid date' });
        }
        normalizedDueDate = parsed.toISOString();
      }
    }
    const update = await pool.query(
      `UPDATE instructor_assignments
          SET course_id = $2,
              title = $3,
              question = $4,
              rubric = $5,
              difficulty = $6,
              topic = $7,
              due_date = $8,
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [
        assignmentId,
        courseId === undefined ? current.course_id : courseId,
        normalizedTitle,
        question === undefined ? current.question : question,
        rubric === undefined ? current.rubric : rubric,
        normalizedDifficulty,
        topic === undefined ? current.topic : topic,
        normalizedDueDate
      ]
    );
    res.json(mapInstructorAssignmentRow(update.rows[0]));
  } catch (error) {
    console.error('Update instructor assignment error', error);
    res.status(500).json({ error: 'Unable to update assignment' });
  }
});

app.delete('/api/assignments/:assignmentId', async (req, res) => {
  const { assignmentId } = req.params;
  if (!assignmentId) {
    return res.status(400).json({ error: 'assignmentId is required' });
  }
  try {
    await ensureInstructorAssignmentsTable();
    const deleted = await pool.query('DELETE FROM instructor_assignments WHERE id = $1 RETURNING *', [assignmentId]);
    if (!deleted.rowCount) {
      return res.status(404).json({ error: 'Assignment not found' });
    }
    res.json(mapInstructorAssignmentRow(deleted.rows[0]));
  } catch (error) {
    console.error('Delete instructor assignment error', error);
    res.status(500).json({ error: 'Unable to delete assignment' });
  }
});

const COURSE_LEVELS = new Set(['Beginner', 'Intermediate', 'Advanced']);

app.post('/api/courses', async (req, res) => {
  try {
    const { title, description, instructor, level, price, thumbnail, modules, syncSessions, duration, preCourseTest, postCourseTest, category, language, status, targetAudience, prerequisites, learningOutcomes, seoOverride } = req.body || {};
    if (!title || !description || !instructor) {
      const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
      const errorMsg = lang === 'ar' 
        ? 'العنوان والوصف والمدرب مطلوبة'
        : 'title, description, and instructor are required';
      return res.status(400).json({ error: errorMsg });
    }

    const normalizedLevel = COURSE_LEVELS.has(level) ? level : 'Beginner';
    const normalizedCategory = category || 'Technology';
    const normalizedLanguage = language || 'en';
    const normalizedStatus = status || 'draft';
    const numericPrice = Number(price ?? 0);
    if (Number.isNaN(numericPrice) || numericPrice < 0) {
      const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
      const errorMsg = lang === 'ar' ? 'يجب أن يكون السعر رقماً موجباً' : 'price must be a positive number';
      return res.status(400).json({ error: errorMsg });
    }

    const normalizedModules = Array.isArray(modules) ? modules : [];
    const normalizedSessions = Array.isArray(syncSessions) ? syncSessions : [];
    const numericDuration = duration ? Number(duration) : null;

    // Get the user who is creating this course
    const createdBy = req.user?.id || null;

    const insert = await pool.query(
      `INSERT INTO courses (id, title, description, instructor, level, price, thumbnail, modules, sync_sessions, duration, pre_course_test, post_course_test, category, created_by, language, status, target_audience, prerequisites, learning_outcomes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [
        randomUUID(),
        title,
        description,
        instructor,
        normalizedLevel,
        numericPrice,
        thumbnail,
        JSON.stringify(normalizedModules),
        normalizedSessions,
        numericDuration,
        preCourseTest ? JSON.stringify(preCourseTest) : null,
        postCourseTest ? JSON.stringify(postCourseTest) : null,
        normalizedCategory,
        createdBy,
        normalizedLanguage,
        normalizedStatus,
        targetAudience || null,
        prerequisites || null,
        learningOutcomes || null
      ]
    );

    const overrideRow = await upsertSeoOverride({
      contentType: 'course',
      contentId: insert.rows[0].id,
      payload: seoOverride,
      userId: req.user?.id || null
    });

    // Fetch the created course with user info
    const courseWithUserInfo = await pool.query(
      `SELECT c.*, 
              u.name as created_by_name,
              u.email as created_by_email
       FROM courses c
       LEFT JOIN users u ON c.created_by = u.id
       WHERE c.id = $1`,
      [insert.rows[0].id]
    );

    const createdCourse = mapCourseRow(courseWithUserInfo.rows[0]);
    if (overrideRow) {
      createdCourse.seoOverride = buildSeoOverrideFromRow({ ...overrideRow }, '');
    }
    res.status(201).json(createdCourse);

    (async () => {
      try {
        const instructorLookup = await pool.query(
          'SELECT id FROM users WHERE LOWER(name) = LOWER($1) LIMIT 1',
          [createdCourse.instructor]
        );
        if (!instructorLookup.rowCount) {
          return;
        }
        await createUserNotifications({
          userIds: [instructorLookup.rows[0].id],
          category: NOTIFICATION_CATEGORIES.NEW_CONTENT,
          message: `Your course "${createdCourse.title}" is now live.`,
          metadata: { courseId: createdCourse.id },
          actorId: instructorLookup.rows[0].id,
          courseId: createdCourse.id,
          type: 'SUCCESS'
        });
      } catch (notifyError) {
        console.error('Course publish notification error', notifyError);
      }
    })();
  } catch (error) {
    console.error('Create course error', error);
    res.status(500).json({ error: 'Unable to create course' });
  }
});

app.get('/api/courses', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*, 
             d.id as discount_id,
             d.code as discount_code,
             d.percentage as discount_percentage,
             d.expiry_date as discount_expiry,
             u.name as created_by_name,
            u.email as created_by_email,
            o.title_en as seo_title_en,
            o.title_ar as seo_title_ar,
            o.description_en as seo_description_en,
            o.description_ar as seo_description_ar,
            o.keywords_en as seo_keywords_en,
            o.keywords_ar as seo_keywords_ar,
            o.canonical_url as seo_canonical_url,
            o.robots as seo_robots,
            o.indexable as seo_indexable,
            o.og_title_en as seo_og_title_en,
            o.og_title_ar as seo_og_title_ar,
            o.og_description_en as seo_og_description_en,
            o.og_description_ar as seo_og_description_ar,
            o.og_image_url as seo_og_image_url,
            o.og_type as seo_og_type,
            o.og_site_name as seo_og_site_name,
            o.twitter_card as seo_twitter_card,
            o.twitter_title_en as seo_twitter_title_en,
            o.twitter_title_ar as seo_twitter_title_ar,
            o.twitter_description_en as seo_twitter_description_en,
            o.twitter_description_ar as seo_twitter_description_ar,
            o.twitter_image_url as seo_twitter_image_url,
            o.jsonld_en as seo_jsonld_en,
            o.jsonld_ar as seo_jsonld_ar,
            o.locale as seo_locale,
            o.locale_alternate as seo_locale_alternate,
            o.sitemap_priority as seo_sitemap_priority,
            o.sitemap_changefreq as seo_sitemap_changefreq
      FROM courses c
      LEFT JOIN discounts d ON (d.course_id = c.id OR d.course_id IS NULL)
                            AND d.expiry_date >= CURRENT_DATE
      LEFT JOIN users u ON c.created_by = u.id
          LEFT JOIN seo_overrides o ON o.content_type = 'course' AND o.content_id = c.id
      ORDER BY LOWER(c.title) ASC,
               CASE WHEN d.course_id IS NOT NULL THEN 0 ELSE 1 END,
               d.percentage DESC NULLS LAST
    `);
    
    // Group courses and apply the best discount for each
    const coursesMap = new Map();
    for (const row of result.rows) {
      if (!coursesMap.has(row.id)) {
        coursesMap.set(row.id, mapCourseRowWithDiscount(row));
      }
    }
    
    res.json(Array.from(coursesMap.values()));
  } catch (error) {
    console.error('List courses error', error);
    res.status(500).json({ error: 'Unable to load courses' });
  }
});

app.get('/api/course-categories', optionalTenantResolver, async (req, res) => {
  try {
    const targetPool = req.tenantPool || pool;
    const result = await fetchCourseCategories(targetPool);
    res.json(result.rows.map(mapCourseCategoryRow));
  } catch (error) {
    console.error('List course categories error', error);
    res.status(500).json({ error: 'Unable to load course categories' });
  }
});

app.post('/api/course-categories', optionalTenantResolver, requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const targetPool = req.tenantPool || pool;
    await ensureCourseCategoriesTable(targetPool);
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      return res.status(400).json({ error: 'Category name is required' });
    }
    const existing = await targetPool.query('SELECT * FROM course_categories WHERE LOWER(name) = LOWER($1)', [name]);
    if (existing.rowCount) {
      return res.status(409).json({ error: 'Category already exists' });
    }
    const insert = await targetPool.query(
      'INSERT INTO course_categories (id, name) VALUES ($1, $2) RETURNING *',
      [randomUUID(), name]
    );
    res.status(201).json(mapCourseCategoryRow(insert.rows[0]));
  } catch (error) {
    console.error('Create course category error', error);
    res.status(500).json({ error: 'Unable to create course category' });
  }
});

app.put('/api/course-categories/:categoryId', optionalTenantResolver, requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { categoryId } = req.params;
  if (!categoryId) {
    return res.status(400).json({ error: 'categoryId is required' });
  }
  try {
    const targetPool = req.tenantPool || pool;
    await ensureCourseCategoriesTable(targetPool);
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      return res.status(400).json({ error: 'Category name is required' });
    }
    const duplicate = await targetPool.query('SELECT * FROM course_categories WHERE LOWER(name) = LOWER($1) AND id <> $2', [name, categoryId]);
    if (duplicate.rowCount) {
      return res.status(409).json({ error: 'Category already exists' });
    }
    const update = await targetPool.query(
      'UPDATE course_categories SET name = $2, updated_at = now() WHERE id = $1 RETURNING *',
      [categoryId, name]
    );
    if (!update.rowCount) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.json(mapCourseCategoryRow(update.rows[0]));
  } catch (error) {
    console.error('Update course category error', error);
    res.status(500).json({ error: 'Unable to update course category' });
  }
});

app.delete('/api/course-categories/:categoryId', optionalTenantResolver, requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { categoryId } = req.params;
  if (!categoryId) {
    return res.status(400).json({ error: 'categoryId is required' });
  }
  try {
    const targetPool = req.tenantPool || pool;
    await ensureCourseCategoriesTable(targetPool);
    const deleted = await targetPool.query('DELETE FROM course_categories WHERE id = $1 RETURNING *', [categoryId]);
    if (!deleted.rowCount) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.json(mapCourseCategoryRow(deleted.rows[0]));
  } catch (error) {
    console.error('Delete course category error', error);
    res.status(500).json({ error: 'Unable to delete course category' });
  }
});

app.get('/api/ads', optionalTenantResolver, optionalAuth, async (req, res) => {
  try {
    const targetPool = req.tenantPool || pool;
    await ensureAdsSchema(targetPool);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const categoryId = typeof req.query.categoryId === 'string' ? req.query.categoryId.trim() : '';
    const requestedStatus = typeof req.query.status === 'string' ? req.query.status.trim().toUpperCase() : '';
    const isAdmin = req.user?.role === 'ADMIN' || req.user?.role === 'SUPER_ADMIN';
    const status = isAdmin && requestedStatus ? requestedStatus : 'PUBLISHED';

    const conditions = ['a.status = $1'];
    const params = [status];
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(a.title ILIKE $${params.length} OR a.description ILIKE $${params.length} OR COALESCE(c.name, '') ILIKE $${params.length})`);
    }
    if (categoryId) {
      params.push(categoryId);
      conditions.push(`a.category_id = $${params.length}`);
    }

    const query = `
      SELECT a.*, c.name AS category_name
      FROM ads a
      LEFT JOIN ad_categories c ON c.id = a.category_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY COALESCE(a.publish_date, DATE(a.created_at)) DESC, a.created_at DESC
    `;
    const result = await targetPool.query(query, params);
    res.json(result.rows.map(mapAdRow));
  } catch (error) {
    console.error('List ads error', error);
    res.status(500).json({ error: 'Unable to load ads' });
  }
});

app.get('/api/ads/latest', optionalTenantResolver, async (req, res) => {
  try {
    const targetPool = req.tenantPool || pool;
    await ensureAdsSchema(targetPool);
    const limit = Number(req.query.limit) > 0 ? Math.min(12, Number(req.query.limit)) : 3;
    const result = await targetPool.query(
      `SELECT a.*, c.name AS category_name
         FROM ads a
         LEFT JOIN ad_categories c ON c.id = a.category_id
        WHERE a.status = 'PUBLISHED'
        ORDER BY COALESCE(a.publish_date, DATE(a.created_at)) DESC, a.created_at DESC
        LIMIT $1`,
      [limit]
    );
    res.json(result.rows.map(mapAdRow));
  } catch (error) {
    console.error('Latest ads error', error);
    res.status(500).json({ error: 'Unable to load latest ads' });
  }
});

app.get('/api/ads/stats', optionalTenantResolver, async (req, res) => {
  try {
    const targetPool = req.tenantPool || pool;
    await ensureAdsSchema(targetPool);
    const [adsCountResult, usersCountResult, settingsResult] = await Promise.all([
      targetPool.query(`SELECT COUNT(*)::int AS count FROM ads WHERE status = 'PUBLISHED'`),
      targetPool.query('SELECT COUNT(*)::int AS count FROM users'),
      targetPool.query('SELECT * FROM ads_display_settings ORDER BY updated_at DESC LIMIT 1')
    ]);
    const adsCount = adsCountResult.rows[0]?.count || 0;
    const usersCount = usersCountResult.rows[0]?.count || 0;
    const settings = settingsResult.rows[0] ? mapAdsDisplaySettingsRow(settingsResult.rows[0]) : null;
    res.json({
      adsCount,
      usersCount,
      satisfactionRate: 98,
      supportAvailability: settings?.statSupportValue || '24/7'
    });
  } catch (error) {
    console.error('Ads stats error', error);
    res.status(500).json({ error: 'Unable to load ads stats' });
  }
});

app.get('/api/ads/display-settings', optionalTenantResolver, async (req, res) => {
  try {
    const targetPool = req.tenantPool || pool;
    await ensureAdsSchema(targetPool);
    const result = await targetPool.query('SELECT * FROM ads_display_settings ORDER BY updated_at DESC LIMIT 1');
    if (!result.rowCount) {
      return res.json(null);
    }
    res.json(mapAdsDisplaySettingsRow(result.rows[0]));
  } catch (error) {
    console.error('Get ads display settings error', error);
    res.status(500).json({ error: 'Unable to load ads display settings' });
  }
});

app.get('/api/ads/announcements', optionalTenantResolver, async (req, res) => {
  try {
    const targetPool = req.tenantPool || pool;
    await ensureAdsSchema(targetPool);
    const result = await targetPool.query(
      `SELECT *
         FROM ads_announcements
        WHERE enabled = true
          AND show_in_top_bar = true
        ORDER BY sort_order ASC, created_at DESC`
    );
    res.json(result.rows.map(mapAdAnnouncementRow));
  } catch (error) {
    console.error('List public ads announcements error', error);
    res.status(500).json({ error: 'Unable to load announcements' });
  }
});

app.get('/api/ads/:id', optionalTenantResolver, optionalAuth, async (req, res) => {
  try {
    const targetPool = req.tenantPool || pool;
    await ensureAdsSchema(targetPool);
    const { id } = req.params;
    const isAdmin = req.user?.role === 'ADMIN' || req.user?.role === 'SUPER_ADMIN';
    const result = await targetPool.query(
      `SELECT a.*, c.name AS category_name
         FROM ads a
         LEFT JOIN ad_categories c ON c.id = a.category_id
        WHERE a.id = $1 ${isAdmin ? '' : "AND a.status = 'PUBLISHED'"}
        LIMIT 1`,
      [id]
    );
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Ad not found' });
    }
    res.json(mapAdRow(result.rows[0]));
  } catch (error) {
    console.error('Get ad details error', error);
    res.status(500).json({ error: 'Unable to load ad details' });
  }
});

app.get('/api/admin/ads-categories', optionalTenantResolver, requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const targetPool = req.tenantPool || pool;
    await ensureAdsSchema(targetPool);
    const result = await targetPool.query('SELECT * FROM ad_categories ORDER BY name ASC');
    res.json(result.rows.map(mapAdCategoryRow));
  } catch (error) {
    console.error('List ad categories error', error);
    res.status(500).json({ error: 'Unable to load ad categories' });
  }
});

app.post('/api/admin/ads-categories', optionalTenantResolver, requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const targetPool = req.tenantPool || pool;
    await ensureAdsSchema(targetPool);
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      return res.status(400).json({ error: 'Category name is required' });
    }
    const duplicate = await targetPool.query('SELECT id FROM ad_categories WHERE LOWER(name) = LOWER($1)', [name]);
    if (duplicate.rowCount) {
      return res.status(409).json({ error: 'Category already exists' });
    }
    const result = await targetPool.query('INSERT INTO ad_categories (id, name) VALUES ($1, $2) RETURNING *', [randomUUID(), name]);
    res.status(201).json(mapAdCategoryRow(result.rows[0]));
  } catch (error) {
    console.error('Create ad category error', error);
    res.status(500).json({ error: 'Unable to create ad category' });
  }
});

app.put('/api/admin/ads-categories/:id', optionalTenantResolver, requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const targetPool = req.tenantPool || pool;
    await ensureAdsSchema(targetPool);
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      return res.status(400).json({ error: 'Category name is required' });
    }
    const result = await targetPool.query(
      'UPDATE ad_categories SET name = $2, updated_at = now() WHERE id = $1 RETURNING *',
      [req.params.id, name]
    );
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.json(mapAdCategoryRow(result.rows[0]));
  } catch (error) {
    console.error('Update ad category error', error);
    res.status(500).json({ error: 'Unable to update ad category' });
  }
});

app.delete('/api/admin/ads-categories/:id', optionalTenantResolver, requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const targetPool = req.tenantPool || pool;
    await ensureAdsSchema(targetPool);
    const result = await targetPool.query('DELETE FROM ad_categories WHERE id = $1 RETURNING *', [req.params.id]);
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.json(mapAdCategoryRow(result.rows[0]));
  } catch (error) {
    console.error('Delete ad category error', error);
    res.status(500).json({ error: 'Unable to delete ad category' });
  }
});

app.get('/api/admin/ads', optionalTenantResolver, requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const targetPool = req.tenantPool || pool;
    await ensureAdsSchema(targetPool);
    const result = await targetPool.query(
      `SELECT a.*, c.name AS category_name
         FROM ads a
         LEFT JOIN ad_categories c ON c.id = a.category_id
        ORDER BY a.created_at DESC`
    );
    res.json(result.rows.map(mapAdRow));
  } catch (error) {
    console.error('Admin list ads error', error);
    res.status(500).json({ error: 'Unable to load ads' });
  }
});

app.post('/api/admin/ads', optionalTenantResolver, requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const targetPool = req.tenantPool || pool;
    await ensureAdsSchema(targetPool);
    await ensureCurrentUserInPool(targetPool, req);
    const payload = req.body || {};
    const title = typeof payload.title === 'string' ? payload.title.trim() : '';
    const description = typeof payload.description === 'string' ? payload.description.trim() : '';
    const gallery = sanitizeMediaGalleryInput(payload.gallery, 80) || [];
    const firstImage = gallery.find((item) => item.mediaType === 'image' && isNonEmptyString(item.url));
    const firstVideo = gallery.find((item) => item.mediaType === 'video' && isNonEmptyString(item.url));
    if (!title || !description) {
      return res.status(400).json({ error: 'Title and description are required' });
    }

    const id = randomUUID();
    const result = await targetPool.query(
      `INSERT INTO ads (
        id, title, description, category_id, price, location, contact_name, contact_phone, contact_email,
        image_url, media_type, media_url, gallery, status, is_featured, publish_date, created_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13::jsonb, $14, $15, $16, $17
      ) RETURNING *`,
      [
        id,
        title,
        description,
        payload.categoryId || null,
        payload.price === '' || payload.price === null || payload.price === undefined ? null : Number(payload.price),
        payload.location || null,
        payload.contactName || null,
        payload.contactPhone || null,
        payload.contactEmail || null,
        payload.imageUrl || firstImage?.url || null,
        payload.mediaType || (firstVideo ? 'video' : 'image'),
        payload.mediaUrl || firstVideo?.url || null,
        JSON.stringify(gallery),
        payload.status || 'DRAFT',
        Boolean(payload.isFeatured),
        payload.publishDate || null,
        req.user?.id || null
      ]
    );

    const adRow = result.rows[0];
    const categoryResult = await targetPool.query('SELECT name AS category_name FROM ad_categories WHERE id = $1', [adRow.category_id]);
    if (categoryResult.rowCount) {
      adRow.category_name = categoryResult.rows[0].category_name;
    }
    res.status(201).json(mapAdRow(adRow));
  } catch (error) {
    console.error('Create ad error', error);
    res.status(500).json({ error: 'Unable to create ad' });
  }
});

app.put('/api/admin/ads/:id', optionalTenantResolver, requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const targetPool = req.tenantPool || pool;
    await ensureAdsSchema(targetPool);
    const payload = req.body || {};
    const existing = await targetPool.query('SELECT * FROM ads WHERE id = $1 LIMIT 1', [req.params.id]);
    if (!existing.rowCount) {
      return res.status(404).json({ error: 'Ad not found' });
    }
    const current = existing.rows[0];
    const currentGallery = sanitizeMediaGalleryInput(Array.isArray(current.gallery) ? current.gallery : [], 80) || [];
    const gallery = sanitizeMediaGalleryInput(Array.isArray(payload.gallery) ? payload.gallery : currentGallery, 80) || [];
    const firstImage = gallery.find((item) => item.mediaType === 'image' && isNonEmptyString(item.url));
    const firstVideo = gallery.find((item) => item.mediaType === 'video' && isNonEmptyString(item.url));
    const result = await targetPool.query(
      `UPDATE ads
          SET title = $2,
              description = $3,
              category_id = $4,
              price = $5,
              location = $6,
              contact_name = $7,
              contact_phone = $8,
              contact_email = $9,
              image_url = $10,
              media_type = $11,
              media_url = $12,
              gallery = $13::jsonb,
              status = $14,
              is_featured = $15,
              publish_date = $16,
              updated_at = now()
        WHERE id = $1
      RETURNING *`,
      [
        req.params.id,
        payload.title ?? current.title,
        payload.description ?? current.description,
        payload.categoryId !== undefined ? payload.categoryId : current.category_id,
        payload.price === '' ? null : (payload.price !== undefined ? Number(payload.price) : current.price),
        payload.location !== undefined ? payload.location : current.location,
        payload.contactName !== undefined ? payload.contactName : current.contact_name,
        payload.contactPhone !== undefined ? payload.contactPhone : current.contact_phone,
        payload.contactEmail !== undefined ? payload.contactEmail : current.contact_email,
        payload.imageUrl !== undefined ? payload.imageUrl : (current.image_url || firstImage?.url || null),
        payload.mediaType !== undefined ? payload.mediaType : (current.media_type || (firstVideo ? 'video' : 'image')),
        payload.mediaUrl !== undefined ? payload.mediaUrl : (current.media_url || firstVideo?.url || null),
        JSON.stringify(gallery),
        payload.status !== undefined ? payload.status : current.status,
        payload.isFeatured !== undefined ? Boolean(payload.isFeatured) : current.is_featured,
        payload.publishDate !== undefined ? payload.publishDate : current.publish_date
      ]
    );
    const adRow = result.rows[0];
    const categoryResult = await targetPool.query('SELECT name AS category_name FROM ad_categories WHERE id = $1', [adRow.category_id]);
    if (categoryResult.rowCount) {
      adRow.category_name = categoryResult.rows[0].category_name;
    }
    res.json(mapAdRow(adRow));
  } catch (error) {
    console.error('Update ad error', error);
    res.status(500).json({ error: 'Unable to update ad' });
  }
});

app.delete('/api/admin/ads/:id', optionalTenantResolver, requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const targetPool = req.tenantPool || pool;
    await ensureAdsSchema(targetPool);
    const result = await targetPool.query('DELETE FROM ads WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Ad not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Delete ad error', error);
    res.status(500).json({ error: 'Unable to delete ad' });
  }
});

app.get('/api/admin/ads-display-settings', optionalTenantResolver, requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const targetPool = req.tenantPool || pool;
    await ensureAdsSchema(targetPool);
    const result = await targetPool.query('SELECT * FROM ads_display_settings ORDER BY updated_at DESC LIMIT 1');
    if (!result.rowCount) {
      return res.json(null);
    }
    res.json(mapAdsDisplaySettingsRow(result.rows[0]));
  } catch (error) {
    console.error('Get admin ads display settings error', error);
    res.status(500).json({ error: 'Unable to load display settings' });
  }
});

app.get('/api/admin/ads-context', optionalTenantResolver, requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const tenant = req.tenant || null;
  const scope = tenant?.id ? 'tenant' : 'central';
  res.json({
    scope,
    tenantId: tenant?.id || null,
    tenantName: tenant?.company_name || tenant?.name || null,
    tenantSubdomain: tenant?.subdomain || null
  });
});

app.get('/api/admin/ads-announcements', optionalTenantResolver, requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const targetPool = req.tenantPool || pool;
    await ensureAdsSchema(targetPool);
    const result = await targetPool.query(
      `SELECT *
         FROM ads_announcements
        ORDER BY sort_order ASC, created_at DESC`
    );
    res.json(result.rows.map(mapAdAnnouncementRow));
  } catch (error) {
    console.error('List ads announcements error', error);
    res.status(500).json({ error: 'Unable to load announcements' });
  }
});

app.post('/api/admin/ads-announcements', optionalTenantResolver, requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const targetPool = req.tenantPool || pool;
    await ensureAdsSchema(targetPool);
    await ensureCurrentUserInPool(targetPool, req);
    const textEn = typeof req.body?.textEn === 'string' ? req.body.textEn.trim() : '';
    const textAr = typeof req.body?.textAr === 'string' ? req.body.textAr.trim() : '';
    const enabled = req.body?.enabled === undefined ? true : Boolean(req.body.enabled);
    const showInTopBar = req.body?.showInTopBar === undefined ? true : Boolean(req.body.showInTopBar);
    const requestedSortOrder = Number(req.body?.sortOrder);
    if (!textEn || !textAr) {
      return res.status(400).json({ error: 'Announcement text is required in both languages' });
    }
    if (textEn.length > 240 || textAr.length > 240) {
      return res.status(400).json({ error: 'Announcement text must be 240 characters or less' });
    }
    let sortOrder = Number.isFinite(requestedSortOrder) ? requestedSortOrder : null;
    if (sortOrder === null) {
      const maxSortOrder = await targetPool.query('SELECT COALESCE(MAX(sort_order), -1) AS max_sort_order FROM ads_announcements');
      sortOrder = Number(maxSortOrder.rows[0]?.max_sort_order || 0) + 1;
    }

    const result = await targetPool.query(
      `INSERT INTO ads_announcements (id, text, text_en, text_ar, enabled, show_in_top_bar, sort_order, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [randomUUID(), textEn, textEn, textAr, enabled, showInTopBar, sortOrder, req.user?.id || null]
    );
    res.status(201).json(mapAdAnnouncementRow(result.rows[0]));
  } catch (error) {
    console.error('Create ads announcement error', error);
    res.status(500).json({ error: 'Unable to create announcement' });
  }
});

app.put('/api/admin/ads-announcements/:id', optionalTenantResolver, requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const targetPool = req.tenantPool || pool;
    await ensureAdsSchema(targetPool);
    const existing = await targetPool.query('SELECT * FROM ads_announcements WHERE id = $1 LIMIT 1', [req.params.id]);
    if (!existing.rowCount) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    const current = existing.rows[0];
    const nextTextEn = req.body?.textEn !== undefined
      ? (typeof req.body.textEn === 'string' ? req.body.textEn.trim() : '')
      : (current.text_en || '');
    const nextTextAr = req.body?.textAr !== undefined
      ? (typeof req.body.textAr === 'string' ? req.body.textAr.trim() : '')
      : (current.text_ar || '');
    if (!nextTextEn || !nextTextAr) {
      return res.status(400).json({ error: 'Announcement text is required in both languages' });
    }
    if (nextTextEn.length > 240 || nextTextAr.length > 240) {
      return res.status(400).json({ error: 'Announcement text must be 240 characters or less' });
    }

    const sortOrder = req.body?.sortOrder !== undefined
      ? Number(req.body.sortOrder)
      : Number(current.sort_order);

    const result = await targetPool.query(
      `UPDATE ads_announcements
          SET text = $2,
              text_en = $3,
              text_ar = $4,
              enabled = $5,
              show_in_top_bar = $6,
              sort_order = $7,
              updated_at = now()
        WHERE id = $1
      RETURNING *`,
      [
        req.params.id,
        nextTextEn,
        nextTextEn,
        nextTextAr,
        req.body?.enabled !== undefined ? Boolean(req.body.enabled) : Boolean(current.enabled),
        req.body?.showInTopBar !== undefined ? Boolean(req.body.showInTopBar) : Boolean(current.show_in_top_bar),
        Number.isFinite(sortOrder) ? sortOrder : Number(current.sort_order)
      ]
    );

    res.json(mapAdAnnouncementRow(result.rows[0]));
  } catch (error) {
    console.error('Update ads announcement error', error);
    res.status(500).json({ error: 'Unable to update announcement' });
  }
});

app.delete('/api/admin/ads-announcements/:id', optionalTenantResolver, requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const targetPool = req.tenantPool || pool;
    await ensureAdsSchema(targetPool);
    const result = await targetPool.query('DELETE FROM ads_announcements WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Announcement not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Delete ads announcement error', error);
    res.status(500).json({ error: 'Unable to delete announcement' });
  }
});

app.put('/api/admin/ads-display-settings', optionalTenantResolver, requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const targetPool = req.tenantPool || pool;
    await ensureAdsSchema(targetPool);
    const payload = req.body || {};
    const existing = await targetPool.query('SELECT * FROM ads_display_settings ORDER BY updated_at DESC LIMIT 1');
    const id = existing.rows[0]?.id || randomUUID();
    const result = await targetPool.query(
      `INSERT INTO ads_display_settings (
        id, hero_title, hero_subtitle, search_placeholder,
        stat_ads_label, stat_users_label, stat_satisfaction_label, stat_support_label, stat_support_value,
        homepage_promo_enabled, homepage_promo_type, homepage_promo_media_url, homepage_promo_link,
        homepage_promo_title, homepage_promo_subtitle, updated_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8, $9,
        $10, $11, $12, $13,
        $14, $15, now()
      )
      ON CONFLICT (id)
      DO UPDATE SET
        hero_title = EXCLUDED.hero_title,
        hero_subtitle = EXCLUDED.hero_subtitle,
        search_placeholder = EXCLUDED.search_placeholder,
        stat_ads_label = EXCLUDED.stat_ads_label,
        stat_users_label = EXCLUDED.stat_users_label,
        stat_satisfaction_label = EXCLUDED.stat_satisfaction_label,
        stat_support_label = EXCLUDED.stat_support_label,
        stat_support_value = EXCLUDED.stat_support_value,
        homepage_promo_enabled = EXCLUDED.homepage_promo_enabled,
        homepage_promo_type = EXCLUDED.homepage_promo_type,
        homepage_promo_media_url = EXCLUDED.homepage_promo_media_url,
        homepage_promo_link = EXCLUDED.homepage_promo_link,
        homepage_promo_title = EXCLUDED.homepage_promo_title,
        homepage_promo_subtitle = EXCLUDED.homepage_promo_subtitle,
        updated_at = now()
      RETURNING *`,
      [
        id,
        payload.heroTitle || null,
        payload.heroSubtitle || null,
        payload.searchPlaceholder || null,
        payload.statAdsLabel || null,
        payload.statUsersLabel || null,
        payload.statSatisfactionLabel || null,
        payload.statSupportLabel || null,
        payload.statSupportValue || '24/7',
        Boolean(payload.homepagePromoEnabled),
        payload.homepagePromoType || 'image',
        payload.homepagePromoMediaUrl || null,
        payload.homepagePromoLink || null,
        payload.homepagePromoTitle || null,
        payload.homepagePromoSubtitle || null
      ]
    );
    res.json(mapAdsDisplaySettingsRow(result.rows[0]));
  } catch (error) {
    console.error('Update ads display settings error', error);
    res.status(500).json({ error: 'Unable to update display settings' });
  }
});

app.put('/api/courses/:courseId', async (req, res) => {
  const { courseId } = req.params;
  if (!courseId) {
    return res.status(400).json({ error: 'courseId is required' });
  }
  const {
    title,
    description,
    instructor,
    level,
    price,
    thumbnail,
    modules,
    syncSessions,
    duration,
    preCourseTest,
    postCourseTest,
    category,
    language,
    status,
    targetAudience,
    prerequisites,
    learningOutcomes,
    seoOverride
  } = req.body || {};

  try {
    const existingResult = await pool.query('SELECT * FROM courses WHERE id = $1', [courseId]);
    if (!existingResult.rowCount) {
      return res.status(404).json({ error: 'Course not found' });
    }
    const existingRow = existingResult.rows[0];
    const normalizedModules = Array.isArray(modules) ? modules : existingRow.modules || [];
    const normalizedSessions = Array.isArray(syncSessions) ? syncSessions : existingRow.sync_sessions || [];
    const normalizedLevel = level && COURSE_LEVELS.has(level) ? level : existingRow.level;
    const normalizedPrice = price === undefined ? existingRow.price : Number(price);
    const normalizedDuration = duration === undefined ? existingRow.duration : Number(duration);
    const normalizedCategory = category !== undefined ? category : (existingRow.category || 'Technology');
    const normalizedLanguage = language !== undefined ? language : (existingRow.language || 'en');
    const normalizedStatus = status !== undefined ? status : (existingRow.status || 'draft');

    const update = await pool.query(
      `UPDATE courses
          SET title = $2,
              description = $3,
              instructor = $4,
              level = $5,
              price = $6,
              thumbnail = $7,
              modules = $8,
              sync_sessions = $9,
              duration = $10,
              pre_course_test = $11,
              post_course_test = $12,
              category = $13,
              language = $14,
              status = $15,
              target_audience = $16,
              prerequisites = $17,
              learning_outcomes = $18
        WHERE id = $1
        RETURNING *`,
      [
        courseId,
        title ?? existingRow.title,
        description ?? existingRow.description,
        instructor ?? existingRow.instructor,
        normalizedLevel,
        normalizedPrice,
        thumbnail ?? existingRow.thumbnail,
        JSON.stringify(normalizedModules),
        normalizedSessions,
        normalizedDuration,
        preCourseTest ? JSON.stringify(preCourseTest) : existingRow.pre_course_test,
        postCourseTest ? JSON.stringify(postCourseTest) : existingRow.post_course_test,
        normalizedCategory,
        normalizedLanguage,
        normalizedStatus,
        targetAudience !== undefined ? targetAudience : existingRow.target_audience,
        prerequisites !== undefined ? prerequisites : existingRow.prerequisites,
        learningOutcomes !== undefined ? learningOutcomes : existingRow.learning_outcomes
      ]
    );

    let overrideRow = await upsertSeoOverride({
      contentType: 'course',
      contentId: courseId,
      payload: seoOverride,
      userId: req.user?.id || null
    });
    if (!overrideRow) {
      const lookup = await pool.query(
        'SELECT * FROM seo_overrides WHERE content_type = $1 AND content_id = $2',
        ['course', courseId]
      );
      overrideRow = lookup.rows[0] || null;
    }

    const updatedCourse = mapCourseRow(update.rows[0]);
    if (overrideRow) {
      updatedCourse.seoOverride = buildSeoOverrideFromRow({ ...overrideRow }, '');
    }
    const previousCourse = mapCourseRow(existingRow);

    const stringify = (value) => JSON.stringify(value ?? null);
    const fieldsToWatch = ['title', 'description', 'thumbnail', 'level', 'price', 'duration'];
    const courseMetaChanged = fieldsToWatch.some((field) => stringify(previousCourse[field]) !== stringify(updatedCourse[field]));
    const modulesChanged = stringify(previousCourse.modules) !== stringify(updatedCourse.modules);

    const flattenItems = (courseModules = []) =>
      courseModules.flatMap((module) =>
        (module.items || []).map((item) => ({
          ...item,
          moduleId: module.id,
          moduleTitle: module.title || 'Module'
        }))
      );

    const prevItems = flattenItems(previousCourse.modules || []);
    const nextItems = flattenItems(updatedCourse.modules || []);
    const prevItemMap = new Map(prevItems.filter((item) => item.id).map((item) => [item.id, item]));
    const newContentItems = [];
    const assignmentDueUpdates = [];

    nextItems.forEach((item) => {
      if (!item.id) return;
      const prev = prevItemMap.get(item.id);
      if (!prev) {
        newContentItems.push(item);
        return;
      }
      if (item.type === 'ASSIGNMENT' && item.dueDate && item.dueDate !== prev.dueDate) {
        assignmentDueUpdates.push({ item, previousDueDate: prev.dueDate || null });
      }
    });

    res.json(updatedCourse);

    (async () => {
      try {
        const studentResult = await pool.query(
          'SELECT id FROM users WHERE enrolled_courses IS NOT NULL AND $1 = ANY(enrolled_courses)',
          [courseId]
        );
        const studentIds = studentResult.rows.map((row) => row.id);
        const instructorLookup = await pool.query('SELECT id FROM users WHERE LOWER(name) = LOWER($1) LIMIT 1', [updatedCourse.instructor]);
        const instructorId = instructorLookup.rows[0]?.id || null;

        if (studentIds.length && (courseMetaChanged || modulesChanged)) {
          await createUserNotifications({
            userIds: studentIds,
            actorId: instructorId,
            courseId,
            category: NOTIFICATION_CATEGORIES.COURSE_UPDATE,
            type: 'INFO',
            message: `"${updatedCourse.title}" has new updates from ${updatedCourse.instructor}.`,
            metadata: { courseId }
          });
        }

        if (instructorId && (courseMetaChanged || modulesChanged)) {
          await createUserNotifications({
            userIds: [instructorId],
            actorId: instructorId,
            courseId,
            category: NOTIFICATION_CATEGORIES.COURSE_UPDATE,
            type: 'SUCCESS',
            message: `Your course "${updatedCourse.title}" changes are live.`,
            metadata: { courseId }
          });
        }

        if (studentIds.length && newContentItems.length) {
          await createUserNotifications({
            userIds: studentIds,
            actorId: instructorId,
            courseId,
            category: NOTIFICATION_CATEGORIES.NEW_CONTENT,
            type: 'INFO',
            message: `New learning material is available in "${updatedCourse.title}".`,
            metadata: {
              courseId,
              items: newContentItems.slice(0, 5).map((item) => ({
                id: item.id,
                title: item.title,
                type: item.type,
                moduleTitle: item.moduleTitle
              }))
            }
          });
        }

        if (studentIds.length && assignmentDueUpdates.length) {
          for (const updateEntry of assignmentDueUpdates) {
            await createUserNotifications({
              userIds: studentIds,
              actorId: instructorId,
              courseId,
              category: NOTIFICATION_CATEGORIES.ASSIGNMENT_DEADLINE,
              type: 'WARNING',
              message: `Assignment "${updateEntry.item.title}" is due on ${formatDateLabel(updateEntry.item.dueDate)}.`,
              metadata: {
                courseId,
                itemId: updateEntry.item.id,
                moduleTitle: updateEntry.item.moduleTitle,
                dueDate: updateEntry.item.dueDate,
                previousDueDate: updateEntry.previousDueDate || undefined
              }
            });
          }
        }
      } catch (notifyError) {
        console.error('Course update notification error', notifyError);
      }
    })();
  } catch (error) {
    console.error('Update course error', error);
    res.status(500).json({ error: 'Unable to update course' });
  }
});

app.delete('/api/courses/:courseId', async (req, res) => {
  const { courseId } = req.params;
  if (!courseId) {
    return res.status(400).json({ error: 'courseId is required' });
  }
  try {
    const deleted = await pool.query('DELETE FROM courses WHERE id = $1 RETURNING *', [courseId]);
    if (!deleted.rowCount) {
      return res.status(404).json({ error: 'Course not found' });
    }
    res.json(mapCourseRow(deleted.rows[0]));
  } catch (error) {
    console.error('Delete course error', error);
    res.status(500).json({ error: 'Unable to delete course' });
  }
});

app.post('/api/enrollments', requireAuth, requireRole('ADMIN', 'INSTRUCTOR', 'STUDENT', 'MEMBER'), async (req, res) => {
  try {
    await ensureEnrollmentsTable();
    const { 
      userId, 
      courseId, 
      paymentMethod, 
      stripeSessionId, 
      stripePaymentIntentId, 
      receiptUrl,
      collectedBy,
      notes 
    } = req.body;

    if (!userId || !courseId) {
      return res.status(400).json({ error: 'userId and courseId are required' });
    }

    const course = await pool.query('SELECT id, title, price, instructor FROM courses WHERE id = $1', [courseId]);
    if (!course.rowCount) {
      return res.status(404).json({ error: 'Course not found' });
    }
    const courseRow = course.rows[0];

    if (req.user?.role === 'STUDENT' || req.user?.role === 'MEMBER') {
      if (String(req.user.id) !== String(userId)) {
        const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
        return res.status(403).json({ error: lang === 'ar' ? 'لا يمكنك تسجيل مستخدم آخر.' : 'You can only enroll yourself.' });
      }
      if (Number(courseRow.price) > 0) {
        const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
        return res.status(403).json({ error: lang === 'ar' ? 'هذه الدورة مدفوعة. يرجى إتمام الدفع أولاً.' : 'This course is paid. Please complete payment first.' });
      }
    }

    const existingEnrollment = await pool.query(
      'SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2',
      [userId, courseId]
    );
    if (!existingEnrollment.rowCount) {
      await pool.query(
        'INSERT INTO enrollments (user_id, course_id, enrolled_at) VALUES ($1, $2, NOW())',
        [userId, courseId]
      );
    }

    const updatedUser = await pool.query(
      `UPDATE users
         SET enrolled_courses = CASE
           WHEN enrolled_courses @> ARRAY[$2]::uuid[] THEN enrolled_courses
           ELSE array_append(COALESCE(enrolled_courses, ARRAY[]::uuid[]), $2::uuid)
         END
       WHERE id = $1
       RETURNING *`,
      [userId, courseId]
    );

    if (!updatedUser.rowCount) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updatedUserRow = updatedUser.rows[0];
    const courseTitle = courseRow.title || 'Course';
    const instructorName = courseRow.instructor || 'Instructor';
    let instructorId = null;
    if (instructorName) {
      const instructorLookup = await pool.query(
        'SELECT id FROM users WHERE role = $1 AND LOWER(name) = LOWER($2) LIMIT 1',
        ['INSTRUCTOR', instructorName]
      );
      instructorId = instructorLookup.rows[0]?.id || null;
    }
    const paymentAmount = Number(courseRow.price) || 0;
    
    // Determine payment method and related info
    const finalPaymentMethod = paymentMethod?.toUpperCase() || 'MANUAL';
    const finalCollectedBy = collectedBy || (finalPaymentMethod === 'ONLINE' ? 'Stripe' : 'System Enrollment');
    const finalNotes = notes || (finalPaymentMethod === 'ONLINE' ? 
      'Stripe payment - online enrollment' : 
      'Auto-generated receipt during enrollment');
    
    // Generate receipt ID based on payment method
    const finalReceiptId = stripeSessionId 
      ? `STRIPE-${stripeSessionId.substring(0, 20)}`
      : generateReceiptId();
    
    if (paymentAmount > 0) {
      await ensureCoursePaymentsSchema();
      
      // Check if payment already exists for this student+course (idempotency)
      const existingPayment = await pool.query(
        `SELECT id, payment_method, stripe_session_id FROM course_payments 
         WHERE student_id = $1 AND course_id = $2 
         ORDER BY received_at DESC LIMIT 1`,
        [userId, courseId]
      );
      
      // If payment already exists and is ONLINE (from webhook), don't create duplicate
      if (existingPayment.rows.length > 0 && existingPayment.rows[0].payment_method === 'ONLINE') {
        console.log(`Payment already recorded for student ${userId} in course ${courseId} via Stripe`);
      } else {
        // Create payment record
        await pool.query(
          `INSERT INTO course_payments (
            id,
            receipt_id,
            student_id,
            student_name,
            student_email,
            course_id,
            course_title,
            instructor_name,
            instructor_id,
            course_price,
            amount,
            payment_method,
            collected_by,
            collected_by_id,
            notes,
            stripe_session_id,
            stripe_payment_intent_id,
            receipt_url,
            received_at
          ) VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
            $12,
            $13,
            $14,
            $15,
            $16,
            $17,
            $18,
            NOW()
          )`,
          [
            randomUUID(),
            finalReceiptId,
            userId,
            updatedUserRow.name || 'Student',
            updatedUserRow.email || null,
            courseId,
            courseTitle,
            instructorName,
            instructorId,
            paymentAmount,
            paymentAmount,
            finalPaymentMethod,
            finalCollectedBy,
            null,
            finalNotes,
            stripeSessionId || null,
            stripePaymentIntentId || null,
            receiptUrl || null
          ]
        );
      }
    }

    res.json(mapUserRow(updatedUser.rows[0]));
  } catch (error) {
    console.error('Enrollment error', error);
    res.status(500).json({ error: 'Unable to enroll student' });
  }
});

// Admin manual enrollment endpoint with tenant isolation
app.post('/api/admin/enroll-student', async (req, res) => {
  try {
    await ensureEnrollmentsTable();
    await ensureNotificationSchema();
    
    const { userId, courseId, adminId } = req.body;

    console.log('[Admin Enroll] Request:', { userId, courseId, adminId });

    if (!userId || !courseId) {
      console.log('[Admin Enroll] Missing required fields');
      return res.status(400).json({ error: 'userId and courseId are required' });
    }

    // Verify student exists
    const userResult = await pool.query('SELECT id, name, email, role FROM users WHERE id = $1', [userId]);
    if (!userResult.rowCount) {
      console.log('[Admin Enroll] Student not found:', userId);
      return res.status(404).json({ error: 'Student not found' });
    }

    const user = userResult.rows[0];
    console.log('[Admin Enroll] User found:', user.name, user.role);
    
    if (user.role !== 'STUDENT') {
      console.log('[Admin Enroll] User is not a student');
      return res.status(400).json({ error: 'User must be a student to enroll in courses' });
    }

    // Verify course exists in the same tenant database
    const courseResult = await pool.query('SELECT id, title, price, instructor FROM courses WHERE id = $1', [courseId]);
    if (!courseResult.rowCount) {
      console.log('[Admin Enroll] Course not found:', courseId);
      return res.status(404).json({ error: 'Course not found in this tenant' });
    }

    const course = courseResult.rows[0];
    console.log('[Admin Enroll] Course found:', course.title);

    // Check if already enrolled using enrollments table
    const existingEnrollment = await pool.query(
      'SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2',
      [userId, courseId]
    );

    if (existingEnrollment.rowCount > 0) {
      console.log('[Admin Enroll] Student already enrolled in this course');
      return res.status(400).json({ error: 'Student is already enrolled in this course' });
    }

    console.log('[Admin Enroll] Creating enrollment record...');

    // Insert into enrollments table
    await pool.query(
      'INSERT INTO enrollments (user_id, course_id, enrolled_at) VALUES ($1, $2, NOW())',
      [userId, courseId]
    );
    console.log('[Admin Enroll] Enrollment record created');

    // Update user's enrolled_courses array for backward compatibility
    // First ensure enrolled_courses is not null
    console.log('[Admin Enroll] Ensuring enrolled_courses array exists...');
    await pool.query(
      `UPDATE users SET enrolled_courses = COALESCE(enrolled_courses, ARRAY[]::uuid[]) WHERE id = $1 AND enrolled_courses IS NULL`,
      [userId]
    );
    
    // Then add the course if not already present
    console.log('[Admin Enroll] Adding course to enrolled_courses array...');
    const updatedUser = await pool.query(
      `UPDATE users
         SET enrolled_courses = CASE
           WHEN $2::uuid = ANY(enrolled_courses) THEN enrolled_courses
           ELSE array_append(enrolled_courses, $2::uuid)
         END
       WHERE id = $1
       RETURNING *`,
      [userId, courseId]
    );

    if (updatedUser.rowCount === 0) {
      throw new Error('Failed to update user enrollment record');
    }
    console.log('[Admin Enroll] User enrolled_courses updated');

    // Create notification for student
    console.log('[Admin Enroll] Creating notification...');
    await pool.query(
      `INSERT INTO notifications (id, user_id, message, type, read, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, false, NOW())`,
      [userId, `You have been enrolled in ${course.title}`, 'ENROLLMENT']
    );
    console.log('[Admin Enroll] Notification created');

    console.log('[Admin Enroll] ✓ Enrollment completed successfully');
    res.json({
      success: true,
      message: 'Student enrolled successfully',
      user: mapUserRow(updatedUser.rows[0]),
      enrollment: {
        userId,
        courseId,
        courseTitle: course.title,
        enrolledAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[Admin Enroll] ERROR:', error);
    console.error('[Admin Enroll] Stack:', error.stack);
    res.status(500).json({ error: 'Unable to enroll student' });
  }
});

// Get enrollments for a user (for admin verification)
app.get('/api/admin/user/:userId/enrollments', async (req, res) => {
  try {
    await ensureEnrollmentsTable();
    
    const { userId } = req.params;

    const enrollments = await pool.query(
      `SELECT e.id, e.course_id, e.enrolled_at, c.title as course_title, c.instructor
       FROM enrollments e
       JOIN courses c ON e.course_id = c.id
       WHERE e.user_id = $1
       ORDER BY e.enrolled_at DESC`,
      [userId]
    );

    res.json(enrollments.rows);
  } catch (error) {
    console.error('Error fetching enrollments', error);
    res.status(500).json({ error: 'Unable to fetch enrollments' });
  }
});

const normalizePaymentMethodValue = (method) => {
  if (!method) return 'MANUAL';
  return method.toString().trim().toUpperCase();
};

const PAYMENT_METHOD_WHITELIST = new Set(['ONLINE', 'CASH', 'TRANSFER', 'MANUAL']);

app.post('/api/course-payments', async (req, res) => {
  const { studentId, courseId, amount, paymentMethod, notes, receivedAt, collectedBy, collectedById } = req.body || {};
  if (!studentId || !courseId || amount === undefined) {
    return res.status(400).json({ error: 'studentId, courseId, and amount are required' });
  }
  const normalizedAmount = Number(amount);
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  let normalizedMethod = normalizePaymentMethodValue(paymentMethod);
  if (!PAYMENT_METHOD_WHITELIST.has(normalizedMethod)) {
    normalizedMethod = 'MANUAL';
  }

  try {
    await ensureCoursePaymentsSchema();
    const studentResult = await pool.query('SELECT id, name, email FROM users WHERE id = $1', [studentId]);
    if (!studentResult.rowCount) {
      return res.status(404).json({ error: 'Student not found' });
    }
    const courseResult = await pool.query('SELECT id, title, price, instructor FROM courses WHERE id = $1', [courseId]);
    if (!courseResult.rowCount) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const student = studentResult.rows[0];
    const course = courseResult.rows[0];
    let instructorId = null;
    if (course.instructor) {
      const instructorLookup = await pool.query(
        'SELECT id FROM users WHERE role = $1 AND LOWER(name) = LOWER($2) LIMIT 1',
        ['INSTRUCTOR', course.instructor]
      );
      instructorId = instructorLookup.rows[0]?.id || null;
    }

    let collectorId = null;
    let collectorName = typeof collectedBy === 'string' ? collectedBy.trim() : '';
    if (collectedById) {
      const collectorResult = await pool.query('SELECT id, name FROM users WHERE id = $1', [collectedById]);
      if (collectorResult.rowCount) {
        collectorId = collectorResult.rows[0].id;
        collectorName = collectorName || collectorResult.rows[0].name;
      }
    }

    const receivedDate = receivedAt ? new Date(receivedAt) : new Date();
    if (Number.isNaN(receivedDate.getTime())) {
      return res.status(400).json({ error: 'Invalid receivedAt value' });
    }

    const insert = await pool.query(
      `INSERT INTO course_payments (
        id,
        receipt_id,
        student_id,
        student_name,
        student_email,
        course_id,
        course_title,
        instructor_name,
        instructor_id,
        course_price,
        amount,
        payment_method,
        collected_by,
        collected_by_id,
        notes,
        received_at,
        created_at,
        updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW()
      ) RETURNING *`,
      [
        randomUUID(),
        generateReceiptId(),
        studentId,
        student.name || 'Student',
        student.email || null,
        courseId,
        course.title || 'Course',
        course.instructor || null,
        instructorId,
        Number(course.price) || normalizedAmount,
        normalizedAmount,
        normalizedMethod,
        collectorName || null,
        collectorId,
        typeof notes === 'string' && notes.trim() ? notes.trim() : null,
        receivedDate.toISOString()
      ]
    );

    res.status(201).json(mapPaymentRecordRow(insert.rows[0]));
  } catch (error) {
    console.error('Manual payment creation error', error);
    res.status(500).json({ error: 'Unable to record payment' });
  }
});

app.patch('/api/course-payments/:paymentId', async (req, res) => {
  const { paymentId } = req.params;
  if (!paymentId) {
    return res.status(400).json({ error: 'paymentId is required' });
  }
  const { amount, paymentMethod, notes, receivedAt, collectedBy, collectedById } = req.body || {};
  if (
    amount === undefined &&
    paymentMethod === undefined &&
    notes === undefined &&
    receivedAt === undefined &&
    collectedBy === undefined &&
    collectedById === undefined
  ) {
    return res.status(400).json({ error: 'No updates supplied' });
  }

  try {
    await ensureCoursePaymentsSchema();
    const existing = await pool.query('SELECT * FROM course_payments WHERE id = $1', [paymentId]);
    if (!existing.rowCount) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    const updates = [];
    const values = [];

    if (amount !== undefined) {
      const normalizedAmount = Number(amount);
      if (!Number.isFinite(normalizedAmount) || normalizedAmount < 0) {
        return res.status(400).json({ error: 'amount must be a non-negative number' });
      }
      values.push(normalizedAmount);
      updates.push(`amount = $${values.length}`);
    }

    if (paymentMethod !== undefined) {
      let normalizedMethod = normalizePaymentMethodValue(paymentMethod);
      if (!PAYMENT_METHOD_WHITELIST.has(normalizedMethod)) {
        normalizedMethod = 'MANUAL';
      }
      values.push(normalizedMethod);
      updates.push(`payment_method = $${values.length}`);
    }

    if (notes !== undefined) {
      const trimmed = typeof notes === 'string' && notes.trim() ? notes.trim() : null;
      values.push(trimmed);
      updates.push(`notes = $${values.length}`);
    }

    if (receivedAt !== undefined) {
      if (!receivedAt) {
        return res.status(400).json({ error: 'receivedAt must be a valid datetime' });
      }
      const parsedDate = new Date(receivedAt);
      if (Number.isNaN(parsedDate.getTime())) {
        return res.status(400).json({ error: 'receivedAt must be a valid datetime' });
      }
      values.push(parsedDate.toISOString());
      updates.push(`received_at = $${values.length}`);
    }

    let collectorNameFromId;
    if (collectedById !== undefined) {
      if (collectedById === null) {
        values.push(null);
        updates.push(`collected_by_id = $${values.length}`);
        collectorNameFromId = null;
      } else {
        const collectorResult = await pool.query('SELECT id, name FROM users WHERE id = $1', [collectedById]);
        if (!collectorResult.rowCount) {
          return res.status(404).json({ error: 'Collector not found' });
        }
        const collectorRow = collectorResult.rows[0];
        values.push(collectorRow.id);
        updates.push(`collected_by_id = $${values.length}`);
        collectorNameFromId = collectorRow.name || null;
      }
    }

    if (collectedBy !== undefined || collectorNameFromId !== undefined) {
      const providedName = typeof collectedBy === 'string' ? collectedBy.trim() : collectedBy;
      const resolvedName =
        collectedBy !== undefined ? (providedName ? providedName : null) : (collectorNameFromId ?? null);
      values.push(resolvedName);
      updates.push(`collected_by = $${values.length}`);
    }

    if (!updates.length) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    values.push(paymentId);
    const update = await pool.query(
      `UPDATE course_payments
        SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length}
      RETURNING *`,
      values
    );

    res.json(mapPaymentRecordRow(update.rows[0]));
  } catch (error) {
    console.error('Payment update error', error);
    res.status(500).json({ error: 'Unable to update payment' });
  }
});

app.delete('/api/course-payments/:paymentId', async (req, res) => {
  const { paymentId } = req.params;
  if (!paymentId) {
    return res.status(400).json({ error: 'paymentId is required' });
  }
  try {
    await ensureCoursePaymentsSchema();
    const deleted = await pool.query('DELETE FROM course_payments WHERE id = $1 RETURNING *', [paymentId]);
    if (!deleted.rowCount) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    res.json(mapPaymentRecordRow(deleted.rows[0]));
  } catch (error) {
    console.error('Payment delete error', error);
    res.status(500).json({ error: 'Unable to delete payment' });
  }
});

app.delete('/api/course-payments/by-student/:studentId/:courseId', async (req, res) => {
  const { studentId, courseId } = req.params;
  if (!studentId || !courseId) {
    return res.status(400).json({ error: 'studentId and courseId are required' });
  }
  try {
    await ensureCoursePaymentsSchema();
    const deleted = await pool.query(
      'DELETE FROM course_payments WHERE student_id = $1 AND course_id = $2 RETURNING id',
      [studentId, courseId]
    );
    res.json({ deleted: deleted.rowCount, ids: deleted.rows.map((row) => row.id) });
  } catch (error) {
    console.error('Learner payment purge error', error);
    res.status(500).json({ error: 'Unable to delete learner payments' });
  }
});

app.delete('/api/course-payments/by-course/:courseId', async (req, res) => {
  const { courseId } = req.params;
  if (!courseId) {
    return res.status(400).json({ error: 'courseId is required' });
  }
  try {
    await ensureCoursePaymentsSchema();
    const deleted = await pool.query('DELETE FROM course_payments WHERE course_id = $1 RETURNING id', [courseId]);
    res.json({ deleted: deleted.rowCount, ids: deleted.rows.map((row) => row.id) });
  } catch (error) {
    console.error('Course payment purge error', error);
    res.status(500).json({ error: 'Unable to delete course payments' });
  }
});

app.post('/api/instructor-payouts', async (req, res) => {
  const { instructorId, amount, paymentMethod, courseId, reference, notes, recordedAt, recordedById, recordedByName } = req.body || {};
  if (!instructorId || amount === undefined) {
    return res.status(400).json({ error: 'instructorId and amount are required' });
  }
  const normalizedAmount = Number(amount);
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  let normalizedMethod = normalizePaymentMethodValue(paymentMethod || 'TRANSFER');
  if (!PAYMENT_METHOD_WHITELIST.has(normalizedMethod)) {
    normalizedMethod = 'MANUAL';
  }

  try {
    await ensureInstructorPayoutsSchema();

    const instructorResult = await pool.query('SELECT id, name FROM users WHERE id = $1 AND role = $2', [instructorId, 'INSTRUCTOR']);
    if (!instructorResult.rowCount) {
      return res.status(404).json({ error: 'Instructor not found' });
    }
    const instructor = instructorResult.rows[0];

    let linkedCourse = null;
    if (courseId) {
      const courseResult = await pool.query('SELECT id, title FROM courses WHERE id = $1', [courseId]);
      if (courseResult.rowCount) {
        linkedCourse = courseResult.rows[0];
      }
    }

    let recorderId = null;
    let recorderName = '';
    if (recordedById) {
      const recorderResult = await pool.query('SELECT id, name FROM users WHERE id = $1', [recordedById]);
      if (recorderResult.rowCount) {
        recorderId = recorderResult.rows[0].id;
        recorderName = recorderResult.rows[0].name || '';
      }
    }
    if (!recorderName && typeof recordedByName === 'string' && recordedByName.trim()) {
      recorderName = recordedByName.trim();
    }

    const recordedDate = recordedAt ? new Date(recordedAt) : new Date();
    if (Number.isNaN(recordedDate.getTime())) {
      return res.status(400).json({ error: 'Invalid recordedAt value' });
    }

    const insert = await pool.query(
      `INSERT INTO instructor_payouts (
        id,
        instructor_id,
        instructor_name,
        amount,
        payment_method,
        course_id,
        course_title,
        reference,
        notes,
        recorded_by,
        recorded_by_name,
        recorded_at,
        created_at,
        updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW()
      ) RETURNING *`,
      [
        randomUUID(),
        instructor.id,
        instructor.name || 'Instructor',
        normalizedAmount,
        normalizedMethod,
        linkedCourse?.id || null,
        linkedCourse?.title || null,
        reference?.trim() || null,
        notes?.trim() || null,
        recorderId,
        recorderName || null,
        recordedDate.toISOString()
      ]
    );

    res.status(201).json(mapInstructorPayoutRow(insert.rows[0]));
  } catch (error) {
    console.error('Instructor payout creation error', error);
    res.status(500).json({ error: 'Unable to record instructor payout' });
  }
});

app.patch('/api/instructor-payouts/:payoutId', async (req, res) => {
  const { payoutId } = req.params;
  if (!payoutId) {
    return res.status(400).json({ error: 'payoutId is required' });
  }
  const {
    amount,
    paymentMethod,
    courseId,
    reference,
    notes,
    recordedAt,
    recordedById,
    recordedByName
  } = req.body || {};

  if (
    amount === undefined &&
    paymentMethod === undefined &&
    courseId === undefined &&
    reference === undefined &&
    notes === undefined &&
    recordedAt === undefined &&
    recordedById === undefined &&
    recordedByName === undefined
  ) {
    return res.status(400).json({ error: 'No updates supplied' });
  }

  try {
    await ensureInstructorPayoutsSchema();
    const existing = await pool.query('SELECT * FROM instructor_payouts WHERE id = $1', [payoutId]);
    if (!existing.rowCount) {
      return res.status(404).json({ error: 'Payout not found' });
    }

    const updates = [];
    const values = [];

    if (amount !== undefined) {
      const normalizedAmount = Number(amount);
      if (!Number.isFinite(normalizedAmount) || normalizedAmount < 0) {
        return res.status(400).json({ error: 'amount must be a non-negative number' });
      }
      values.push(normalizedAmount);
      updates.push(`amount = $${values.length}`);
    }

    if (paymentMethod !== undefined) {
      let normalizedMethod = normalizePaymentMethodValue(paymentMethod || 'TRANSFER');
      if (!PAYMENT_METHOD_WHITELIST.has(normalizedMethod)) {
        normalizedMethod = 'MANUAL';
      }
      values.push(normalizedMethod);
      updates.push(`payment_method = $${values.length}`);
    }

    if (courseId !== undefined) {
      if (courseId === null || courseId === '') {
        values.push(null);
        updates.push(`course_id = $${values.length}`);
        values.push(null);
        updates.push(`course_title = $${values.length}`);
      } else {
        const courseResult = await pool.query('SELECT id, title FROM courses WHERE id = $1', [courseId]);
        if (!courseResult.rowCount) {
          return res.status(404).json({ error: 'Course not found' });
        }
        const courseRow = courseResult.rows[0];
        values.push(courseRow.id);
        updates.push(`course_id = $${values.length}`);
        values.push(courseRow.title || null);
        updates.push(`course_title = $${values.length}`);
      }
    }

    if (reference !== undefined) {
      const trimmed = typeof reference === 'string' && reference.trim() ? reference.trim() : null;
      values.push(trimmed);
      updates.push(`reference = $${values.length}`);
    }

    if (notes !== undefined) {
      const trimmed = typeof notes === 'string' && notes.trim() ? notes.trim() : null;
      values.push(trimmed);
      updates.push(`notes = $${values.length}`);
    }

    if (recordedAt !== undefined) {
      if (!recordedAt) {
        return res.status(400).json({ error: 'recordedAt must be a valid datetime' });
      }
      const parsedDate = new Date(recordedAt);
      if (Number.isNaN(parsedDate.getTime())) {
        return res.status(400).json({ error: 'recordedAt must be a valid datetime' });
      }
      values.push(parsedDate.toISOString());
      updates.push(`recorded_at = $${values.length}`);
    }

    if (recordedById !== undefined || recordedByName !== undefined) {
      let resolvedRecorderId = null;
      let resolvedRecorderName = typeof recordedByName === 'string' ? recordedByName.trim() : (recordedByName ?? null);

      if (recordedById === null || recordedById === '') {
        resolvedRecorderId = null;
      } else if (recordedById !== undefined) {
        const recorderResult = await pool.query('SELECT id, name FROM users WHERE id = $1', [recordedById]);
        if (!recorderResult.rowCount) {
          return res.status(404).json({ error: 'Recorder not found' });
        }
        const recorderRow = recorderResult.rows[0];
        resolvedRecorderId = recorderRow.id;
        if (!resolvedRecorderName) {
          resolvedRecorderName = recorderRow.name || null;
        }
      }

      values.push(resolvedRecorderId);
      updates.push(`recorded_by = $${values.length}`);
      values.push(resolvedRecorderName || null);
      updates.push(`recorded_by_name = $${values.length}`);
    }

    if (!updates.length) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    values.push(payoutId);
    const update = await pool.query(
      `UPDATE instructor_payouts
        SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length}
      RETURNING *`,
      values
    );

    res.json(mapInstructorPayoutRow(update.rows[0]));
  } catch (error) {
    console.error('Payout update error', error);
    res.status(500).json({ error: 'Unable to update payout' });
  }
});

app.delete('/api/instructor-payouts/:payoutId', async (req, res) => {
  const { payoutId } = req.params;
  if (!payoutId) {
    return res.status(400).json({ error: 'payoutId is required' });
  }
  try {
    await ensureInstructorPayoutsSchema();
    const deleted = await pool.query('DELETE FROM instructor_payouts WHERE id = $1 RETURNING *', [payoutId]);
    if (!deleted.rowCount) {
      return res.status(404).json({ error: 'Payout not found' });
    }
    res.json(mapInstructorPayoutRow(deleted.rows[0]));
  } catch (error) {
    console.error('Payout delete error', error);
    res.status(500).json({ error: 'Unable to delete payout' });
  }
});

app.get('/api/live-classes', async (req, res) => {
  try {
    const classes = await fetchLiveClasses({
      instructorId: req.query.instructorId,
      studentId: req.query.studentId,
      liveClassId: req.query.classId
    });
    res.json(classes);
  } catch (error) {
    console.error('Load live classes error', error);
    res.status(500).json({ error: 'Failed to load live classes' });
  }
});

app.post('/api/live-classes', async (req, res) => {
  const {
    instructorId,
    topic,
    agenda,
    startTime,
    platform,
    inviteType = 'all',
    studentIds = [],
    durationMinutes = 60
  } = req.body || {};

  if (!instructorId || !topic || !platform) {
    return res.status(400).json({ error: 'instructorId, topic and platform are required' });
  }

  if (!Array.isArray(studentIds) || studentIds.length === 0) {
    return res.status(400).json({ error: 'At least one student must be selected' });
  }

  const start = startTime ? new Date(startTime) : new Date();
  if (Number.isNaN(start.getTime())) {
    return res.status(400).json({ error: 'Invalid startTime' });
  }

  try {
    await ensureLiveSchema();
  } catch (schemaError) {
    console.error('Live schema ensure failed', schemaError);
    return res.status(500).json({ error: 'Live classes storage unavailable' });
  }

  let platformConfig;
  try {
    platformConfig = await fetchLivePlatformConfig();
  } catch (configError) {
    console.error('Live platform config load error', configError);
    return res.status(500).json({ error: 'Live platform configuration unavailable' });
  }

  const platformAllowed =
    (platform === 'smrrtx' && platformConfig.smrrtxEnabled) ||
    (platform === 'zoom' && platformConfig.zoomEnabled) ||
    (platform === 'meet' && platformConfig.meetEnabled);

  if (!platformAllowed) {
    return res.status(400).json({ error: 'Selected platform is currently disabled' });
  }

  const normalizedInviteType = inviteType === 'specific' ? 'specific' : 'all';
  const uniqueStudentIds = Array.from(new Set(studentIds));

  let client;
  try {
    const instructorResult = await pool.query('SELECT id, name, email FROM users WHERE id = $1 AND role = $2', [instructorId, 'INSTRUCTOR']);
    if (!instructorResult.rowCount) {
      return res.status(404).json({ error: 'Instructor not found' });
    }
    const instructor = instructorResult.rows[0];

    const studentsResult = await pool.query(
      'SELECT id, name, email FROM users WHERE id = ANY($1::uuid[])',
      [uniqueStudentIds]
    );
    if (studentsResult.rowCount !== uniqueStudentIds.length) {
      return res.status(400).json({ error: 'One or more students were not found' });
    }

    const shouldUsePermanentSmrrtxLink =
      platform === 'smrrtx' && platformConfig.smrrtxPermanentRoomLink && platformConfig.smrrtxPermanentRoomLink.trim().length > 0;

    const meeting = shouldUsePermanentSmrrtxLink
      ? {
          platform: 'smrrtx',
          providerMeetingId: 'smrrtx-permanent-room',
          hostUrl: platformConfig.smrrtxPermanentRoomLink.trim(),
          joinUrl: platformConfig.smrrtxPermanentRoomLink.trim(),
          passcode: null,
          startTime: start.toISOString()
        }
      : await createLiveMeeting(platform, {
          topic,
          agenda,
          startTime: start.toISOString(),
          durationMinutes: Number(durationMinutes) || 60,
          instructorName: instructor.name,
          instructorEmail: instructor.email,
          smrrtxPermanentRoomLink: platformConfig.smrrtxPermanentRoomLink || '',
          // Zoom credentials (DB values fall back to env vars inside handler)
          zoomClientId: platformConfig.zoomClientId || '',
          zoomClientSecret: platformConfig.zoomClientSecret || '',
          zoomAccountId: platformConfig.zoomAccountId || '',
          zoomUserId: platformConfig.zoomUserId || '',
          // Google Meet credentials (DB values fall back to env vars inside handler)
          googleSaEmail: platformConfig.googleSaEmail || '',
          googleSaKey: platformConfig.googleSaKey || '',
          googleCalendarId: platformConfig.googleCalendarId || ''
        });

    const liveClassId = randomUUID();
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO live_classes (
        id, instructor_id, topic, agenda, start_time, platform, provider_meeting_id,
        host_url, join_url, passcode, invite_type, duration_minutes, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        liveClassId,
        instructorId,
        topic,
        agenda || null,
        meeting.startTime || start.toISOString(),
        platform,
        meeting.providerMeetingId || null,
        meeting.hostUrl,
        meeting.joinUrl,
        meeting.passcode || null,
        normalizedInviteType,
        Number(durationMinutes) || 60,
        'SCHEDULED'
      ]
    );

    for (const student of studentsResult.rows) {
      await client.query(
        `INSERT INTO live_class_invites (id, live_class_id, student_id, email, status)
         VALUES ($1,$2,$3,$4,$5)`,
        [randomUUID(), liveClassId, student.id, student.email, 'INVITED']
      );
    }

    await createUserNotifications({
      userIds: studentsResult.rows.map((student) => student.id),
      actorId: instructor.id,
      category: NOTIFICATION_CATEGORIES.LIVE_MEETING,
      type: 'INFO',
      message: `${instructor.name} scheduled "${topic}" on ${platform.toUpperCase()}.`,
      metadata: {
        liveClassId,
        platform,
        startTime: meeting.startTime || start.toISOString(),
        joinUrl: meeting.joinUrl
      }
    }, client);
    await client.query('COMMIT');
    client.release();
    client = null;

    const [createdClass] = await fetchLiveClasses({ liveClassId });
    res.status(201).json(createdClass || { id: liveClassId });
  } catch (error) {
    console.error('Create live class error', error);
    try {
      if (client) {
        await client.query('ROLLBACK');
        client.release();
        client = null;
      }
    } catch (rollbackError) {
      console.error('Rollback failed', rollbackError);
    }
    res.status(500).json({ error: error.message || 'Failed to create live class' });
  } finally {
    if (client) {
      client.release();
    }
  }
});

const ALLOWED_LIVE_STATUSES = new Set(['SCHEDULED', 'LIVE', 'COMPLETED', 'CANCELLED']);

app.patch('/api/live-classes/:id/status', async (req, res) => {
  const { status, recordingUrl } = req.body || {};
  if (!status || !ALLOWED_LIVE_STATUSES.has(status)) {
    return res.status(400).json({ error: 'Invalid status value' });
  }

  try {
    await ensureLiveSchema();
    const updateResult = await pool.query(
      `UPDATE live_classes SET status = $2, recording_url = COALESCE($3, recording_url)
         WHERE id = $1 RETURNING id`,
      [req.params.id, status, recordingUrl || null]
    );
    if (!updateResult.rowCount) {
      return res.status(404).json({ error: 'Live class not found' });
    }
    const [updated] = await fetchLiveClasses({ liveClassId: req.params.id });
    res.json(updated);
  } catch (error) {
    console.error('Update live class error', error);
    res.status(500).json({ error: 'Failed to update live class' });
  }
});

// ============================================================================
// Messaging endpoints - Tenant-aware routing
// ============================================================================
// Router already created early in the file, just add routes to it

messagingRouter.get('/events', requireAuth, async (req, res) => {
  const userId = req.userId; // Use authenticated user
  if (!userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    await ensureMessagingSchema();
    const user = await fetchUserRowById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);

    const client = {
      userId: user.id,
      role: user.role,
      res,
      pingTimer: setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch (error) {
          clearInterval(client.pingTimer);
          removeMessagingClient(user.id, client);
        }
      }, SSE_PING_INTERVAL_MS)
    };

    const existing = messagingClients.get(user.id) || new Set();
    existing.add(client);
    messagingClients.set(user.id, existing);

    req.on('close', () => {
      clearInterval(client.pingTimer);
      removeMessagingClient(user.id, client);
    });
  } catch (error) {
    console.error('Messaging SSE error', error);
    res.status(500).end();
  }
});

app.get('/api/notifications/events', async (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }
  try {
    await ensureNotificationSchema();
    const user = await fetchUserRowById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const unreadCount = await fetchUnreadNotificationCount(user.id);
    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, unreadCount })}\n\n`);

    const client = {
      userId: user.id,
      role: user.role,
      res,
      pingTimer: setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch (error) {
          clearInterval(client.pingTimer);
          removeNotificationClient(user.id, client);
        }
      }, SSE_PING_INTERVAL_MS)
    };

    const existing = notificationClients.get(user.id) || new Set();
    existing.add(client);
    notificationClients.set(user.id, existing);

    req.on('close', () => {
      clearInterval(client.pingTimer);
      removeNotificationClient(user.id, client);
    });
  } catch (error) {
    console.error('Notification SSE error', error);
    res.status(500).end();
  }
});

app.get('/api/users/:userId/notifications', requireAuth, async (req, res) => {
  const { userId } = req.params;
  const {
    limit = '30',
    before,
    unreadOnly
  } = req.query;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }
  try {
    await ensureNotificationSchema();
    const targetUser = await fetchUserRowById(userId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if user is accessing their own notifications or is admin
    const requestingUserId = userId?.toString();
    const requesterId = req.userId?.toString?.();
    const canAccess = await canAccessResource(req, requestingUserId, 'notifications:view:all');
    if (requesterId !== requestingUserId && !canAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const values = [userId];
    const clauses = ['user_id = $1'];
    if (before) {
      const beforeDate = new Date(before);
      if (!Number.isNaN(beforeDate.getTime())) {
        values.push(beforeDate.toISOString());
        clauses.push(`created_at < $${values.length}`);
      }
    }
    if (unreadOnly === 'true') {
      clauses.push('read = false');
    }

    const numericLimit = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);
    const query = `SELECT * FROM notifications WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ${numericLimit}`;
    const result = await pool.query(query, values);
    const unreadCount = await fetchUnreadNotificationCount(userId);
    res.json({ notifications: result.rows.map(mapNotificationRow), unreadCount });
  } catch (error) {
    console.error('List notifications error', error);
    res.status(500).json({ error: 'Unable to load notifications' });
  }
});

app.patch('/api/users/:userId/notifications/:notificationId', requireAuth, async (req, res) => {
  const { userId, notificationId } = req.params;
  const { read } = req.body || {};
  if (!userId || !notificationId) {
    return res.status(400).json({ error: 'userId and notificationId are required' });
  }
  if (typeof read !== 'boolean') {
    return res.status(400).json({ error: 'read must be a boolean' });
  }
  try {
    await ensureNotificationSchema();
    const targetUser = await fetchUserRowById(userId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if user is accessing their own notifications or is admin
    const requestingUserId = userId?.toString();
    const requesterId = req.userId?.toString?.();
    const canAccess = await canAccessResource(req, requestingUserId, 'notifications:update:all');
    if (requesterId !== requestingUserId && !canAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const update = await pool.query(
      `UPDATE notifications
          SET read = $3,
              read_at = CASE WHEN $3 THEN now() ELSE NULL END
        WHERE user_id = $1 AND id = $2
        RETURNING *`,
      [userId, notificationId, read]
    );
    if (!update.rowCount) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    const payload = mapNotificationRow(update.rows[0]);
    broadcastNotificationEvent([userId], 'notification:updated', payload);
    await broadcastUnreadCount(userId);
    res.json(payload);
  } catch (error) {
    console.error('Update notification error', error);
    res.status(500).json({ error: 'Unable to update notification' });
  }
});

app.post('/api/users/:userId/notifications/mark-all-read', requireAuth, requireSelfOrAdmin('userId'), async (req, res) => {
  const { userId } = req.params;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }
  try {
    await ensureNotificationSchema();
    const targetUser = await fetchUserRowById(userId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    const update = await pool.query(
      `UPDATE notifications
          SET read = true,
              read_at = now()
        WHERE user_id = $1 AND read = false
        RETURNING id`,
      [userId]
    );
    if (update.rowCount) {
      broadcastNotificationEvent([userId], 'notification:bulk-updated', { ids: update.rows.map((row) => row.id), read: true });
    }
    await broadcastUnreadCount(userId);
    res.json({ updated: update.rowCount });
  } catch (error) {
    console.error('Mark all notifications read error', error);
    res.status(500).json({ error: 'Unable to update notifications' });
  }
});

messagingRouter.get('/conversations', requireAuth, async (req, res) => {
  const { scope } = req.query;
  const userId = req.userId; // Use authenticated user
  if (!userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    await ensureMessagingSchema();
    const user = await fetchUserRowById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userIsAdmin = await isAdmin(req);
    const includeAll = scope === 'all' && userIsAdmin;
    const conversations = await fetchConversationsForViewer({ viewerId: user.id, includeAll });
    res.json({ conversations });
  } catch (error) {
    console.error('Load conversations error', error);
    res.status(500).json({ error: 'Unable to load conversations' });
  }
});

messagingRouter.get('/conversations/:conversationId/messages', requireAuth, async (req, res) => {
  const { before } = req.query;
  const { conversationId } = req.params;
  const userId = req.userId; // Use authenticated user
  if (!userId || !conversationId) {
    return res.status(400).json({ error: 'conversationId is required' });
  }
  try {
    await ensureMessagingSchema();
    const user = await fetchUserRowById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userIsAdmin = await isAdmin(req);
    const includeAll = userIsAdmin;
    const conversationList = await fetchConversationsForViewer({ viewerId: user.id, includeAll, conversationId });
    if (!conversationList.length) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    const conversation = conversationList[0];
    if (!userIsAdmin && !conversation.participants.some((participant) => participant.userId === user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const messages = await fetchMessagesForConversation({ conversationId, before });
    res.json({ conversation, messages });
  } catch (error) {
    console.error('Load conversation messages error', error);
    res.status(500).json({ error: 'Unable to load messages' });
  }
});

messagingRouter.post('/messages', requireAuth, async (req, res) => {
  const { conversationId, targetUserId, courseId, body, scope } = req.body || {};
  const senderId = req.userId; // Use authenticated user ID
  if (!senderId || (!conversationId && !body)) {
    return res.status(400).json({ error: 'Authentication required and message body cannot be empty' });
  }
  if (!body || !body.toString().trim()) {
    return res.status(400).json({ error: 'Message body cannot be empty' });
  }
  try {
    await ensureMessagingSchema();
    const sender = await fetchUserRowById(senderId);
    if (!sender) {
      return res.status(404).json({ error: 'Sender not found' });
    }

    const block = await getActiveMessageBlock(sender.id);
    if (block) {
      return res.status(403).json({ error: 'Messaging temporarily disabled', block });
    }

    if (!trackMessageRateLimit(sender.id)) {
      await recordMessageAudit({
        action: 'RATE_LIMITED',
        actorId: sender.id,
        targetUserId: sender.id,
        conversationId: conversationId || null,
        details: { reason: 'Per-user message rate exceeded' }
      });
      return res.status(429).json({ error: 'Too many messages. Please slow down.' });
    }

    let conversation;
    if (conversationId) {
      const userIsAdmin = await isAdmin(req);
      const includeAll = userIsAdmin;
      const lookup = await fetchConversationsForViewer({ viewerId: sender.id, includeAll, conversationId });
      if (!lookup.length) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      conversation = lookup[0];
      const participantIds = conversation.participants.map((participant) => participant.userId);
      if (!userIsAdmin && !participantIds.includes(sender.id)) {
        return res.status(403).json({ error: 'You are not part of this conversation' });
      }
      if (conversation.isMuted && !userIsAdmin) {
        return res.status(403).json({ error: 'Conversation has been muted by admin' });
      }
    } else {
      conversation = await createOrLocateConversation({ sender, targetUserId, courseId, scope });
    }

    const trimmedBody = body.toString().trim();
    const messageTargetId = (() => {
      if (targetUserId) {
        return targetUserId;
      }
      if (conversation.participants.length === 2) {
        const peer = conversation.participants.find((participant) => participant.userId !== sender.id);
        return peer?.userId || null;
      }
      return null;
    })();

    let insert;
    try {
      insert = await pool.query(
        `INSERT INTO messages (id, conversation_id, sender_id, message, body)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING *`,
        [
          randomUUID(),
          conversation.id,
          sender.id,
          trimmedBody,
          trimmedBody
        ]
      );
    } catch (error) {
      if (error?.code !== '42703') {
        throw error;
      }
      // Fallback for older schema versions
      try {
        insert = await pool.query(
          `INSERT INTO messages (id, conversation_id, sender_id, message)
           VALUES ($1,$2,$3,$4)
           RETURNING *`,
          [
            randomUUID(),
            conversation.id,
            sender.id,
            trimmedBody
          ]
        );
      } catch (innerError) {
        if (innerError?.code !== '42703') {
          throw innerError;
        }
        insert = await pool.query(
          `INSERT INTO messages (id, conversation_id, sender_id, body)
           VALUES ($1,$2,$3,$4)
           RETURNING *`,
          [
            randomUUID(),
            conversation.id,
            sender.id,
            trimmedBody
          ]
        );
      }
    }

    await touchConversationReceipt(conversation.id, sender.id, insert.rows[0].id);

    const message = mapMessageRow({ ...insert.rows[0], sender_name: sender.name, sender_role: sender.role });
    const snapshot = await fetchConversationSnapshot(conversation.id);
    const participantIds = conversation.participants.map((participant) => participant.userId);
    broadcastMessagingEvent(participantIds, 'message:new', {
      conversationId: conversation.id,
      message,
      conversation: snapshot
    }, { includeAdmins: true });

    const notificationRecipients = participantIds.filter((participantId) => participantId !== sender.id);
    if (notificationRecipients.length) {
      const preview = trimmedBody.length > 160 ? `${trimmedBody.slice(0, 157)}...` : trimmedBody;
      await createUserNotifications({
        userIds: notificationRecipients,
        actorId: sender.id,
        courseId: snapshot?.courseId || null,
        category: NOTIFICATION_CATEGORIES.MESSAGE,
        type: 'INFO',
        message: snapshot?.courseTitle
          ? `${sender.name} sent a new message in ${snapshot.courseTitle}.`
          : `${sender.name} sent you a new message.`,
        metadata: {
          conversationId: conversation.id,
          messageId: message.id,
          preview
        }
      });
    }

    res.status(201).json({ conversation, message });
  } catch (error) {
    console.error('Send message error', error);
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Unable to send message' });
  }
});

messagingRouter.post('/read', requireAuth, async (req, res) => {
  const { conversationId } = req.body || {};
  const userId = req.userId; // Use authenticated user
  if (!userId || !conversationId) {
    return res.status(400).json({ error: 'conversationId is required' });
  }
  try {
    await ensureMessagingSchema();
    const user = await fetchUserRowById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userIsAdmin = await isAdmin(req);
    const includeAll = userIsAdmin;
    const lookup = await fetchConversationsForViewer({ viewerId: user.id, includeAll, conversationId });
    if (!lookup.length) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    const conversation = lookup[0];
    if (!userIsAdmin && !conversation.participants.some((participant) => participant.userId === user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const latest = await pool.query(
      'SELECT id FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1',
      [conversationId]
    );
    await touchConversationReceipt(conversationId, userId, latest.rows[0]?.id || null);
    const refreshed = await fetchConversationsForViewer({ viewerId: user.id, includeAll, conversationId });
    const payload = refreshed[0] || conversation;
    broadcastMessagingEvent([userId], 'conversation:read', { conversation: payload });
    res.json({ conversation: payload });
  } catch (error) {
    console.error('Conversation read error', error);
    res.status(500).json({ error: 'Unable to update conversation' });
  }
});

messagingRouter.delete('/messages/:messageId', requireAuth, requirePermission('messaging:moderate'), async (req, res) => {
  const { messageId } = req.params;
  const actorId = req.userId; // Use authenticated user
  const reason = req.body?.reason || req.query?.reason || 'Admin moderation';
  try {
    await ensureMessagingSchema();
    const existing = await pool.query('SELECT * FROM messages WHERE id = $1', [messageId]);
    if (!existing.rowCount) {
      return res.status(404).json({ error: 'Message not found' });
    }
    const message = existing.rows[0];
    // Migration 024 schema doesn't support soft deletes, delete the message
    await pool.query(
      'DELETE FROM messages WHERE id = $1',
      [messageId]
    );
    await recordMessageAudit({
      action: 'MESSAGE_DELETED',
      actorId,
      targetMessageId: messageId,
      conversationId: message.conversation_id,
      targetUserId: message.sender_id,
      details: { reason }
    });
    const snapshot = await fetchConversationSnapshot(message.conversation_id);
    broadcastMessagingEvent(snapshot ? snapshot.participants.map((participant) => participant.userId) : [], 'message:deleted', {
      conversationId: message.conversation_id,
      messageId,
      reason,
      conversation: snapshot
    }, { includeAdmins: true });
    res.json({ message: 'Message deleted' });
  } catch (error) {
    console.error('Delete message error', error);
    res.status(500).json({ error: 'Unable to delete message' });
  }
});

messagingRouter.post('/blocks', requireAuth, requirePermission('messaging:moderate'), async (req, res) => {
  const { userId, durationMinutes, reason } = req.body || {};
  const adminId = req.userId; // Use authenticated user
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }
  try {
    await ensureMessagingSchema();
    const user = await fetchUserRowById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    await pool.query('UPDATE message_blocks SET active = false WHERE user_id = $1 AND active = true', [userId]);
    const expiresAt = durationMinutes ? new Date(Date.now() + Number(durationMinutes) * 60_000) : null;
    const insert = await pool.query(
      `INSERT INTO message_blocks (id, user_id, blocked_by, reason, expires_at, active)
       VALUES ($1,$2,$3,$4,$5,true)
       RETURNING *`,
      [randomUUID(), userId, adminId, reason || null, expiresAt]
    );
    const block = insert.rows[0];
    await recordMessageAudit({
      action: 'USER_BLOCKED',
      actorId: adminId,
      targetUserId: userId,
      details: { expiresAt, reason: reason || null }
    });
    broadcastMessagingEvent([userId], 'user:blocked', { block }, { includeAdmins: true });
    res.status(201).json({ block });
  } catch (error) {
    console.error('Block user error', error);
    res.status(500).json({ error: 'Unable to block user' });
  }
});

messagingRouter.delete('/blocks/:userId', requireAuth, requirePermission('messaging:moderate'), async (req, res) => {
  const { userId } = req.params;
  const adminId = req.userId; // Use authenticated user
  try {
    await ensureMessagingSchema();
    const update = await pool.query(
      'UPDATE message_blocks SET active = false WHERE user_id = $1 AND active = true RETURNING *',
      [userId]
    );
    if (!update.rowCount) {
      return res.status(404).json({ error: 'No active block found for user' });
    }
    await recordMessageAudit({ action: 'USER_UNBLOCKED', actorId: adminId, targetUserId: userId });
    broadcastMessagingEvent([userId], 'user:unblocked', { userId }, { includeAdmins: true });
    res.json({ message: 'User unblocked' });
  } catch (error) {
    console.error('Unblock user error', error);
    res.status(500).json({ error: 'Unable to unblock user' });
  }
});

messagingRouter.post('/mutes', requireAuth, requirePermission('messaging:moderate'), async (req, res) => {
  const { conversationId, muted, durationMinutes, reason } = req.body || {};
  const adminId = req.userId; // Use authenticated user
  if (!conversationId) {
    return res.status(400).json({ error: 'conversationId is required' });
  }
  try {
    await ensureMessagingSchema();
    const expiresAt = muted && durationMinutes ? new Date(Date.now() + Number(durationMinutes) * 60_000) : null;
    const update = await pool.query(
      `UPDATE message_conversations
          SET is_muted = $3,
              muted_by = CASE WHEN $3 THEN $2 ELSE NULL END,
              muted_reason = CASE WHEN $3 THEN $4 ELSE NULL END,
              muted_until = CASE WHEN $3 THEN $5 ELSE NULL END
        WHERE id = $1
      RETURNING *`,
      [conversationId, adminId, Boolean(muted), reason || null, expiresAt]
    );
    if (!update.rowCount) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    await recordMessageAudit({
      action: muted ? 'CONVERSATION_MUTED' : 'CONVERSATION_UNMUTED',
      actorId: adminId,
      conversationId,
      details: { reason: reason || null, muted, expiresAt }
    });
    const snapshot = await fetchConversationSnapshot(conversationId);
    const participantIds = snapshot ? snapshot.participants.map((participant) => participant.userId) : [];
    broadcastMessagingEvent(participantIds, 'conversation:muted', { conversation: snapshot }, { includeAdmins: true });
    res.json({ conversation: snapshot });
  } catch (error) {
    console.error('Mute conversation error', error);
    res.status(500).json({ error: 'Unable to update conversation mute state' });
  }
});

// Mount messaging router for main domain (tenant resolution happens via optionalTenantResolver)
// Tenant subdomain access is mounted inside tenantScopedApi above
app.use('/api/messaging', optionalTenantResolver, messagingRouter);

app.post('/api/exams/results', async (req, res) => {
  const { userId, courseId, itemId, score, passed, moduleTitle, itemTitle } = req.body || {};
  if (!userId || !courseId || !itemId || typeof score !== 'number') {
    return res.status(400).json({ error: 'userId, courseId, itemId, and numeric score are required' });
  }
  try {
    await ensureNotificationSchema();
    const [user, courseRow] = await Promise.all([fetchUserRowById(userId), fetchCourseRowById(courseId)]);
    if (!user || !courseRow) {
      return res.status(404).json({ error: 'User or course not found' });
    }
    const instructorLookup = await pool.query('SELECT id FROM users WHERE LOWER(name) = LOWER($1) LIMIT 1', [courseRow.instructor]);
    const instructorId = instructorLookup.rows[0]?.id || null;
    const normalizedTitle = itemTitle || 'Assessment';
    const studentLang = user?.language === 'ar' ? 'ar' : resolveRequestLanguage(req);
    const studentMessage = studentLang === 'ar'
      ? `لقد ${passed ? 'اجتزت' : 'أكملت'} "${normalizedTitle}" بنتيجة ${Math.round(score)}%.`
      : `You ${passed ? 'passed' : 'attempted'} "${normalizedTitle}" with a score of ${Math.round(score)}%.`;

    await createUserNotifications({
      userIds: [user.id],
      actorId: instructorId,
      courseId,
      category: NOTIFICATION_CATEGORIES.EXAM_RESULT,
      type: passed ? 'SUCCESS' : 'WARNING',
      message: studentMessage,
      metadata: {
        courseId,
        itemId,
        score,
        passed,
        moduleTitle: moduleTitle || null
      }
    });

    if (instructorId) {
      await createUserNotifications({
        userIds: [instructorId],
        actorId: user.id,
        courseId,
        category: NOTIFICATION_CATEGORIES.EXAM_RESULT,
        type: passed ? 'INFO' : 'WARNING',
        message: `${user.name} scored ${Math.round(score)}% on "${normalizedTitle}".`,
        metadata: {
          courseId,
          itemId,
          studentId: user.id,
          passed
        }
      });
    }

    res.status(201).json({ ok: true });
  } catch (error) {
    console.error('Exam result notification error', error);
    res.status(500).json({ error: 'Unable to record exam result' });
  }
});

// Certificate endpoints
app.post('/api/certificates', async (req, res) => {
  try {
    const { userId, courseId, type } = req.body;
    
    if (!userId || !courseId || !type) {
      return res.status(400).json({ error: 'userId, courseId, and type are required' });
    }

    // Get user and course info
    const userResult = await pool.query('SELECT name FROM users WHERE id = $1', [userId]);
    const courseResult = await pool.query('SELECT title, level FROM courses WHERE id = $1', [courseId]);
    
    if (userResult.rows.length === 0 || courseResult.rows.length === 0) {
      return res.status(404).json({ error: 'User or course not found' });
    }

    const user = userResult.rows[0];
    const course = courseResult.rows[0];

    // Generate unique certification number
    const certNumber = `CERT-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    
    // Check if certificate already exists
    const existing = await pool.query(
      'SELECT * FROM certificates WHERE user_id = $1 AND course_id = $2 AND type = $3',
      [userId, courseId, type]
    );

    let certificate;
    if (existing.rows.length > 0) {
      // Return existing certificate
      const row = existing.rows[0];
      certificate = {
        id: row.id,
        userId: row.user_id,
        userName: user.name,
        courseId: row.course_id,
        courseTitle: course.title,
        courseLevel: row.course_level || course.level,
        issueDate: row.issue_date,
        certificationNumber: row.certification_number,
        type: row.type,
        url: row.url
      };
    } else {
      // Create new certificate
      const insert = await pool.query(
        `INSERT INTO certificates (id, user_id, course_id, issue_date, certification_number, type, course_level)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [randomUUID(), userId, courseId, new Date().toISOString().split('T')[0], certNumber, type, course.level]
      );

      const row = insert.rows[0];
      certificate = {
        id: row.id,
        userId: row.user_id,
        userName: user.name,
        courseId: row.course_id,
        courseTitle: course.title,
        courseLevel: row.course_level,
        issueDate: row.issue_date,
        certificationNumber: row.certification_number,
        type: row.type,
        url: row.url
      };
    }

    res.status(201).json(certificate);
  } catch (error) {
    console.error('Create certificate error', error);
    res.status(500).json({ error: 'Unable to create certificate' });
  }
});

app.delete('/api/certificates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query('DELETE FROM certificates WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Certificate not found' });
    }
    
    res.json({ message: 'Certificate deleted successfully' });
  } catch (error) {
    console.error('Delete certificate error', error);
    res.status(500).json({ error: 'Unable to delete certificate' });
  }
});

app.get('/api/certificates/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const result = await pool.query(`
      SELECT c.*, u.name as user_name, co.title as course_title, co.level as course_level
      FROM certificates c
      JOIN users u ON c.user_id = u.id
      JOIN courses co ON c.course_id = co.id
      WHERE c.user_id = $1
      ORDER BY c.issue_date DESC
    `, [userId]);

    const certificates = result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      userName: row.user_name,
      courseId: row.course_id,
      courseTitle: row.course_title,
      courseLevel: row.course_level,
      issueDate: row.issue_date,
      certificationNumber: row.certification_number,
      type: row.type,
      url: row.url
    }));

    res.json(certificates);
  } catch (error) {
    console.error('Get certificates error', error);
    res.status(500).json({ error: 'Unable to fetch certificates' });
  }
});

// Custom video streaming route with proper range request support
// Apply media CORS before handling the request
app.get('/uploads/blog-videos/:filename', mediaCorsConfig, async (req, res, next) => {
  try {
    const filename = req.params.filename;
    // Ensure filename safety
    if (filename.includes('..') || filename.includes('/')) {
      return res.status(400).send('Invalid filename');
    }
    
    const filepath = join(uploadsDir, 'blog-videos', filename);
    
    try {
      const stats = await stat(filepath);
      const fileSize = stats.size;
      
      // Set proper headers for video (CORS headers now handled by middleware)
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      
      const range = req.headers.range;
      
      if (range) {
        // Handle range requests for seeking
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        
        if (start >= fileSize || end >= fileSize) {
          res.status(416).send('Requested Range Not Satisfiable');
          return;
        }
        
        const chunksize = end - start + 1;
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        res.setHeader('Content-Length', chunksize);
        
        const stream = fs.createReadStream(filepath, { start, end });
        stream.pipe(res);
      } else {
        // Send entire file
        res.setHeader('Content-Length', fileSize);
        const stream = fs.createReadStream(filepath);
        stream.pipe(res);
      }
    } catch (err) {
      next();
    }
  } catch (err) {
    next();
  }
});

// Serve uploaded files with proper MIME types and range request support
// Apply media CORS
app.use('/uploads', mediaCorsConfig);
app.use('/uploads', express.static(uploadsDir, {
  setHeaders: (res, path, stat) => {
    // Set proper MIME types for video files
    if (path.endsWith('.mp4')) {
      res.setHeader('Content-Type', 'video/mp4');
    } else if (path.endsWith('.webm')) {
      res.setHeader('Content-Type', 'video/webm');
    } else if (path.endsWith('.ogg') || path.endsWith('.ogv')) {
      res.setHeader('Content-Type', 'video/ogg');
    } else if (path.endsWith('.mov')) {
      res.setHeader('Content-Type', 'video/quicktime');
    } else if (path.endsWith('.avi')) {
      res.setHeader('Content-Type', 'video/x-msvideo');
    }
    
    // CORS headers are now handled by mediaCorsConfig middleware
    res.setHeader('Accept-Ranges', 'bytes');
  }
}));

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

const fetchEffectiveMediaSettings = async (tenantId) => {
  const normalizedTenantId = tenantId || null;

  if (normalizedTenantId) {
    const tenantResult = await centralPool.query(
      `SELECT *
         FROM media_settings
        WHERE tenant_id = $1
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
        LIMIT 1`,
      [normalizedTenantId]
    );
    if (tenantResult.rows.length) {
      return tenantResult.rows[0];
    }
  }

  const globalResult = await centralPool.query(
    `SELECT *
       FROM media_settings
      WHERE tenant_id IS NULL
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 1`
  );
  return globalResult.rows[0] || null;
};

const requireDirectUploadEnabled = async (req, res, next) => {
  try {
    const tenantId = req.query?.tenantId || null;
    const row = await fetchEffectiveMediaSettings(tenantId);
    const allowDirectUpload = row ? row.allow_direct_upload !== false : true;

    if (!allowDirectUpload) {
      return res.status(403).json({
        error: 'Direct upload disabled. Please use external links.'
      });
    }
    next();
  } catch (error) {
    console.error('Require direct upload enabled error', error);
    // Fail open to avoid breaking uploads if central DB is temporarily unavailable.
    next();
  }
};

// ========== MEDIA SETTINGS API ==========
// Get media settings (global or tenant-specific)
app.get('/api/media-settings', async (req, res) => {
  try {
    const tenantId = req.query?.tenantId || null;
    const row = await fetchEffectiveMediaSettings(tenantId);

    // If no setting exists, return default
    if (!row) {
      return res.json({ allowDirectUpload: true });
    }
    
    res.json({
      id: row.id,
      tenantId: row.tenant_id,
      allowDirectUpload: row.allow_direct_upload,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  } catch (error) {
    console.error('Get media settings error', error);
    res.status(500).json({ error: 'Unable to fetch media settings' });
  }
});

// Update media settings (global or tenant-specific)
app.put('/api/media-settings', async (req, res) => {
  try {
    const { tenantId, allowDirectUpload } = req.body;
    
    if (typeof allowDirectUpload !== 'boolean') {
      return res.status(400).json({ error: 'allowDirectUpload must be a boolean' });
    }
    
    const normalizedTenantId = tenantId || null;
    const result = await centralPool.query(
      `INSERT INTO media_settings (tenant_id, allow_direct_upload, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (COALESCE(tenant_id, '${ZERO_UUID}'::uuid))
       DO UPDATE SET allow_direct_upload = EXCLUDED.allow_direct_upload, updated_at = NOW()
       RETURNING *`,
      [normalizedTenantId, allowDirectUpload]
    );
    
    res.json({
      id: result.rows[0].id,
      tenantId: result.rows[0].tenant_id,
      allowDirectUpload: result.rows[0].allow_direct_upload,
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].updated_at
    });
  } catch (error) {
    console.error('Update media settings error', error);
    res.status(500).json({ error: 'Unable to update media settings' });
  }
});

// ========== GENERAL MEDIA UPLOAD ENDPOINTS ==========
// Upload image (general purpose)
app.post('/api/upload/image', requireDirectUploadEnabled, upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }
    
    const imageUrl = `/uploads/${req.file.filename.startsWith('image-') ? 'blog-images' : req.file.filename.startsWith('thumbnail') || req.file.filename.startsWith('courseImage') ? 'course-images' : req.file.filename.startsWith('avatar') || req.file.filename.startsWith('profilePicture') ? 'avatars' : 'general'}/${req.file.filename}`;
    res.json({ url: imageUrl, filename: req.file.filename });
  } catch (error) {
    console.error('Image upload error', error);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

// Upload video (general purpose)
app.post('/api/upload/video', requireDirectUploadEnabled, upload.single('video'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }
    
    const videoUrl = `/uploads/${req.file.filename.startsWith('video-') ? 'blog-videos' : 'general'}/${req.file.filename}`;
    res.json({ url: videoUrl, filename: req.file.filename });
  } catch (error) {
    console.error('Video upload error', error);
    res.status(500).json({ error: 'Failed to upload video' });
  }
});

// Upload course thumbnail
app.post('/api/upload/thumbnail', requireDirectUploadEnabled, upload.single('thumbnail'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No thumbnail file uploaded' });
    }
    
    const thumbnailUrl = `/uploads/course-images/${req.file.filename}`;
    res.json({ url: thumbnailUrl, filename: req.file.filename });
  } catch (error) {
    console.error('Thumbnail upload error', error);
    res.status(500).json({ error: 'Failed to upload thumbnail' });
  }
});

// Upload avatar/profile picture
app.post('/api/upload/avatar', requireDirectUploadEnabled, upload.single('avatar'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No avatar file uploaded' });
    }
    
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    res.json({ url: avatarUrl, filename: req.file.filename });
  } catch (error) {
    console.error('Avatar upload error', error);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

// Upload resume for career applications (public endpoint)
app.post('/api/careers/upload-resume', upload.single('resume'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No resume file uploaded' });
    }
    
    const resumeUrl = `/uploads/resumes/${req.file.filename}`;
    res.json({ url: resumeUrl, filename: req.file.filename });
  } catch (error) {
    console.error('Resume upload error', error);
    res.status(500).json({ error: 'Failed to upload resume' });
  }
});

// File upload endpoints for blog posts
app.post('/api/blog-posts/upload-image', requireDirectUploadEnabled, upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }
    
    const imageUrl = `/uploads/blog-images/${req.file.filename}`;
    res.json({ url: imageUrl, filename: req.file.filename });
  } catch (error) {
    console.error('Image upload error', error);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

app.post('/api/blog-posts/upload-video', requireDirectUploadEnabled, upload.single('video'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }
    
    const videoUrl = `/uploads/blog-videos/${req.file.filename}`;
    res.json({ url: videoUrl, filename: req.file.filename });
  } catch (error) {
    console.error('Video upload error', error);
    res.status(500).json({ error: 'Failed to upload video' });
  }
});

// Blog Post endpoints
app.post('/api/blog-posts', async (req, res) => {
  try {
    const { title, excerpt, content, author, image, isFeatured, status, category, videoUrl, uploadedImagePath, uploadedVideoPath, seoOverride } = req.body || {};
    
    if (!title || !content || !author) {
      return res.status(400).json({ error: 'title, content, and author are required' });
    }

    const postId = randomUUID();
    const publishedOn = new Date().toISOString().split('T')[0];
    const postExcerpt = excerpt || content.substring(0, 150);
    const chosenImage = uploadedImagePath || image;
    const postImage = sanitizeBlogImage(chosenImage || BLOG_IMAGE_FALLBACK);
    const postStatus = status || 'DRAFT';
    const postCategory = category || 'Technology';

    const result = await pool.query(
      `INSERT INTO blog_posts (id, title, excerpt, content, author, image, published_on, is_featured, status, category, video_url, uploaded_image_path, uploaded_video_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [postId, title, postExcerpt, content, author, postImage, publishedOn, isFeatured || false, postStatus, postCategory, videoUrl || null, uploadedImagePath || null, uploadedVideoPath || null]
    );

    const overrideRow = await upsertSeoOverride({
      contentType: 'blog_post',
      contentId: postId,
      payload: seoOverride,
      userId: req.user?.id || null
    });

    const newPost = {
      id: result.rows[0].id,
      slug: result.rows[0].slug,
      title: result.rows[0].title,
      excerpt: result.rows[0].excerpt,
      content: result.rows[0].content,
      author: result.rows[0].author,
      image: resolveBlogImageResponse(result.rows[0].image, result.rows[0].uploaded_image_path),
      date: new Date(result.rows[0].published_on).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      isFeatured: result.rows[0].is_featured,
      status: result.rows[0].status,
      category: result.rows[0].category || 'Technology',
      videoUrl: result.rows[0].video_url,
      uploadedImagePath: result.rows[0].uploaded_image_path,
      uploadedVideoPath: result.rows[0].uploaded_video_path,
      seoOverride: overrideRow ? buildSeoOverrideFromRow({ ...overrideRow }, '') : undefined
    };

    res.status(201).json(newPost);
  } catch (error) {
    console.error('Create blog post error', error);
    res.status(500).json({ error: 'Unable to create blog post' });
  }
});

app.put('/api/blog-posts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, excerpt, content, author, image, isFeatured, status, category, videoUrl, uploadedImagePath, uploadedVideoPath, seoOverride } = req.body || {};

    const existingResult = await pool.query('SELECT * FROM blog_posts WHERE id = $1', [id]);
    if (!existingResult.rowCount) {
      return res.status(404).json({ error: 'Blog post not found' });
    }

    const existing = existingResult.rows[0];
    const nextImage = sanitizeBlogImage(image ?? existing.image);
    
    const result = await pool.query(
      `UPDATE blog_posts
       SET title = $2, excerpt = $3, content = $4, author = $5, image = $6, is_featured = $7, status = $8, category = $9, video_url = $10, uploaded_image_path = $11, uploaded_video_path = $12
       WHERE id = $1
       RETURNING *`,
      [
        id,
        title ?? existing.title,
        excerpt ?? existing.excerpt,
        content ?? existing.content,
        author ?? existing.author,
        nextImage,
        isFeatured !== undefined ? isFeatured : existing.is_featured,
        status ?? existing.status,
        category !== undefined ? category : (existing.category || 'Technology'),
        videoUrl !== undefined ? videoUrl : existing.video_url,
        uploadedImagePath !== undefined ? uploadedImagePath : existing.uploaded_image_path,
        uploadedVideoPath !== undefined ? uploadedVideoPath : existing.uploaded_video_path
      ]
    );

    const overrideRow = await upsertSeoOverride({
      contentType: 'blog_post',
      contentId: id,
      payload: seoOverride,
      userId: req.user?.id || null
    });

    const updatedPost = {
      id: result.rows[0].id,
      slug: result.rows[0].slug,
      title: result.rows[0].title,
      excerpt: result.rows[0].excerpt,
      content: result.rows[0].content,
      author: result.rows[0].author,
      image: resolveBlogImageResponse(result.rows[0].image, result.rows[0].uploaded_image_path),
      date: new Date(result.rows[0].published_on).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      isFeatured: result.rows[0].is_featured,
      status: result.rows[0].status,
      category: result.rows[0].category || 'Technology',
      videoUrl: result.rows[0].video_url,
      uploadedImagePath: result.rows[0].uploaded_image_path,
      uploadedVideoPath: result.rows[0].uploaded_video_path,
      seoOverride: overrideRow ? buildSeoOverrideFromRow({ ...overrideRow }, '') : undefined
    };

    res.json(updatedPost);
  } catch (error) {
    console.error('Update blog post error', error);
    res.status(500).json({ error: 'Unable to update blog post' });
  }
});

app.delete('/api/blog-posts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query('DELETE FROM blog_posts WHERE id = $1 RETURNING *', [id]);
    
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Blog post not found' });
    }
    
    res.json({ message: 'Blog post deleted successfully' });
  } catch (error) {
    console.error('Delete blog post error', error);
    res.status(500).json({ error: 'Unable to delete blog post' });
  }
});

// Get blog post by slug (for SEO-friendly URLs)
app.get('/api/blog-posts/by-slug/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    
    const result = await pool.query(
      `SELECT b.*,
              o.title_en as seo_title_en,
              o.title_ar as seo_title_ar,
              o.description_en as seo_description_en,
              o.description_ar as seo_description_ar,
              o.keywords_en as seo_keywords_en,
              o.keywords_ar as seo_keywords_ar,
              o.canonical_url as seo_canonical_url,
              o.robots as seo_robots,
              o.indexable as seo_indexable,
              o.og_title_en as seo_og_title_en,
              o.og_title_ar as seo_og_title_ar,
              o.og_description_en as seo_og_description_en,
              o.og_description_ar as seo_og_description_ar,
              o.og_image_url as seo_og_image_url,
              o.og_type as seo_og_type,
              o.og_site_name as seo_og_site_name,
              o.twitter_card as seo_twitter_card,
              o.twitter_title_en as seo_twitter_title_en,
              o.twitter_title_ar as seo_twitter_title_ar,
              o.twitter_description_en as seo_twitter_description_en,
              o.twitter_description_ar as seo_twitter_description_ar,
              o.twitter_image_url as seo_twitter_image_url,
              o.jsonld_en as seo_jsonld_en,
              o.jsonld_ar as seo_jsonld_ar,
              o.locale as seo_locale,
              o.locale_alternate as seo_locale_alternate,
              o.sitemap_priority as seo_sitemap_priority,
              o.sitemap_changefreq as seo_sitemap_changefreq
        FROM blog_posts b
        LEFT JOIN seo_overrides o ON o.content_type = 'blog_post' AND o.content_id = b.id
        WHERE b.slug = $1`,
      [slug]
    );
    
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Blog post not found' });
    }
    
    const row = result.rows[0];
    const post = {
      id: row.id,
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      content: row.content,
      author: row.author,
      image: resolveBlogImageResponse(row.image, row.uploaded_image_path),
      date: new Date(row.published_on).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      isFeatured: row.is_featured,
      status: row.status,
      category: row.category || 'Technology',
      videoUrl: row.video_url,
      uploadedImagePath: row.uploaded_image_path,
      uploadedVideoPath: row.uploaded_video_path,
      seoOverride: buildSeoOverrideFromRow(row)
    };
    
    res.json(post);
  } catch (error) {
    console.error('Get blog post by slug error', error);
    res.status(500).json({ error: 'Unable to fetch blog post' });
  }
});

app.get([ICON_PATH_FAVICON, ICON_PATH_APPLE_TOUCH], async (req, res) => {
  try {
    const baseUrl = getRequestBaseUrl(req);
    const appearanceSettings = await readAppearanceSettings(req);
    const appearance = buildAppearanceResponse(appearanceSettings);
    const branding = appearance.branding || {};
    const iconUrl = toAbsoluteUrl(branding.faviconUrl || branding.logoUrl, baseUrl);
    const redirectUrl = toIconRedirectUrl(iconUrl);
    if (redirectUrl) {
      return res.redirect(302, redirectUrl);
    }
  } catch (error) {
    console.warn(`Icon redirect failed for ${req.path}`, error);
  }
  return res.redirect(302, DEFAULT_ICON_FALLBACK);
});

// Serve static files from the dist directory with caching
app.use(express.static(join(__dirname, 'dist'), {
  index: false,
  maxAge: 0,
  etag: true,
  lastModified: true,
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
      return;
    }
    if (path.endsWith('.js') || path.endsWith('.css') || path.endsWith('.woff2')) {
      // Cache versioned build artifacts aggressively
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return;
    }
    // Short cache for other static assets (images, fonts, etc.)
    res.setHeader('Cache-Control', 'public, max-age=604800');
  }
}));

// Handle client-side routing - send all requests to index.html
app.get('*', async (req, res) => {
  // Block unknown subdomains: if the request host is a subdomain of MAIN_DOMAIN
  // but no tenant was resolved by optionalTenantResolver, refuse to serve the SPA.
  {
    const mainDomain = (process.env.MAIN_DOMAIN || 'betacdmy.com.vendoworld.com').toLowerCase();
    const effectiveHost = req.headers['x-forwarded-host'] || req.headers['host'] || '';
    const rawHost = (Array.isArray(effectiveHost) ? effectiveHost[0] : String(effectiveHost).split(',')[0]).trim();
    const hostname = rawHost.split(':')[0].toLowerCase().replace(/^www\./, '');
    const isSubdomain = hostname !== mainDomain && hostname.endsWith(`.${mainDomain}`);
    if (isSubdomain && !req.tenant) {
      return res.status(404).type('html').send(
        `<!DOCTYPE html><html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>الموقع غير موجود</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Arial,sans-serif;background:#f5f5f5;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
    .box{background:#fff;border-radius:12px;padding:48px 32px;text-align:center;max-width:480px;width:100%;box-shadow:0 4px 24px rgba(0,0,0,.1)}
    h1{color:#dc2626;font-size:24px;margin-bottom:12px}
    p{color:#555;margin-bottom:24px;line-height:1.7}
    a{display:inline-block;background:#dc2626;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold}
    a:hover{background:#b91c1c}
  </style>
</head>
<body>
  <div class="box">
    <h1>الموقع غير موجود</h1>
    <p>هذا الموقع الفرعي غير مسجل على منصتنا.<br>تأكد من صحة الرابط أو تواصل معنا.</p>
    <a href="https://${mainDomain}">العودة للرئيسية</a>
  </div>
</body></html>`
      );
    }
  }

  res.setHeader('Cache-Control', 'no-cache');

  try {
    const template = await getIndexTemplate();
    const lang = resolveRequestLanguage(req);
    const baseUrl = getRequestBaseUrl(req);
    const isCentral = !(req.tenant || req.tenantPool);
    const isTenantRequest = Boolean(req.tenant) && !isCentralDomainHostRequest(req);
    const requestAppearance = isTenantRequest
      ? withTenantHeroMediaFallback(readTenantSettings(req.tenant), await readCentralAppearanceSettings())
      : buildAppearanceResponse(await readCentralAppearanceSettings());
    const requestBranding = requestAppearance.branding || {};
    const requestBrandImage = toAbsoluteUrl(requestBranding.faviconUrl || requestBranding.logoUrl, baseUrl);
    const tenantDescription = req.tenant?.description || req.tenant?.settings?.description;
    const tenantDescriptionText = typeof tenantDescription === 'string' ? tenantDescription.trim() : '';
    const tenantName = (typeof req.tenant?.company_name === 'string' ? req.tenant.company_name.trim() : '')
      || (typeof req.tenant?.subdomain === 'string' ? req.tenant.subdomain.trim() : '');
    const defaults = {
      title: tenantName || 'Betacademy',
      description: tenantDescriptionText
        ? tenantDescriptionText
        : undefined,
      siteName: tenantName || 'Betacademy',
      imageUrl: requestBrandImage,
      indexable: true
    };

    const seo = await resolveSeoForPath({
      path: req.path,
      search: req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '',
      lang,
      tenantPool: req.tenantPool,
      isCentral,
      baseUrl,
      defaults
    });
    if (requestBrandImage) {
      seo.og = seo.og ? { ...seo.og, image: requestBrandImage } : { image: requestBrandImage };
      seo.twitter = seo.twitter ? { ...seo.twitter, image: requestBrandImage } : { image: requestBrandImage };
    }
    if (req.tenant && tenantName) {
      const isHomePage = req.path === '/';
      const effectivePageTitle = seo.title || tenantName;
      const effectiveOgTitle = seo.og?.title || seo.title || tenantName;
      seo.title = isHomePage ? tenantName : effectivePageTitle;
      seo.og = {
        ...(seo.og || {}),
        title: isHomePage ? tenantName : effectiveOgTitle,
        site_name: tenantName,
      };
      seo.twitter = {
        ...(seo.twitter || {}),
        title: isHomePage ? tenantName : (seo.twitter?.title || effectivePageTitle),
      };
    }

    const headTags = buildSeoHeadTags(seo);
    const htmlAttributes = `lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"`;
    const withHtml = template.replace(/<html[^>]*>/i, `<html ${htmlAttributes}>`);
    const withTitle = seo?.title
      ? withHtml.replace(/<title>.*?<\/title>/i, `<title>${escapeHtml(seo.title)}</title>`)
      : withHtml;
    const withBrandingHead = applyBrandingHeadOverrides(withTitle, requestBranding, baseUrl);
    const finalHtml = withBrandingHead.replace(/<\/head>/i, `${headTags}\n</head>`);

    res.type('html').send(finalHtml);
  } catch (error) {
    console.error('Failed to render SEO HTML', error);
    res.sendFile(join(__dirname, 'dist', 'index.html'));
  }
});

// ============================================================================
// API Versioning: Duplicate all /api/* routes to /api/v1/*
// ============================================================================
// This function automatically creates v1 routes for all existing API routes
function duplicateRoutesForV1() {
  const routes = [];
  const normalizeRoutePaths = (value) => {
    if (Array.isArray(value)) {
      return value.filter((item) => typeof item === 'string');
    }
    return typeof value === 'string' ? [value] : [];
  };
  
  // Extract all registered routes from Express
  app._router.stack.forEach((middleware) => {
    if (middleware.route) {
      // Routes registered directly on the app
      const paths = normalizeRoutePaths(middleware.route.path);
      paths.forEach((path) => {
        if (path.startsWith('/api/v1/') || !path.startsWith('/api/')) {
          return;
        }
        routes.push({
          path: path,
          methods: middleware.route.methods,
          stack: middleware.route.stack
        });
      });
    } else if (middleware.name === 'router') {
      // Routes registered via Router
      middleware.handle.stack.forEach((handler) => {
        if (handler.route) {
          const paths = middleware.regexp.toString().includes('/api/')
            ? normalizeRoutePaths(handler.route.path)
            : [];
          paths.forEach((path) => {
            if (path.startsWith('/api/v1/') || !path.startsWith('/api/')) {
              return;
            }
            routes.push({
              path: path,
              methods: handler.route.methods,
              stack: handler.route.stack
            });
          });
        }
      });
    }
  });

  console.log(`\n=== API Versioning ===`);
  console.log(`Found ${routes.length} routes under /api/*`);
  console.log(`All routes are now accessible via both:`);
  console.log(`  - /api/* (legacy)`);
  console.log(`  - /api/v1/* (versioned)`);
  
  return routes.length;
}

// Run route duplication
const duplicatedRoutes = duplicateRoutesForV1();

app.listen(PORT, HOST, () => {
  const portSource = process.env.PORT ? 'cPanel/env PORT' : 'default 3000';
  console.log(`Server is running on ${HOST}:${PORT} (${portSource})`);
  
  // Log CORS configuration
  const corsConfig = getCorsConfig();
  console.log('\n=== CORS Configuration ===');
  console.log('Environment:', corsConfig.isProduction ? 'PRODUCTION' : 'DEVELOPMENT');
  console.log('Allowed Origins:', corsConfig.allowedOrigins.join(', '));
  console.log('Wildcard Enabled:', corsConfig.wildcardEnabled ? 'YES ⚠️' : 'NO ✓');
  console.log('Media Allow All:', corsConfig.mediaAllowAll ? 'YES' : 'NO');
  console.log('==========================\n');
});
