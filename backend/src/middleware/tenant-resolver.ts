import { Request, Response, NextFunction } from 'express';
import { centralPool, TenantRow } from '../central-db.js';
import { isValidSubdomain } from '../utils/subdomain-validator.js';
import { getTenantPool } from '../services/db-manager.js';
import { createErrorResponse } from '../utils/error-messages.js';

export type TenantContext = TenantRow & { connectionString?: string };

/**
 * Helper to determine if the request is for an API endpoint
 */
const isApiRequest = (req: Request): boolean => {
  return req.path.startsWith('/api/') || req.path.startsWith('/saas/');
};

/**
 * Send a user-friendly HTML error page for tenant issues
 */
const sendTenantErrorPage = (res: Response, statusCode: number, title: string, message: string, additionalInfo?: string) => {
  const html = `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: 'Cairo', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            max-width: 500px;
            width: 100%;
            padding: 48px 32px;
            text-align: center;
        }
        .icon {
            width: 80px;
            height: 80px;
            margin: 0 auto 24px;
            background: #fee;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 40px;
        }
        h1 {
            font-size: 28px;
            font-weight: 700;
            color: #1a1a1a;
            margin-bottom: 16px;
            line-height: 1.5;
        }
        p {
            font-size: 18px;
            color: #666;
            line-height: 1.8;
            margin-bottom: 12px;
        }
        .additional-info {
            margin-top: 24px;
            padding: 16px;
            background: #f8f9fa;
            border-radius: 8px;
            font-size: 16px;
            color: #555;
            line-height: 1.8;
        }
        .contact-section {
            margin-top: 32px;
        }
        .contact-text {
            font-size: 16px;
            color: #666;
            margin-bottom: 16px;
            line-height: 1.8;
        }
        .contact-button {
            display: inline-block;
            padding: 14px 32px;
            background: #667eea;
            color: white;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            font-size: 16px;
            transition: all 0.3s ease;
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
        }
        .contact-button:hover {
            background: #5568d3;
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(102, 126, 234, 0.4);
        }
        @media (max-width: 480px) {
            .container {
                padding: 32px 24px;
            }
            h1 {
                font-size: 24px;
            }
            p {
                font-size: 16px;
            }
            .additional-info {
                font-size: 14px;
            }
            .contact-text {
                font-size: 15px;
            }
            .contact-button {
                font-size: 15px;
                padding: 12px 28px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">⚠️</div>
        <h1>${title}</h1>
        <p>${message}</p>
        ${additionalInfo ? `<div class="additional-info">${additionalInfo}</div>` : ''}
        <div class="contact-section">
            <p class="contact-text">يرجى التواصل معنا للحصول على مزيد من المعلومات</p>
            <a href="https://www.betacdmy.com/contact-us" class="contact-button">تواصل معنا</a>
        </div>
    </div>
</body>
</html>
  `;
  
  res.status(statusCode).type('html').send(html);
};

declare module 'express-serve-static-core' {
  interface Request {
    tenant?: TenantContext;
    tenantPool?: ReturnType<typeof getTenantPool> extends Promise<infer P> ? P : never;
  }
}

export const extractSubdomain = (host?: string | null): string | null => {
  if (!host) return null;
  const hostname = host.split(':')[0].toLowerCase();
  const mainDomain = (process.env.MAIN_DOMAIN || 'betacdmy.com').toLowerCase();
  if (!hostname.endsWith(mainDomain)) return null;
  const remainder = hostname.slice(0, -mainDomain.length).replace(/\.$/, '');
  if (!remainder || remainder === 'www') {
    return null;
  }
  return remainder;
};

/**
 * Get the effective host for subdomain extraction.
 * When behind a reverse proxy (Apache mod_rewrite [P]), the Host header
 * is rewritten to the proxy target (e.g. 127.0.0.1:3001).
 * We check X-Forwarded-Host first to recover the original hostname.
 */
const getEffectiveHost = (req: Request): string | undefined => {
  const forwarded = req.headers['x-forwarded-host'];
  if (forwarded) {
    // X-Forwarded-Host may be comma-separated; use the first (original client) value
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0].trim();
    if (first) return first;
  }
  return req.headers.host;
};

const normalizeHost = (host?: string | null): string | null => {
  if (!host) {
    return null;
  }
  return host.split(':')[0].trim().toLowerCase() || null;
};

const normalizeCustomDomain = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  const withoutProtocol = value.replace(/^https?:\/\//i, '');
  const host = withoutProtocol.split('/')[0]?.trim().toLowerCase();
  return host || null;
};

type ResolverOptions = {
  requireTenant?: boolean;
};

const attachTenantContext = async (req: Request, res: Response, { requireTenant = true }: ResolverOptions = {}) => {
  const effectiveHost = getEffectiveHost(req);
  const host = normalizeHost(effectiveHost);
  const normalizedHost = host ? host.replace(/^www\./, '') : null;
  const hostWithWww = normalizedHost ? `www.${normalizedHost}` : null;
  const subdomain = extractSubdomain(effectiveHost);

  if (!subdomain && !normalizedHost) {
    if (requireTenant) {
      if (isApiRequest(req)) {
        res.status(404).json(createErrorResponse('errors.tenantNotFound', req, 'Tenant not found'));
      } else {
        sendTenantErrorPage(
          res,
          404,
          'الموقع غير متاح',
          'هذا الموقع غير متاح حالياً.'
        );
      }
      return false;
    }
    return true;
  }

  if (subdomain && !isValidSubdomain(subdomain)) {
    if (isApiRequest(req)) {
      res.status(400).json(createErrorResponse('errors.tenantInvalidSubdomain', req, 'Invalid subdomain'));
    } else {
      sendTenantErrorPage(
        res,
        400,
        'عنوان الموقع غير صالح',
        'عنوان هذا الموقع غير صحيح.'
      );
    }
    return false;
  }

  try {
    const result = await centralPool.query<TenantRow>(
      `SELECT id, subdomain, company_name, status, subscription_plan, database_url_encrypted, database_name, settings, custom_domain
         FROM tenants
         WHERE status != 'deleted'
           AND (
             ($1::text IS NOT NULL AND subdomain = $1)
             OR (
               $2::text IS NOT NULL
               AND LOWER(
                 split_part(
                   regexp_replace(COALESCE(custom_domain, ''), '^https?://', '', 'i'),
                   '/',
                   1
                 )
               ) IN ($2, $3)
             )
           )
         LIMIT 1`,
      [subdomain, normalizedHost, hostWithWww]
    );

    if (!result.rowCount) {
      if (!requireTenant) {
        return true;
      }
      if (isApiRequest(req)) {
        res.status(404).json(createErrorResponse('errors.tenantNotFound', req, 'Tenant not found'));
      } else {
        sendTenantErrorPage(
          res,
          404,
          'الموقع غير متاح',
          'هذا الموقع غير متاح حالياً.'
        );
      }
      return false;
    }

    const tenant = result.rows[0];
    
    // Block access if tenant is suspended
    if (tenant.status === 'suspended') {
      if (isApiRequest(req)) {
        res.status(403).json(createErrorResponse('errors.tenantSuspended', req, 'Tenant suspended'));
      } else {
        sendTenantErrorPage(
          res,
          403,
          'الموقع معلق مؤقتاً',
          'هذا الموقع غير متاح حالياً.'
        );
      }
      return false;
    }

    req.tenant = {
      ...tenant,
      ...(tenant as any)?.custom_domain
        ? { custom_domain: normalizeCustomDomain((tenant as any).custom_domain) }
        : {}
    } as TenantContext;
    req.tenantPool = await getTenantPool(tenant);
    return true;
  } catch (error) {
    console.error('Tenant resolution failed', error);
    if (isApiRequest(req)) {
      res.status(500).json(createErrorResponse('errors.apiServerError', req, 'Server error'));
    } else {
      sendTenantErrorPage(
        res,
        500,
        'حدث خطأ ما',
        'واجهنا خطأ أثناء تحميل هذا الموقع.'
      );
    }
    return false;
  }
};

export const tenantResolver = async (req: Request, res: Response, next: NextFunction) => {
  const proceed = await attachTenantContext(req, res, { requireTenant: true });
  if (proceed) {
    next();
  }
};

export const optionalTenantResolver = async (req: Request, res: Response, next: NextFunction) => {
  const proceed = await attachTenantContext(req, res, { requireTenant: false });
  if (proceed) {
    next();
  }
};

