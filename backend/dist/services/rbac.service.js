/**
 * RBAC Service for Role-Based Access Control
 * Handles role and permission management operations
 */
export class RBACService {
    /**
     * Check if a user has a specific permission
     */
    static async userHasPermission(pool, userId, permissionName) {
        const result = await pool.query('SELECT user_has_permission($1, $2) as has_permission', [userId, permissionName]);
        return result.rows[0]?.has_permission ?? false;
    }
    /**
     * Check if a user has ANY of the specified permissions
     */
    static async userHasAnyPermission(pool, userId, permissionNames) {
        if (!permissionNames.length)
            return false;
        const result = await pool.query(`SELECT COUNT(*) as count
       FROM user_roles ur
       JOIN role_permissions rp ON ur.role_id = rp.role_id
       JOIN permissions p ON rp.permission_id = p.id
       WHERE ur.user_id = $1
         AND ur.is_active = true
         AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
         AND p.name = ANY($2::text[])`, [userId, permissionNames]);
        return parseInt(result.rows[0]?.count || '0') > 0;
    }
    /**
     * Check if a user has ALL of the specified permissions
     */
    static async userHasAllPermissions(pool, userId, permissionNames) {
        if (!permissionNames.length)
            return false;
        const result = await pool.query(`SELECT COUNT(DISTINCT p.name) as count
       FROM user_roles ur
       JOIN role_permissions rp ON ur.role_id = rp.role_id
       JOIN permissions p ON rp.permission_id = p.id
       WHERE ur.user_id = $1
         AND ur.is_active = true
         AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
         AND p.name = ANY($2::text[])`, [userId, permissionNames]);
        return parseInt(result.rows[0]?.count || '0') === permissionNames.length;
    }
    /**
     * Get all permissions for a user
     */
    static async getUserPermissions(pool, userId) {
        const result = await pool.query('SELECT * FROM get_user_permissions($1)', [userId]);
        return result.rows;
    }
    /**
     * Get all roles for a user
     */
    static async getUserRoles(pool, userId) {
        const result = await pool.query('SELECT * FROM get_user_roles($1)', [userId]);
        return result.rows;
    }
    /**
     * Assign a role to a user
     */
    static async assignRoleToUser(pool, userId, roleName, assignedBy, expiresAt) {
        await pool.query(`INSERT INTO user_roles (user_id, role_id, assigned_by, expires_at)
       SELECT $1, id, $3, $4
       FROM roles
       WHERE name = $2
       ON CONFLICT (user_id, role_id) 
       DO UPDATE SET 
         is_active = true,
         assigned_by = EXCLUDED.assigned_by,
         expires_at = EXCLUDED.expires_at,
         updated_at = NOW()`, [userId, roleName, assignedBy, expiresAt]);
    }
    /**
     * Remove a role from a user
     */
    static async removeRoleFromUser(pool, userId, roleName) {
        await pool.query(`UPDATE user_roles ur
       SET is_active = false, updated_at = NOW()
       FROM roles r
       WHERE ur.role_id = r.id
         AND ur.user_id = $1
         AND r.name = $2`, [userId, roleName]);
    }
    /**
     * Get all available roles
     */
    static async getAllRoles(pool) {
        const result = await pool.query(`SELECT id, name, display_name, description, is_system, is_active
       FROM roles
       WHERE is_active = true
       ORDER BY name`);
        return result.rows;
    }
    /**
     * Get a role with its permissions
     */
    static async getRoleWithPermissions(pool, roleName) {
        const roleResult = await pool.query('SELECT * FROM roles WHERE name = $1 AND is_active = true', [roleName]);
        if (!roleResult.rows.length)
            return null;
        const role = roleResult.rows[0];
        const permissionsResult = await pool.query(`SELECT p.*
       FROM permissions p
       JOIN role_permissions rp ON p.id = rp.permission_id
       WHERE rp.role_id = $1
       ORDER BY p.resource, p.action`, [role.id]);
        return {
            ...role,
            permissions: permissionsResult.rows
        };
    }
    /**
     * Create a new role
     */
    static async createRole(pool, name, displayName, description) {
        const result = await pool.query(`INSERT INTO roles (name, display_name, description, is_system)
       VALUES ($1, $2, $3, false)
       RETURNING *`, [name, displayName, description]);
        return result.rows[0];
    }
    /**
     * Add a permission to a role
     */
    static async addPermissionToRole(pool, roleName, permissionName) {
        await pool.query(`INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id
       FROM roles r
       CROSS JOIN permissions p
       WHERE r.name = $1 AND p.name = $2
       ON CONFLICT (role_id, permission_id) DO NOTHING`, [roleName, permissionName]);
    }
    /**
     * Remove a permission from a role
     */
    static async removePermissionFromRole(pool, roleName, permissionName) {
        await pool.query(`DELETE FROM role_permissions
       WHERE role_id = (SELECT id FROM roles WHERE name = $1)
         AND permission_id = (SELECT id FROM permissions WHERE name = $2)`, [roleName, permissionName]);
    }
    /**
     * Get all available permissions
     */
    static async getAllPermissions(pool) {
        const result = await pool.query(`SELECT id, name, resource, action, description
       FROM permissions
       ORDER BY resource, action`);
        return result.rows;
    }
    /**
     * Check if a user has a specific role
     */
    static async userHasRole(pool, userId, roleName) {
        const result = await pool.query(`SELECT EXISTS (
         SELECT 1
         FROM user_roles ur
         JOIN roles r ON ur.role_id = r.id
         WHERE ur.user_id = $1
           AND r.name = $2
           AND ur.is_active = true
           AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
       ) as exists`, [userId, roleName]);
        return result.rows[0]?.exists ?? false;
    }
    /**
     * Get permission by resource and action
     */
    static async getPermissionByResourceAction(pool, resource, action) {
        const result = await pool.query(`SELECT * FROM permissions WHERE resource = $1 AND action = $2`, [resource, action]);
        return result.rows[0] || null;
    }
}
