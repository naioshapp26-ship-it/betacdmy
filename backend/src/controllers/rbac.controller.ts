import { Router, Request, Response } from 'express';
import { RBACService } from '../services/rbac.service.js';
import { requirePermission, requireRole } from '../middleware/rbac.middleware.js';
import { requireTenantPool } from '../middleware/tenant-isolation-guard.js';
import { createErrorResponse } from '../utils/error-messages.js';
import { getSingleParam } from '../utils/request-params.js';

export const createRBACRouter = () => {
  const router = Router();

  // =====================================================
  // ROLE MANAGEMENT ENDPOINTS
  // =====================================================

  /**
   * GET /api/rbac/roles
   * Get all available roles
   */
  router.get('/api/rbac/roles', requireTenantPool, requirePermission('role:read'), async (req: Request, res: Response) => {
    const tenantPool = (req as any).tenantPool;

    try {
      const roles = await RBACService.getAllRoles(tenantPool);
      res.json(roles);
    } catch (error) {
      console.error('Failed to fetch roles', error);
      res.status(500).json(
        createErrorResponse('errors.apiServerError', req, 'Failed to fetch roles')
      );
    }
  });

  /**
   * GET /api/rbac/roles/:roleName
   * Get a specific role with its permissions
   */
  router.get('/api/rbac/roles/:roleName', requireTenantPool, requirePermission('role:read'), async (req: Request, res: Response) => {
    const tenantPool = (req as any).tenantPool;
    const roleName = getSingleParam(req.params.roleName);

    if (!roleName) {
      return res.status(400).json(
        createErrorResponse('errors.invalidInput', req, 'Role name is required')
      );
    }

    try {
      const role = await RBACService.getRoleWithPermissions(tenantPool, roleName);
      
      if (!role) {
        return res.status(404).json(
          createErrorResponse('errors.roleNotFound', req, 'Role not found')
        );
      }

      res.json(role);
    } catch (error) {
      console.error('Failed to fetch role', error);
      res.status(500).json(
        createErrorResponse('errors.apiServerError', req, 'Failed to fetch role')
      );
    }
  });

  /**
   * POST /api/rbac/roles
   * Create a new custom role
   */
  router.post('/api/rbac/roles', requireTenantPool, requirePermission('role:create'), async (req: Request, res: Response) => {
    const tenantPool = (req as any).tenantPool;
    const { name, displayName, description } = req.body;

    if (!name || !displayName) {
      return res.status(400).json(
        createErrorResponse('errors.invalidInput', req, 'Role name and display name are required')
      );
    }

    // Validate role name format (uppercase, alphanumeric + underscore)
    if (!/^[A-Z_]+$/.test(name)) {
      return res.status(400).json(
        createErrorResponse('errors.invalidInput', req, 'Role name must be uppercase letters and underscores only')
      );
    }

    try {
      const role = await RBACService.createRole(tenantPool, name, displayName, description);
      res.status(201).json(role);
    } catch (error: any) {
      console.error('Failed to create role', error);
      
      if (error.code === '23505') { // Unique violation
        return res.status(409).json(
          createErrorResponse('errors.roleExists', req, 'A role with this name already exists')
        );
      }

      res.status(500).json(
        createErrorResponse('errors.apiServerError', req, 'Failed to create role')
      );
    }
  });

  /**
   * POST /api/rbac/roles/:roleName/permissions
   * Add a permission to a role
   */
  router.post('/api/rbac/roles/:roleName/permissions', requireTenantPool, requirePermission('role:update'), async (req: Request, res: Response) => {
    const tenantPool = (req as any).tenantPool;
    const roleName = getSingleParam(req.params.roleName);
    const { permissionName } = req.body;

    if (!roleName) {
      return res.status(400).json(
        createErrorResponse('errors.invalidInput', req, 'Role name is required')
      );
    }

    if (!permissionName) {
      return res.status(400).json(
        createErrorResponse('errors.invalidInput', req, 'Permission name is required')
      );
    }

    try {
      await RBACService.addPermissionToRole(tenantPool, roleName, permissionName);
      res.status(200).json({ message: 'Permission added to role successfully' });
    } catch (error) {
      console.error('Failed to add permission to role', error);
      res.status(500).json(
        createErrorResponse('errors.apiServerError', req, 'Failed to add permission to role')
      );
    }
  });

  /**
   * DELETE /api/rbac/roles/:roleName/permissions/:permissionName
   * Remove a permission from a role
   */
  router.delete('/api/rbac/roles/:roleName/permissions/:permissionName', requireTenantPool, requirePermission('role:update'), async (req: Request, res: Response) => {
    const tenantPool = (req as any).tenantPool;
    const roleName = getSingleParam(req.params.roleName);
    const permissionName = getSingleParam(req.params.permissionName);

    if (!roleName || !permissionName) {
      return res.status(400).json(
        createErrorResponse('errors.invalidInput', req, 'Role name and permission name are required')
      );
    }

    try {
      await RBACService.removePermissionFromRole(tenantPool, roleName, permissionName);
      res.status(200).json({ message: 'Permission removed from role successfully' });
    } catch (error) {
      console.error('Failed to remove permission from role', error);
      res.status(500).json(
        createErrorResponse('errors.apiServerError', req, 'Failed to remove permission from role')
      );
    }
  });

  // =====================================================
  // PERMISSION MANAGEMENT ENDPOINTS
  // =====================================================

  /**
   * GET /api/rbac/permissions
   * Get all available permissions
   */
  router.get('/api/rbac/permissions', requireTenantPool, requirePermission('role:read'), async (req: Request, res: Response) => {
    const tenantPool = (req as any).tenantPool;

    try {
      const permissions = await RBACService.getAllPermissions(tenantPool);
      res.json(permissions);
    } catch (error) {
      console.error('Failed to fetch permissions', error);
      res.status(500).json(
        createErrorResponse('errors.apiServerError', req, 'Failed to fetch permissions')
      );
    }
  });

  // =====================================================
  // USER ROLE ASSIGNMENT ENDPOINTS
  // =====================================================

  /**
   * GET /api/rbac/users/:userId/roles
   * Get all roles for a specific user
   */
  router.get('/api/rbac/users/:userId/roles', requireTenantPool, requirePermission('user:read'), async (req: Request, res: Response) => {
    const tenantPool = (req as any).tenantPool;
    const userId = getSingleParam(req.params.userId);

    if (!userId) {
      return res.status(400).json(
        createErrorResponse('errors.invalidInput', req, 'User ID is required')
      );
    }

    try {
      const roles = await RBACService.getUserRoles(tenantPool, userId);
      res.json(roles);
    } catch (error) {
      console.error('Failed to fetch user roles', error);
      res.status(500).json(
        createErrorResponse('errors.apiServerError', req, 'Failed to fetch user roles')
      );
    }
  });

  /**
   * GET /api/rbac/users/:userId/permissions
   * Get all permissions for a specific user
   */
  router.get('/api/rbac/users/:userId/permissions', requireTenantPool, requirePermission('user:read'), async (req: Request, res: Response) => {
    const tenantPool = (req as any).tenantPool;
    const userId = getSingleParam(req.params.userId);

    if (!userId) {
      return res.status(400).json(
        createErrorResponse('errors.invalidInput', req, 'User ID is required')
      );
    }

    try {
      const permissions = await RBACService.getUserPermissions(tenantPool, userId);
      res.json(permissions);
    } catch (error) {
      console.error('Failed to fetch user permissions', error);
      res.status(500).json(
        createErrorResponse('errors.apiServerError', req, 'Failed to fetch user permissions')
      );
    }
  });

  /**
   * POST /api/rbac/users/:userId/roles
   * Assign a role to a user
   */
  router.post('/api/rbac/users/:userId/roles', requireTenantPool, requirePermission('role:assign'), async (req: Request, res: Response) => {
    const tenantPool = (req as any).tenantPool;
    const userId = getSingleParam(req.params.userId);
    const { roleName, expiresAt } = req.body;
    const assignedBy = (req as any).userId;

    if (!userId) {
      return res.status(400).json(
        createErrorResponse('errors.invalidInput', req, 'User ID is required')
      );
    }

    if (!roleName) {
      return res.status(400).json(
        createErrorResponse('errors.invalidInput', req, 'Role name is required')
      );
    }

    try {
      const expirationDate = expiresAt ? new Date(expiresAt) : undefined;
      await RBACService.assignRoleToUser(tenantPool, userId, roleName, assignedBy, expirationDate);
      res.status(200).json({ message: 'Role assigned to user successfully' });
    } catch (error: any) {
      console.error('Failed to assign role to user', error);

      if (error.code === '23503') { // Foreign key violation
        return res.status(404).json(
          createErrorResponse('errors.notFound', req, 'User or role not found')
        );
      }

      res.status(500).json(
        createErrorResponse('errors.apiServerError', req, 'Failed to assign role to user')
      );
    }
  });

  /**
   * DELETE /api/rbac/users/:userId/roles/:roleName
   * Remove a role from a user
   */
  router.delete('/api/rbac/users/:userId/roles/:roleName', requireTenantPool, requirePermission('role:assign'), async (req: Request, res: Response) => {
    const tenantPool = (req as any).tenantPool;
    const userId = getSingleParam(req.params.userId);
    const roleName = getSingleParam(req.params.roleName);

    if (!userId || !roleName) {
      return res.status(400).json(
        createErrorResponse('errors.invalidInput', req, 'User ID and role name are required')
      );
    }

    try {
      await RBACService.removeRoleFromUser(tenantPool, userId, roleName);
      res.status(200).json({ message: 'Role removed from user successfully' });
    } catch (error) {
      console.error('Failed to remove role from user', error);
      res.status(500).json(
        createErrorResponse('errors.apiServerError', req, 'Failed to remove role from user')
      );
    }
  });

  // =====================================================
  // CURRENT USER ENDPOINTS (No special permissions required)
  // =====================================================

  /**
   * GET /api/rbac/me/roles
   * Get current user's roles
   */
  router.get('/api/rbac/me/roles', requireTenantPool, async (req: Request, res: Response) => {
    const tenantPool = (req as any).tenantPool;
    const userId = (req as any).userId;

    if (!userId) {
      return res.status(401).json(
        createErrorResponse('errors.authRequired', req, 'Authentication required')
      );
    }

    try {
      const roles = await RBACService.getUserRoles(tenantPool, userId);
      res.json(roles);
    } catch (error) {
      console.error('Failed to fetch user roles', error);
      res.status(500).json(
        createErrorResponse('errors.apiServerError', req, 'Failed to fetch user roles')
      );
    }
  });

  /**
   * GET /api/rbac/me/permissions
   * Get current user's permissions
   */
  router.get('/api/rbac/me/permissions', requireTenantPool, async (req: Request, res: Response) => {
    const tenantPool = (req as any).tenantPool;
    const userId = (req as any).userId;

    if (!userId) {
      return res.status(401).json(
        createErrorResponse('errors.authRequired', req, 'Authentication required')
      );
    }

    try {
      const permissions = await RBACService.getUserPermissions(tenantPool, userId);
      res.json(permissions);
    } catch (error) {
      console.error('Failed to fetch user permissions', error);
      res.status(500).json(
        createErrorResponse('errors.apiServerError', req, 'Failed to fetch user permissions')
      );
    }
  });

  /**
   * POST /api/rbac/me/check-permission
   * Check if current user has a specific permission
   */
  router.post('/api/rbac/me/check-permission', requireTenantPool, async (req: Request, res: Response) => {
    const tenantPool = (req as any).tenantPool;
    const userId = (req as any).userId;
    const { permission } = req.body;

    if (!userId) {
      return res.status(401).json(
        createErrorResponse('errors.authRequired', req, 'Authentication required')
      );
    }

    if (!permission) {
      return res.status(400).json(
        createErrorResponse('errors.invalidInput', req, 'Permission name is required')
      );
    }

    try {
      const hasPermission = await RBACService.userHasPermission(tenantPool, userId, permission);
      res.json({ hasPermission, permission });
    } catch (error) {
      console.error('Failed to check permission', error);
      res.status(500).json(
        createErrorResponse('errors.apiServerError', req, 'Failed to check permission')
      );
    }
  });

  return router;
};
