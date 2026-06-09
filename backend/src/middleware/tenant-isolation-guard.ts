import { Request, Response, NextFunction } from 'express';
import { createErrorResponse } from '../utils/error-messages.js';
import { extractSubdomain } from '../utils/tenant-host.js';

/**
 * Extract subdomain from host header.
 * Checks X-Forwarded-Host first to support reverse proxy setups
 * (Apache mod_rewrite [P] rewrites the Host header to 127.0.0.1:PORT).
 */
const getEffectiveHost = (req: Request): string | undefined => {
  const forwarded = req.headers['x-forwarded-host'];
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0].trim();
    if (first) return first;
  }
  return req.headers.host;
};

/**
 * Middleware to enforce tenant pool isolation
 * This guard ensures that tenant-scoped routes MUST have a tenantPool attached
 * Prevents accidental cross-tenant data access
 */
export const requireTenantPool = (req: Request, res: Response, next: NextFunction) => {
  const tenantPool = (req as any).tenantPool;
  const tenant = (req as any).tenant;

  if (!tenantPool) {
    console.error('[SECURITY] Tenant-scoped route accessed without tenantPool!', {
      path: req.path,
      method: req.method,
      tenant: tenant?.subdomain || 'unknown',
      ip: req.ip,
      headers: {
        host: req.headers.host,
        referer: req.headers.referer
      }
    });

    return res.status(500).json(
      createErrorResponse(
        'errors.tenantPoolMissing',
        req,
        'Tenant database pool not available. This is a security violation.'
      )
    );
  }

  if (!tenant) {
    console.error('[SECURITY] Tenant-scoped route accessed without tenant context!', {
      path: req.path,
      method: req.method,
      ip: req.ip
    });

    return res.status(404).json(
      createErrorResponse(
        'errors.tenantNotFound',
        req,
        'Tenant context not found'
      )
    );
  }

  // Verify tenant is in active status (pending_payment is allowed)
  if (tenant.status !== 'active' && tenant.status !== 'pending_payment') {
    console.warn('[SECURITY] Attempt to access non-active tenant', {
      tenant: tenant.subdomain,
      status: tenant.status,
      path: req.path
    });

    if (tenant.status === 'suspended') {
      return res.status(403).json(
        createErrorResponse(
          'errors.tenantSuspended',
          req,
          'This tenant has been suspended'
        )
      );
    }

    return res.status(403).json(
      createErrorResponse(
        'errors.tenantInactive',
        req,
        'Tenant is not active'
      )
    );
  }

  // Log successful access for audit trail
  if (process.env.LOG_TENANT_ACCESS === 'true') {
    console.log('[Tenant Access]', {
      tenant: tenant.subdomain,
      tenantId: tenant.id,
      path: req.path,
      method: req.method,
      ip: req.ip
    });
  }

  next();
};

/**
 * Middleware to prevent super admin routes from accessing tenant pools
 * Super admins should only read from central database
 */
export const preventTenantPoolAccess = (req: Request, res: Response, next: NextFunction) => {
  const tenantPool = (req as any).tenantPool;

  if (tenantPool) {
    console.error('[SECURITY] Super admin route attempted to use tenant pool!', {
      path: req.path,
      method: req.method,
      ip: req.ip
    });

    return res.status(500).json({
      error: 'Security violation: Super admin routes cannot access tenant pools'
    });
  }

  next();
};

/**
 * Middleware to block super_admin routes and role on tenant subdomains
 * Super admin functionality should ONLY be accessible on the main domain (www.betacdmy.com)
 * Tenant subdomains (e.g., celia.betacdmy.com) should not have any super_admin access
 */
export const blockSuperAdminOnTenant = (req: Request, res: Response, next: NextFunction) => {
  const subdomain = extractSubdomain(getEffectiveHost(req));
  
  // If there's a subdomain, this is a tenant - block super_admin access
  if (subdomain) {
    const path = req.path.toLowerCase();
    
    // Block any super-admin API routes
    if (path.includes('super-admin') || path.includes('superadmin')) {
      console.warn('[SECURITY] Super admin route blocked on tenant subdomain', {
        subdomain,
        path: req.path,
        method: req.method,
        ip: req.ip
      });

      const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
      const message = lang === 'ar'
        ? 'صلاحيات المسؤول الأعلى غير متاحة على نطاقات المستأجرين'
        : 'Super admin access is not available on tenant subdomains';

      return res.status(403).json(
        createErrorResponse('errors.superAdminNotOnTenant', req, message)
      );
    }
  }

  next();
};

/**
 * Check if the current request is from a tenant subdomain
 */
export const isTenantSubdomain = (req: Request): boolean => {
  return !!extractSubdomain(getEffectiveHost(req));
};

/**
 * Audit logger for sensitive operations
 */
export const auditLog = (operation: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const tenant = (req as any).tenant;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    console.log('[AUDIT]', {
      operation,
      timestamp: new Date().toISOString(),
      tenant: tenant?.subdomain || 'no-tenant',
      tenantId: tenant?.id || 'no-tenant-id',
      path: req.path,
      method: req.method,
      ip,
      userAgent: req.headers['user-agent']
    });

    // Continue to next middleware
    next();
  };
};

/**
 * Middleware to validate tenant pool query safety
 * Ensures no SQL injection or cross-tenant queries
 */
export const validateQuerySafety = (req: Request, res: Response, next: NextFunction) => {
  const body = req.body;
  const query = req.query;

  // Check for suspicious patterns in request
  const suspiciousPatterns = [
    /information_schema/i,
    /pg_catalog/i,
    /pg_database/i,
    /DROP\s+TABLE/i,
    /DROP\s+DATABASE/i,
    /TRUNCATE/i,
    /;\s*DROP/i,
    /;\s*DELETE/i,
    /UNION\s+SELECT/i,
    /--/,
    /\/\*/,
  ];

  const checkValue = (value: any): boolean => {
    if (typeof value === 'string') {
      return suspiciousPatterns.some(pattern => pattern.test(value));
    }
    if (typeof value === 'object' && value !== null) {
      return Object.values(value).some(v => checkValue(v));
    }
    return false;
  };

  if (checkValue(body) || checkValue(query)) {
    console.error('[SECURITY] Suspicious query pattern detected!', {
      path: req.path,
      method: req.method,
      ip: req.ip,
      tenant: (req as any).tenant?.subdomain
    });

    return res.status(400).json({
      error: 'Invalid request',
      message: 'Suspicious query pattern detected'
    });
  }

  next();
};
