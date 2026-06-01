import { Request, Response, NextFunction } from 'express';
import { RBACService } from '../services/rbac.service.js';
import { createErrorResponse } from '../utils/error-messages.js';
import { isTenantSubdomain } from './tenant-isolation-guard.js';

/**
 * Middleware to check if the authenticated user has a specific permission
 * Usage: requirePermission('course:create')
 * 
 * IMPORTANT: Must be used after requireAuth and requireTenantPool in middleware chain
 */
export const requirePermission = (permissionName: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).userId;
    const tenantPool = (req as any).tenantPool;

    if (!userId) {
      const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
      const message = lang === 'ar' 
        ? 'مطلوب مصادقة. يرجى تسجيل الدخول.'
        : 'Authentication required. Please log in.';
      console.warn('[RBAC] Permission check attempted without userId', {
        permission: permissionName,
        path: req.path,
        method: req.method
      });
      return res.status(401).json(
        createErrorResponse('errors.authRequired', req, message)
      );
    }

    if (!tenantPool) {
      const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
      const message = lang === 'ar' 
        ? 'سياق المستأجر مفقود.'
        : 'Tenant context missing.';
      console.error('[RBAC] Permission check without tenant pool', {
        permission: permissionName,
        userId,
        path: req.path
      });
      return res.status(500).json(
        createErrorResponse('errors.tenantPoolMissing', req, message)
      );
    }

    try {
      const hasPermission = await RBACService.userHasPermission(
        tenantPool,
        userId,
        permissionName
      );

      if (!hasPermission) {
        const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
        const message = lang === 'ar' 
          ? `تم رفض الإذن: ${permissionName}`
          : `Permission denied: ${permissionName}`;
        
        console.warn('[RBAC] Permission denied', {
          userId,
          permission: permissionName,
          path: req.path,
          method: req.method
        });

        return res.status(403).json(
          createErrorResponse(
            'errors.permissionDenied',
            req,
            message
          )
        );
      }

      // Permission granted, proceed
      next();
    } catch (error) {
      console.error('[RBAC] Permission check failed', error);
      return res.status(500).json(
        createErrorResponse('errors.apiServerError', req, 'Permission check failed')
      );
    }
  };
};

/**
 * Middleware to check if user has ANY of the specified permissions
 * Usage: requireAnyPermission(['course:create', 'course:update'])
 */
export const requireAnyPermission = (permissionNames: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).userId;
    const tenantPool = (req as any).tenantPool;

    if (!userId) {
      return res.status(401).json(
        createErrorResponse('errors.authRequired', req, 'Authentication required')
      );
    }

    if (!tenantPool) {
      return res.status(500).json(
        createErrorResponse('errors.tenantPoolMissing', req, 'Tenant context missing')
      );
    }

    try {
      const hasPermission = await RBACService.userHasAnyPermission(
        tenantPool,
        userId,
        permissionNames
      );

      if (!hasPermission) {
        console.warn('[RBAC] Permissions denied', {
          userId,
          permissions: permissionNames,
          path: req.path
        });

        return res.status(403).json(
          createErrorResponse(
            'errors.permissionDenied',
            req,
            'Insufficient permissions'
          )
        );
      }

      next();
    } catch (error) {
      console.error('[RBAC] Permission check failed', error);
      return res.status(500).json(
        createErrorResponse('errors.apiServerError', req, 'Permission check failed')
      );
    }
  };
};

/**
 * Middleware to check if user has ALL of the specified permissions
 * Usage: requireAllPermissions(['course:read', 'course:update'])
 */
export const requireAllPermissions = (permissionNames: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).userId;
    const tenantPool = (req as any).tenantPool;

    if (!userId) {
      return res.status(401).json(
        createErrorResponse('errors.authRequired', req, 'Authentication required')
      );
    }

    if (!tenantPool) {
      return res.status(500).json(
        createErrorResponse('errors.tenantPoolMissing', req, 'Tenant context missing')
      );
    }

    try {
      const hasPermissions = await RBACService.userHasAllPermissions(
        tenantPool,
        userId,
        permissionNames
      );

      if (!hasPermissions) {
        console.warn('[RBAC] Missing required permissions', {
          userId,
          requiredPermissions: permissionNames,
          path: req.path
        });

        return res.status(403).json(
          createErrorResponse(
            'errors.permissionDenied',
            req,
            'Insufficient permissions'
          )
        );
      }

      next();
    } catch (error) {
      console.error('[RBAC] Permission check failed', error);
      return res.status(500).json(
        createErrorResponse('errors.apiServerError', req, 'Permission check failed')
      );
    }
  };
};

/**
 * Middleware to check if user has a specific role
 * Usage: requireRole('ADMIN')
 * 
 * IMPORTANT: Must be used after requireAuth and requireTenantPool in middleware chain
 * NOTE: super_admin role is BLOCKED on tenant subdomains for security
 * NOTE: Tenant admins (isTenantAdmin=true) automatically have 'admin' role access
 */
export const requireRole = (roleName: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).userId;
    const user = (req as any).user;
    const tenantPool = (req as any).tenantPool;

    // Block super_admin role on tenant subdomains
    if (roleName.toLowerCase() === 'super_admin' && isTenantSubdomain(req)) {
      const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
      const message = lang === 'ar'
        ? 'صلاحيات المسؤول الأعلى غير متاحة على هذا النطاق'
        : 'Super admin role is not available on tenant subdomains';
      
      console.warn('[RBAC] Super admin role blocked on tenant subdomain', {
        path: req.path,
        method: req.method,
        host: req.headers.host
      });

      return res.status(403).json(
        createErrorResponse('errors.superAdminNotOnTenant', req, message)
      );
    }

    if (!userId) {
      const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
      const message = lang === 'ar' 
        ? 'مطلوب مصادقة. يرجى تسجيل الدخول.'
        : 'Authentication required. Please log in.';
      console.warn('[RBAC] Role check attempted without userId', {
        role: roleName,
        path: req.path,
        method: req.method
      });
      return res.status(401).json(
        createErrorResponse('errors.authRequired', req, message)
      );
    }

    // Special handling for tenant admins: they automatically have admin role
    // Tenant admins are stored in central DB (tenant_admins table), not in tenant's users table
    // Their isTenantAdmin flag is set in the JWT token during login
    if (user?.isTenantAdmin && roleName.toLowerCase() === 'admin') {
      console.log('[RBAC] Tenant admin granted admin role access', {
        userId,
        path: req.path,
        method: req.method
      });
      return next();
    }

    // Also check if user.role matches the required role (from JWT token)
    if (user?.role && user.role.toLowerCase() === roleName.toLowerCase()) {
      console.log('[RBAC] User role matches required role from JWT', {
        userId,
        userRole: user.role,
        requiredRole: roleName,
        path: req.path
      });
      return next();
    }

    if (!tenantPool) {
      if (roleName.toLowerCase() === 'super_admin') {
        const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
        const message = lang === 'ar'
          ? `الدور المطلوب: ${roleName}`
          : `Role required: ${roleName}`;
        return res.status(403).json(
          createErrorResponse('errors.permissionDenied', req, message)
        );
      }

      const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
      const message = lang === 'ar' 
        ? 'سياق المستأجر مفقود.'
        : 'Tenant context missing.';
      return res.status(500).json(
        createErrorResponse('errors.tenantPoolMissing', req, message)
      );
    }

    try {
      const hasRole = await RBACService.userHasRole(tenantPool, userId, roleName);

      if (!hasRole) {
        const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
        const message = lang === 'ar' 
          ? `الدور المطلوب: ${roleName}`
          : `Role required: ${roleName}`;
        
        console.warn('[RBAC] Role check failed', {
          userId,
          requiredRole: roleName,
          userRole: user?.role,
          isTenantAdmin: user?.isTenantAdmin,
          path: req.path
        });

        return res.status(403).json(
          createErrorResponse(
            'errors.permissionDenied',
            req,
            message
          )
        );
      }

      next();
    } catch (error) {
      console.error('[RBAC] Role check failed', error);
      return res.status(500).json(
        createErrorResponse('errors.apiServerError', req, 'Role check failed')
      );
    }
  };
};

/**
 * Middleware to attach user permissions to request object for later use
 */
export const attachUserPermissions = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const userId = (req as any).userId;
  const tenantPool = (req as any).tenantPool;

  if (!userId || !tenantPool) {
    return next();
  }

  try {
    const permissions = await RBACService.getUserPermissions(tenantPool, userId);
    const roles = await RBACService.getUserRoles(tenantPool, userId);

    (req as any).userPermissions = permissions;
    (req as any).userRoles = roles;

    next();
  } catch (error) {
    console.error('[RBAC] Failed to attach user permissions', error);
    // Continue anyway - this is not critical
    next();
  }
};

/**
 * Helper to check permission in route handlers (not middleware)
 */
export const checkPermission = async (
  req: Request,
  permissionName: string
): Promise<boolean> => {
  const userId = (req as any).userId;
  const tenantPool = (req as any).tenantPool;

  if (!userId || !tenantPool) {
    return false;
  }

  try {
    return await RBACService.userHasPermission(tenantPool, userId, permissionName);
  } catch (error) {
    console.error('[RBAC] Permission check failed', error);
    return false;
  }
};

/**
 * Middleware for resource ownership validation
 * Checks if user owns the resource OR has the required permission
 */
export const requireOwnershipOrPermission = (
  ownerIdField: string,
  permissionName: string
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).userId;
    const tenantPool = (req as any).tenantPool;
    const resourceOwnerId = (req as any)[ownerIdField];

    if (!userId) {
      return res.status(401).json(
        createErrorResponse('errors.authRequired', req, 'Authentication required')
      );
    }

    // Check if user owns the resource
    if (resourceOwnerId && resourceOwnerId.toString?.() === userId.toString?.()) {
      return next();
    }

    // Otherwise check if they have the required permission
    if (!tenantPool) {
      return res.status(500).json(
        createErrorResponse('errors.tenantPoolMissing', req, 'Tenant context missing')
      );
    }

    try {
      const hasPermission = await RBACService.userHasPermission(
        tenantPool,
        userId,
        permissionName
      );

      if (!hasPermission) {
        console.warn('[RBAC] Ownership/permission check failed', {
          userId,
          resourceOwnerId,
          permission: permissionName,
          path: req.path
        });

        return res.status(403).json(
          createErrorResponse(
            'errors.permissionDenied',
            req,
            'Access denied: not owner and insufficient permissions'
          )
        );
      }

      next();
    } catch (error) {
      console.error('[RBAC] Ownership/permission check failed', error);
      return res.status(500).json(
        createErrorResponse('errors.apiServerError', req, 'Authorization check failed')
      );
    }
  };
};

/**
 * Helper to check if user is admin (has admin role or admin permissions)
 */
export const isAdmin = async (req: Request): Promise<boolean> => {
  const userId = (req as any).userId;
  const tenantPool = (req as any).tenantPool;
  const user = (req as any).user;

  if (user?.isTenantAdmin) {
    return true;
  }

  if (user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN') {
    return true;
  }
  
  if (!userId || !tenantPool) {
    return false;
  }
  
  try {
    // Check if user has ADMIN role or admin:* permission
    const hasAdminRole = await RBACService.userHasRole(tenantPool, userId, 'ADMIN');
    if (hasAdminRole) return true;
    
    const hasAdminPermission = await RBACService.userHasAnyPermission(
      tenantPool,
      userId,
      ['admin:*', 'admin:full']
    );
    return hasAdminPermission;
  } catch (error) {
    console.error('[RBAC] isAdmin check failed', error);
    return false;
  }
};

/**
 * Helper to check resource ownership in route handlers
 */
export const checkOwnership = (userId: string | number, resourceOwnerId: string | number): boolean => {
  return userId?.toString?.() === resourceOwnerId?.toString?.();
};

/**
 * Helper to check if user can access resource (owner OR has permission)
 */
export const canAccessResource = async (
  req: Request,
  resourceOwnerId: string | number,
  permissionName: string
): Promise<boolean> => {
  const userId = (req as any).userId;
  const tenantPool = (req as any).tenantPool;
  
  if (!userId) return false;
  
  // Owner always has access
  if (userId?.toString?.() === resourceOwnerId?.toString?.()) return true;
  
  // Check permission
  if (!tenantPool) return false;
  
  try {
    return await RBACService.userHasPermission(tenantPool, userId, permissionName);
  } catch (error) {
    console.error('[RBAC] canAccessResource check failed', error);
    return false;
  }
};
