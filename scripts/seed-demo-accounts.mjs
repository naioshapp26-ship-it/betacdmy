/**
 * Seed isolated demo Admin + Customer (STUDENT) accounts for a tenant.
 *
 * Secrets MUST come from environment variables — never commit passwords.
 *
 * Required:
 *   CENTRAL_DATABASE_URL or DATABASE_URL
 *   DEMO_ADMIN_PASSWORD
 *   DEMO_STUDENT_PASSWORD
 *
 * Optional:
 *   TENANT_SUBDOMAIN          (default: naiosh)
 *   DEMO_ADMIN_EMAIL          (default: demo-admin@naiosh.local)
 *   DEMO_STUDENT_EMAIL        (default: demo-customer@naiosh.local)
 *   DEMO_ADMIN_FIRST_NAME     (default: Demo)
 *   DEMO_ADMIN_LAST_NAME      (default: Admin)
 *   DEMO_STUDENT_NAME         (default: Demo Customer)
 *   TENANT_DB_ENCRYPTION_KEY / JWT_SECRET  (to decrypt tenant DB URL)
 *
 * Usage:
 *   node scripts/seed-demo-accounts.mjs
 */
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

const SALT_ROUNDS = 10;

const required = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const CENTRAL_DATABASE_URL =
  process.env.CENTRAL_DATABASE_URL || process.env.DATABASE_URL;
if (!CENTRAL_DATABASE_URL) {
  throw new Error('Set CENTRAL_DATABASE_URL or DATABASE_URL');
}

const TENANT_SUBDOMAIN = (process.env.TENANT_SUBDOMAIN || 'naiosh').toLowerCase();
const DEMO_ADMIN_EMAIL = (process.env.DEMO_ADMIN_EMAIL || 'demo-admin@naiosh.local').toLowerCase();
const DEMO_STUDENT_EMAIL = (
  process.env.DEMO_STUDENT_EMAIL || 'demo-customer@naiosh.local'
).toLowerCase();
const DEMO_ADMIN_PASSWORD = required('DEMO_ADMIN_PASSWORD');
const DEMO_STUDENT_PASSWORD = required('DEMO_STUDENT_PASSWORD');
const DEMO_ADMIN_FIRST_NAME = process.env.DEMO_ADMIN_FIRST_NAME || 'Demo';
const DEMO_ADMIN_LAST_NAME = process.env.DEMO_ADMIN_LAST_NAME || 'Admin';
const DEMO_STUDENT_NAME = process.env.DEMO_STUDENT_NAME || 'Demo Customer';

if (DEMO_ADMIN_EMAIL === DEMO_STUDENT_EMAIL) {
  throw new Error('DEMO_ADMIN_EMAIL and DEMO_STUDENT_EMAIL must be different');
}

process.env.CENTRAL_DATABASE_URL ||= CENTRAL_DATABASE_URL;
process.env.DATABASE_URL ||= CENTRAL_DATABASE_URL;
process.env.TENANT_DB_ENCRYPTION_KEY ||=
  process.env.JWT_SECRET || randomBytes(16).toString('hex');
process.env.JWT_SECRET ||= 'demo-seed-jwt-secret';

const { centralPool } = await import('../backend/dist/central-db.js');
const { getTenantPool, clearAllPools } = await import(
  '../backend/dist/services/db-manager.js'
);

const hash = async (password) => bcrypt.hash(password, SALT_ROUNDS);

const upsertTenantAdmin = async (tenantId, passwordHash) => {
  const existing = await centralPool.query(
    `SELECT id FROM tenant_admins WHERE tenant_id = $1 AND LOWER(email) = LOWER($2)`,
    [tenantId, DEMO_ADMIN_EMAIL]
  );

  if (existing.rows.length > 0) {
    await centralPool.query(
      `UPDATE tenant_admins
       SET password_hash = $1,
           password = NULL,
           first_name = $2,
           last_name = $3
       WHERE id = $4`,
      [passwordHash, DEMO_ADMIN_FIRST_NAME, DEMO_ADMIN_LAST_NAME, existing.rows[0].id]
    );
    return { id: existing.rows[0].id, action: 'updated' };
  }

  const inserted = await centralPool.query(
    `INSERT INTO tenant_admins
       (tenant_id, email, password_hash, first_name, last_name, is_primary)
     VALUES ($1, $2, $3, $4, $5, false)
     RETURNING id`,
    [tenantId, DEMO_ADMIN_EMAIL, passwordHash, DEMO_ADMIN_FIRST_NAME, DEMO_ADMIN_LAST_NAME]
  );
  return { id: inserted.rows[0].id, action: 'created' };
};

const upsertTenantUser = async (tenantPool, { email, name, role, passwordHash }) => {
  const existing = await tenantPool.query(
    `SELECT id, role FROM users WHERE LOWER(email) = LOWER($1)`,
    [email]
  );

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    // Never escalate or demote unrelated real accounts by email collision —
    // only refresh password/name when role already matches the demo role.
    if (String(row.role || '').toUpperCase() !== role) {
      throw new Error(
        `Refusing to overwrite existing user ${email} with role ${row.role} (wanted ${role})`
      );
    }
    await tenantPool.query(
      `UPDATE users
       SET name = $1,
           password_hash = $2,
           password = NULL,
           status = COALESCE(status, 'Active'),
           last_active = NOW()
       WHERE id = $3`,
      [name, passwordHash, row.id]
    );
    return { id: row.id, action: 'updated' };
  }

  const inserted = await tenantPool.query(
    `INSERT INTO users
       (name, email, password_hash, role, status, join_date, last_active, plan, credits, streak, enrolled_courses)
     VALUES
       ($1, $2, $3, $4, 'Active', CURRENT_DATE, NOW(), 'Free', 0, 0, ARRAY[]::UUID[])
     RETURNING id`,
    [name, email, passwordHash, role]
  );
  return { id: inserted.rows[0].id, action: 'created' };
};

const main = async () => {
  console.log('=== Seed demo accounts ===');
  console.log('tenant subdomain:', TENANT_SUBDOMAIN);
  console.log('admin email:', DEMO_ADMIN_EMAIL);
  console.log('customer email:', DEMO_STUDENT_EMAIL);

  const tenantResult = await centralPool.query(
    `SELECT id, subdomain, company_name, status, subscription_plan,
            database_url_encrypted, database_name
     FROM tenants
     WHERE LOWER(subdomain) = LOWER($1) AND status != 'deleted'`,
    [TENANT_SUBDOMAIN]
  );

  if (tenantResult.rows.length === 0) {
    throw new Error(
      `Tenant "${TENANT_SUBDOMAIN}" not found. Provision it first, then re-run this seed.`
    );
  }

  const tenant = tenantResult.rows[0];
  if (tenant.status !== 'active') {
    throw new Error(`Tenant "${TENANT_SUBDOMAIN}" status is "${tenant.status}", expected active`);
  }

  const tenantPool = await getTenantPool(tenant);
  const adminHash = await hash(DEMO_ADMIN_PASSWORD);
  const studentHash = await hash(DEMO_STUDENT_PASSWORD);

  const adminCentral = await upsertTenantAdmin(tenant.id, adminHash);
  console.log(`✓ tenant_admins ${adminCentral.action}: ${DEMO_ADMIN_EMAIL}`);

  // Mirror admin into tenant users so role-based UI that reads tenant users still works.
  const adminUser = await upsertTenantUser(tenantPool, {
    email: DEMO_ADMIN_EMAIL,
    name: `${DEMO_ADMIN_FIRST_NAME} ${DEMO_ADMIN_LAST_NAME}`.trim(),
    role: 'ADMIN',
    passwordHash: adminHash
  });
  console.log(`✓ tenant users ADMIN ${adminUser.action}: ${DEMO_ADMIN_EMAIL}`);

  const studentUser = await upsertTenantUser(tenantPool, {
    email: DEMO_STUDENT_EMAIL,
    name: DEMO_STUDENT_NAME,
    role: 'STUDENT',
    passwordHash: studentHash
  });
  console.log(`✓ tenant users STUDENT ${studentUser.action}: ${DEMO_STUDENT_EMAIL}`);

  console.log('=== Demo accounts ready (passwords not printed) ===');
};

try {
  await main();
} catch (error) {
  console.error('Seed failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await clearAllPools().catch(() => undefined);
  await centralPool.end().catch(() => undefined);
}
