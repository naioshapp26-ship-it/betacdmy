import bcrypt from 'bcrypt';
import { centralPool } from '../central-db.js';
import { getTenantPool } from './db-manager.js';
import { getDemoAccount, isDemoLoginEnabled } from '../utils/demo-auth-config.js';

const SALT_ROUNDS = 10;

const hashPassword = (password: string) => bcrypt.hash(password, SALT_ROUNDS);

/**
 * Upsert a platform (central) user for demo login when the site runs without a tenant.
 * Never modifies emails other than the configured demo addresses.
 */
const upsertPlatformUser = async (opts: {
  email: string;
  name: string;
  role: 'ADMIN' | 'STUDENT';
  passwordHash: string;
}) => {
  const existing = await centralPool.query(
    `SELECT id, role FROM users WHERE LOWER(email) = LOWER($1)`,
    [opts.email]
  );

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    if (String(row.role || '').toUpperCase() !== opts.role) {
      throw new Error(
        `Refusing to overwrite platform user ${opts.email} with role ${row.role} (wanted ${opts.role})`
      );
    }
    await centralPool.query(
      `UPDATE users
       SET name = $1,
           password_hash = $2,
           password = NULL,
           status = COALESCE(NULLIF(status, ''), 'Active'),
           last_active = NOW(),
           updated_at = NOW()
       WHERE id = $3`,
      [opts.name, opts.passwordHash, row.id]
    );
    return { id: row.id, action: 'updated' as const };
  }

  const inserted = await centralPool.query(
    `INSERT INTO users
       (name, email, password_hash, role, status, join_date, last_active, plan, credits, streak)
     VALUES
       ($1, $2, $3, $4, 'Active', CURRENT_DATE, NOW(), 'Free', 0, 0)
     RETURNING id`,
    [opts.name, opts.email, opts.passwordHash, opts.role]
  );
  return { id: inserted.rows[0].id, action: 'created' as const };
};

const upsertTenantAdmin = async (
  tenantId: string,
  email: string,
  passwordHash: string,
  firstName: string,
  lastName: string
) => {
  const existing = await centralPool.query(
    `SELECT id FROM tenant_admins WHERE tenant_id = $1 AND LOWER(email) = LOWER($2)`,
    [tenantId, email]
  );
  if (existing.rows.length > 0) {
    await centralPool.query(
      `UPDATE tenant_admins
       SET password_hash = $1, password = NULL, first_name = $2, last_name = $3
       WHERE id = $4`,
      [passwordHash, firstName, lastName, existing.rows[0].id]
    );
    return { action: 'updated' as const };
  }
  await centralPool.query(
    `INSERT INTO tenant_admins
       (tenant_id, email, password_hash, first_name, last_name, is_primary)
     VALUES ($1, $2, $3, $4, $5, false)`,
    [tenantId, email, passwordHash, firstName, lastName]
  );
  return { action: 'created' as const };
};

const upsertTenantUser = async (
  tenantPool: Awaited<ReturnType<typeof getTenantPool>>,
  opts: { email: string; name: string; role: 'ADMIN' | 'STUDENT'; passwordHash: string }
) => {
  const existing = await tenantPool.query(
    `SELECT id, role FROM users WHERE LOWER(email) = LOWER($1)`,
    [opts.email]
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    if (String(row.role || '').toUpperCase() !== opts.role) {
      throw new Error(
        `Refusing to overwrite tenant user ${opts.email} with role ${row.role} (wanted ${opts.role})`
      );
    }
    await tenantPool.query(
      `UPDATE users
       SET name = $1, password_hash = $2, password = NULL,
           status = COALESCE(status, 'Active'), last_active = NOW()
       WHERE id = $3`,
      [opts.name, opts.passwordHash, row.id]
    );
    return { action: 'updated' as const };
  }
  await tenantPool.query(
    `INSERT INTO users
       (name, email, password_hash, role, status, join_date, last_active, plan, credits, streak, enrolled_courses)
     VALUES
       ($1, $2, $3, $4, 'Active', CURRENT_DATE, NOW(), 'Free', 0, 0, ARRAY[]::UUID[])`,
    [opts.name, opts.email, opts.passwordHash, opts.role]
  );
  return { action: 'created' as const };
};

/**
 * Ensure demo Admin + Customer accounts exist when demo login is enabled.
 * Safe to call on every boot / demo-login — idempotent and scoped to demo emails only.
 */
export const ensureDemoAccounts = async (): Promise<void> => {
  if (!isDemoLoginEnabled()) {
    console.info('[demo-accounts] Skipped (demo login disabled)');
    return;
  }

  const admin = getDemoAccount('ADMIN');
  const student = getDemoAccount('STUDENT');

  if (admin.email === student.email) {
    console.warn('[demo-accounts] Admin and student emails must differ — skipping seed');
    return;
  }

  const adminHash = await hashPassword(admin.password);
  const studentHash = await hashPassword(student.password);

  const adminPlatform = await upsertPlatformUser({
    email: admin.email,
    name: admin.name,
    role: 'ADMIN',
    passwordHash: adminHash
  });
  console.info(`[demo-accounts] platform ADMIN ${adminPlatform.action}: ${admin.email}`);

  const studentPlatform = await upsertPlatformUser({
    email: student.email,
    name: student.name,
    role: 'STUDENT',
    passwordHash: studentHash
  });
  console.info(`[demo-accounts] platform STUDENT ${studentPlatform.action}: ${student.email}`);

  const subdomain = (process.env.TENANT_SUBDOMAIN || '').trim().toLowerCase();
  if (!subdomain) {
    return;
  }

  const tenantResult = await centralPool.query(
    `SELECT id, subdomain, company_name, status, subscription_plan, database_url_encrypted, database_name
     FROM tenants
     WHERE LOWER(subdomain) = LOWER($1) AND status = 'active'`,
    [subdomain]
  );

  if (!tenantResult.rows.length) {
    console.warn(`[demo-accounts] Tenant "${subdomain}" not found/active — platform accounts only`);
    return;
  }

  const tenant = tenantResult.rows[0];
  const tenantPool = await getTenantPool(tenant);
  const [firstName, ...rest] = admin.name.split(' ');
  await upsertTenantAdmin(tenant.id, admin.email, adminHash, firstName || 'Demo', rest.join(' ') || 'Admin');
  await upsertTenantUser(tenantPool, {
    email: admin.email,
    name: admin.name,
    role: 'ADMIN',
    passwordHash: adminHash
  });
  await upsertTenantUser(tenantPool, {
    email: student.email,
    name: student.name,
    role: 'STUDENT',
    passwordHash: studentHash
  });
  console.info(`[demo-accounts] tenant "${subdomain}" demo accounts ensured`);
};
