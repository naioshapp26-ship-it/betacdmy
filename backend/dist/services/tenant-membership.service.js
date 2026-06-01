import pool from '../../../db/pool.js';
import { centralPool } from '../central-db.js';
import { getTenantPool } from './db-manager.js';
const ALLOWED_TENANT_ROLES = new Set(['STUDENT', 'INSTRUCTOR', 'ADMIN']);
const normalizeRole = (role) => {
    if (!role)
        return 'STUDENT';
    const upper = role.toUpperCase();
    return ALLOWED_TENANT_ROLES.has(upper) ? upper : 'STUDENT';
};
export class TenantMembershipService {
    async assignUser(input) {
        const role = normalizeRole(input.role);
        const platformUser = await this.lookupPlatformUser(input);
        if (!platformUser) {
            throw Object.assign(new Error('platform_user_not_found'), { statusCode: 404 });
        }
        const tenantPool = await getTenantPool(input.tenant);
        const normalizedEmail = platformUser.email?.toLowerCase() || '';
        const existingUser = normalizedEmail
            ? await tenantPool.query('SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1', [normalizedEmail])
            : { rows: [] };
        const tenantUserId = existingUser.rows[0]?.id || platformUser.id;
        if (existingUser.rows.length > 0) {
            await tenantPool.query(`UPDATE users
         SET name = $2,
             email = $3,
             role = $4,
             avatar = $5,
             status = $6,
             phone = $7,
             join_date = COALESCE(join_date, $8),
             last_active = COALESCE($9, last_active),
             plan = COALESCE($10, plan)
         WHERE id = $1`, [
                tenantUserId,
                platformUser.name,
                platformUser.email,
                role,
                platformUser.avatar,
                platformUser.status,
                platformUser.phone,
                platformUser.join_date,
                platformUser.last_active,
                platformUser.plan
            ]);
        }
        else {
            await tenantPool.query(`INSERT INTO users (id, name, email, password, role, avatar, status, phone, join_date, last_active, plan)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           email = EXCLUDED.email,
           role = EXCLUDED.role,
           status = EXCLUDED.status,
           last_active = EXCLUDED.last_active,
           plan = EXCLUDED.plan`, [
                tenantUserId,
                platformUser.name,
                platformUser.email,
                platformUser.password,
                role,
                platformUser.avatar,
                platformUser.status,
                platformUser.phone,
                platformUser.join_date,
                platformUser.last_active,
                platformUser.plan
            ]);
        }
        const link = await centralPool.query(`INSERT INTO tenant_user_links (tenant_id, platform_user_id, tenant_user_id, role, status)
         VALUES ($1,$2,$3,$4,'active')
       ON CONFLICT (tenant_id, platform_user_id)
       DO UPDATE SET role = EXCLUDED.role, status = 'active', revoked_at = NULL, tenant_user_id = EXCLUDED.tenant_user_id
       RETURNING id, tenant_id, platform_user_id, tenant_user_id, role, status, created_at, updated_at`, [input.tenant.id, platformUser.id, tenantUserId, role]);
        return {
            link: link.rows[0],
            platformUser,
            role
        };
    }
    async revokeUser(input) {
        const linkResult = await centralPool.query(`SELECT id, tenant_user_id
         FROM tenant_user_links
        WHERE tenant_id = $1 AND platform_user_id = $2 AND status = 'active'
        LIMIT 1`, [input.tenant.id, input.platformUserId]);
        if (!linkResult.rowCount) {
            throw Object.assign(new Error('assignment_not_found'), { statusCode: 404 });
        }
        const tenantPool = await getTenantPool(input.tenant);
        const targetId = linkResult.rows[0].tenant_user_id || input.platformUserId;
        await tenantPool.query(`DELETE FROM users WHERE id = $1`, [targetId]);
        await centralPool.query(`UPDATE tenant_user_links
         SET status = 'revoked', revoked_at = NOW()
       WHERE id = $1`, [linkResult.rows[0].id]);
        return { revoked: true };
    }
    async lookupPlatformUser({ platformUserId, email }) {
        const clauses = [];
        const values = [];
        if (platformUserId) {
            values.push(platformUserId);
            clauses.push(`id = $${values.length}`);
        }
        if (email) {
            values.push(email.toLowerCase());
            clauses.push(`LOWER(email) = $${values.length}`);
        }
        if (!clauses.length) {
            throw Object.assign(new Error('missing_user_identifier'), { statusCode: 400 });
        }
        const result = await pool.query(`SELECT id, email, name, password, role, avatar, status, phone, join_date, last_active, plan
         FROM users
        WHERE ${clauses.join(' OR ')}
        LIMIT 1`, values);
        return result.rows[0] || null;
    }
}
