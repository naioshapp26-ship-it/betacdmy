import bcrypt from 'bcrypt';
import { centralPool } from '../central-db.js';
import { getTenantPool } from './db-manager.js';
const SALT_ROUNDS = 10;
const isEnabled = () => {
    const flag = (process.env.DEMO_LOGIN_ENABLED || '').toLowerCase();
    return flag === 'true' || flag === '1' || flag === 'yes';
};
const hashPassword = (password) => bcrypt.hash(password, SALT_ROUNDS);
/**
 * Upsert a platform (central) user for demo login when the site runs without a tenant.
 * Never modifies emails other than the configured demo addresses.
 */
const upsertPlatformUser = async (opts) => {
    const existing = await centralPool.query(`SELECT id, role FROM users WHERE LOWER(email) = LOWER($1)`, [opts.email]);
    if (existing.rows.length > 0) {
        const row = existing.rows[0];
        if (String(row.role || '').toUpperCase() !== opts.role) {
            throw new Error(`Refusing to overwrite platform user ${opts.email} with role ${row.role} (wanted ${opts.role})`);
        }
        await centralPool.query(`UPDATE users
       SET name = $1,
           password_hash = $2,
           password = NULL,
           status = COALESCE(NULLIF(status, ''), 'Active'),
           last_active = NOW(),
           updated_at = NOW()
       WHERE id = $3`, [opts.name, opts.passwordHash, row.id]);
        return { id: row.id, action: 'updated' };
    }
    const inserted = await centralPool.query(`INSERT INTO users
       (name, email, password_hash, role, status, join_date, last_active, plan, credits, streak)
     VALUES
       ($1, $2, $3, $4, 'Active', CURRENT_DATE, NOW(), 'Free', 0, 0)
     RETURNING id`, [opts.name, opts.email, opts.passwordHash, opts.role]);
    return { id: inserted.rows[0].id, action: 'created' };
};
const upsertTenantAdmin = async (tenantId, email, passwordHash, firstName, lastName) => {
    const existing = await centralPool.query(`SELECT id FROM tenant_admins WHERE tenant_id = $1 AND LOWER(email) = LOWER($2)`, [tenantId, email]);
    if (existing.rows.length > 0) {
        await centralPool.query(`UPDATE tenant_admins
       SET password_hash = $1, password = NULL, first_name = $2, last_name = $3
       WHERE id = $4`, [passwordHash, firstName, lastName, existing.rows[0].id]);
        return { action: 'updated' };
    }
    await centralPool.query(`INSERT INTO tenant_admins
       (tenant_id, email, password_hash, first_name, last_name, is_primary)
     VALUES ($1, $2, $3, $4, $5, false)`, [tenantId, email, passwordHash, firstName, lastName]);
    return { action: 'created' };
};
const upsertTenantUser = async (tenantPool, opts) => {
    const existing = await tenantPool.query(`SELECT id, role FROM users WHERE LOWER(email) = LOWER($1)`, [opts.email]);
    if (existing.rows.length > 0) {
        const row = existing.rows[0];
        if (String(row.role || '').toUpperCase() !== opts.role) {
            throw new Error(`Refusing to overwrite tenant user ${opts.email} with role ${row.role} (wanted ${opts.role})`);
        }
        await tenantPool.query(`UPDATE users
       SET name = $1, password_hash = $2, password = NULL,
           status = COALESCE(status, 'Active'), last_active = NOW()
       WHERE id = $3`, [opts.name, opts.passwordHash, row.id]);
        return { action: 'updated' };
    }
    await tenantPool.query(`INSERT INTO users
       (name, email, password_hash, role, status, join_date, last_active, plan, credits, streak, enrolled_courses)
     VALUES
       ($1, $2, $3, $4, 'Active', CURRENT_DATE, NOW(), 'Free', 0, 0, ARRAY[]::UUID[])`, [opts.name, opts.email, opts.passwordHash, opts.role]);
    return { action: 'created' };
};
/**
 * Ensure demo Admin + Customer accounts exist when DEMO_LOGIN_ENABLED is on.
 * Safe to call on every boot — idempotent and scoped to DEMO_* emails only.
 */
export const ensureDemoAccounts = async () => {
    if (!isEnabled()) {
        console.info('[demo-accounts] Skipped (DEMO_LOGIN_ENABLED is not true)');
        return;
    }
    const adminEmail = (process.env.DEMO_ADMIN_EMAIL || '').trim().toLowerCase();
    const studentEmail = (process.env.DEMO_STUDENT_EMAIL || '').trim().toLowerCase();
    const adminPassword = process.env.DEMO_ADMIN_PASSWORD || '';
    const studentPassword = process.env.DEMO_STUDENT_PASSWORD || '';
    if (!adminEmail || !studentEmail || !adminPassword || !studentPassword) {
        console.warn('[demo-accounts] DEMO_LOGIN_ENABLED is true but DEMO_ADMIN_*/DEMO_STUDENT_* are incomplete — skipping seed');
        return;
    }
    if (adminEmail === studentEmail) {
        console.warn('[demo-accounts] Admin and student emails must differ — skipping seed');
        return;
    }
    const adminHash = await hashPassword(adminPassword);
    const studentHash = await hashPassword(studentPassword);
    const adminName = `${process.env.DEMO_ADMIN_FIRST_NAME || 'Demo'} ${process.env.DEMO_ADMIN_LAST_NAME || 'Admin'}`.trim();
    const studentName = process.env.DEMO_STUDENT_NAME || 'Demo Customer';
    // Platform users: required for www.naioshacademy.com which currently resolves as the main site.
    const adminPlatform = await upsertPlatformUser({
        email: adminEmail,
        name: adminName,
        role: 'ADMIN',
        passwordHash: adminHash
    });
    console.info(`[demo-accounts] platform ADMIN ${adminPlatform.action}: ${adminEmail}`);
    const studentPlatform = await upsertPlatformUser({
        email: studentEmail,
        name: studentName,
        role: 'STUDENT',
        passwordHash: studentHash
    });
    console.info(`[demo-accounts] platform STUDENT ${studentPlatform.action}: ${studentEmail}`);
    const subdomain = (process.env.TENANT_SUBDOMAIN || '').trim().toLowerCase();
    if (!subdomain) {
        return;
    }
    const tenantResult = await centralPool.query(`SELECT id, subdomain, company_name, status, subscription_plan, database_url_encrypted, database_name
     FROM tenants
     WHERE LOWER(subdomain) = LOWER($1) AND status = 'active'`, [subdomain]);
    if (!tenantResult.rows.length) {
        console.warn(`[demo-accounts] Tenant "${subdomain}" not found/active — platform accounts only`);
        return;
    }
    const tenant = tenantResult.rows[0];
    const tenantPool = await getTenantPool(tenant);
    await upsertTenantAdmin(tenant.id, adminEmail, adminHash, process.env.DEMO_ADMIN_FIRST_NAME || 'Demo', process.env.DEMO_ADMIN_LAST_NAME || 'Admin');
    await upsertTenantUser(tenantPool, {
        email: adminEmail,
        name: adminName,
        role: 'ADMIN',
        passwordHash: adminHash
    });
    await upsertTenantUser(tenantPool, {
        email: studentEmail,
        name: studentName,
        role: 'STUDENT',
        passwordHash: studentHash
    });
    console.info(`[demo-accounts] tenant "${subdomain}" demo accounts ensured`);
};
