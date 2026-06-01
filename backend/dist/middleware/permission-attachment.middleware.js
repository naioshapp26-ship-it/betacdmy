import { RBACService } from '../services/rbac.service.js';
import { createErrorResponse } from '../utils/error-messages.js';
/**
 * Middleware to attach user's permissions and roles to the request
 * Must be called after requireAuth and requireTenantPool
 *
 * Usage:
 *   router.use(requireAuth, tenantResolver, requireTenantPool, attachUserPermissions);
 */
export const attachUserPermissions = async (req, res, next) => {
    const userId = req.userId;
    const tenantPool = req.tenantPool;
    // Skip if no user authenticated
    if (!userId) {
        return next();
    }
    // Skip if no tenant context
    if (!tenantPool) {
        return next();
    }
    try {
        // Fetch user's roles
        const roles = await RBACService.getUserRoles(tenantPool, userId);
        req.userRoles = roles.map(r => r.role_name);
        // Fetch user's effective permissions (from all roles)
        const permissions = await RBACService.getUserPermissions(tenantPool, userId);
        req.userPermissions = permissions.map(p => p.permission_name);
        console.debug('[Auth] User permissions attached', {
            userId,
            roles: req.userRoles,
            permissionCount: req.userPermissions.length
        });
        next();
    }
    catch (error) {
        console.error('[Auth] Failed to attach user permissions', error);
        // Don't fail the request, just continue without permissions
        // RBAC middleware will handle the missing permissions
        next();
    }
};
/**
 * Check if user owns a resource
 *
 * @param resourceUserIdExtractor - Function to extract the resource owner's userId
 * @returns Middleware that allows access if user owns the resource or has override permission
 *
 * Usage:
 *   router.get('/profile/:userId',
 *     requireAuth,
 *     requireOwnership(req => parseInt(req.params.userId)),
 *     handler
 *   );
 */
export const requireOwnership = (resourceUserIdExtractor, overridePermission) => {
    return (req, res, next) => {
        const userId = req.userId;
        if (!userId) {
            const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
            const message = lang === 'ar'
                ? 'مطلوب مصادقة.'
                : 'Authentication required.';
            return res.status(401).json(createErrorResponse('errors.authRequired', req, message));
        }
        const resourceOwnerId = resourceUserIdExtractor(req);
        // If user owns the resource, allow
        if (resourceOwnerId && userId === resourceOwnerId) {
            return next();
        }
        // If override permission is provided and user has it, allow
        if (overridePermission && req.userPermissions?.includes(overridePermission)) {
            console.debug('[Auth] Access granted via override permission', {
                userId,
                permission: overridePermission
            });
            return next();
        }
        // Otherwise, deny
        const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
        const message = lang === 'ar'
            ? 'ليس لديك صلاحية للوصول إلى هذا المورد.'
            : 'You do not have permission to access this resource.';
        return res.status(403).json(createErrorResponse('errors.authForbidden', req, message));
    };
};
/**
 * Check if user owns a resource OR has a specific permission
 * More flexible than requireOwnership
 *
 * @param resourceUserIdExtractor - Function to extract the resource owner's userId
 * @param requiredPermission - Permission required if not owner
 *
 * Usage:
 *   router.put('/profile/:userId',
 *     requireAuth,
 *     attachUserPermissions,
 *     requireOwnershipOrPermission(
 *       req => parseInt(req.params.userId),
 *       'user:update:any'
 *     ),
 *     handler
 *   );
 */
export const requireOwnershipOrPermission = (resourceUserIdExtractor, requiredPermission) => {
    return async (req, res, next) => {
        const userId = req.userId;
        const tenantPool = req.tenantPool;
        if (!userId) {
            const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
            const message = lang === 'ar'
                ? 'مطلوب مصادقة.'
                : 'Authentication required.';
            return res.status(401).json(createErrorResponse('errors.authRequired', req, message));
        }
        const resourceOwnerId = resourceUserIdExtractor(req);
        // If user owns the resource, allow
        if (resourceOwnerId && userId === resourceOwnerId) {
            console.debug('[Auth] Access granted via ownership', { userId, resourceOwnerId });
            return next();
        }
        // Check if user has the required permission
        if (!tenantPool) {
            const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
            const message = lang === 'ar'
                ? 'سياق المستأجر مفقود.'
                : 'Tenant context missing.';
            return res.status(500).json(createErrorResponse('errors.tenantPoolMissing', req, message));
        }
        try {
            const hasPermission = await RBACService.userHasPermission(tenantPool, userId, requiredPermission);
            if (hasPermission) {
                console.debug('[Auth] Access granted via permission', {
                    userId,
                    permission: requiredPermission
                });
                return next();
            }
            // Neither owner nor has permission
            const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
            const message = lang === 'ar'
                ? 'ليس لديك صلاحية للوصول إلى هذا المورد.'
                : 'You do not have permission to access this resource.';
            return res.status(403).json(createErrorResponse('errors.authForbidden', req, message));
        }
        catch (error) {
            console.error('[Auth] Permission check failed', error);
            return res.status(500).json(createErrorResponse('errors.apiServerError', req, 'Permission check failed'));
        }
    };
};
