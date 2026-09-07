/**
 * End-to-end academy provisioning verification script.
 * Exercises the same orchestrator as POST /saas/api/provisioning/start.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@127.0.0.1:5432/railway';
process.env.CENTRAL_DATABASE_URL ||= process.env.DATABASE_URL;
process.env.TENANT_DATABASE_URL ||= process.env.DATABASE_URL;
process.env.TENANT_DB_ENCRYPTION_KEY ||= randomBytes(16).toString('hex');
process.env.JWT_SECRET ||= 'e2e-jwt-secret';
process.env.NODE_ENV = 'test';

const { ProvisioningService } = await import('../backend/dist/services/provisioning.service.js');
const { centralPool } = await import('../backend/dist/central-db.js');
const { getTenantPool, closeAllTenantPools } = await import('../backend/dist/services/db-manager.js');
const { decryptField } = await import('../db/field-encryption.js');

const service = new ProvisioningService(centralPool);
const subdomain = `hope${Date.now().toString(36).slice(-6)}`;
const adminEmail = `noura-${subdomain}@example.com`;
const adminPassword = 'SecurePass123!';

console.log('=== E2E Provisioning Start ===');
console.log('subdomain:', subdomain);

const tenant = await service.provisioningOrchestrator({
  subdomain,
  companyName: 'هوب',
  subscriptionPlan: 'basic',
  admin: {
    email: adminEmail,
    password: adminPassword,
    firstName: 'Noura',
    lastName: 'Ahmed'
  }
});

assert.ok(tenant.id, 'tenant id');
assert.equal(tenant.status, 'active');
console.log('✓ tenant record + full orchestration complete:', tenant.id);

const logs = await service.getProvisioningLogs(tenant.id);
const failed = logs.filter((l) => l.status === 'failed');
assert.equal(failed.length, 0, `no failed steps: ${JSON.stringify(failed)}`);
const successSteps = new Set(logs.filter((l) => l.status === 'success').map((l) => l.step));
for (const step of [
  'CREATE_TENANT_RECORD',
  'CREATE_TENANT_DATABASE',
  'STORE_DATABASE_SECRET',
  'RUN_MIGRATIONS',
  'SEED_DEFAULTS',
  'CREATE_SUBSCRIPTION',
  'CREATE_ADMIN',
  'SEND_WELCOME_EMAIL'
]) {
  assert.ok(successSteps.has(step), `step ${step} succeeded`);
}
console.log('✓ all provisioning steps succeeded');

const full = await centralPool.query(
  `SELECT database_name, database_url_encrypted, subdomain, status FROM tenants WHERE id = $1`,
  [tenant.id]
);
const row = full.rows[0];
assert.equal(row.database_name, `tenant_${subdomain}`);
const decrypted = decryptField(row.database_url_encrypted, process.env.TENANT_DB_ENCRYPTION_KEY);
assert.ok(decrypted.includes(row.database_name), 'stored connection points at tenant DB');
assert.ok(!decrypted.includes('pending.invalid'), 'pending placeholder replaced');
console.log('✓ database secret stored and decryptable');

const pool = await getTenantPool({
  ...tenant,
  database_url_encrypted: row.database_url_encrypted,
  database_name: row.database_name
});
const admin = await pool.query(
  `SELECT email, role, password_hash IS NOT NULL AS has_hash FROM users WHERE LOWER(email) = LOWER($1)`,
  [adminEmail]
);
assert.equal(admin.rowCount, 1);
assert.equal(admin.rows[0].role, 'ADMIN');
assert.equal(admin.rows[0].has_hash, true);
console.log('✓ admin user created with password_hash');

const sub = await centralPool.query(
  `SELECT plan, status, locked_amount, locked_currency FROM subscriptions WHERE tenant_id = $1`,
  [tenant.id]
);
assert.ok(sub.rowCount >= 1);
assert.equal(sub.rows[0].status, 'active');
console.log('✓ subscription created:', sub.rows[0]);

// Isolation check: tenant A data not in central users table confusion / second tenant
const subdomainB = `iso${Date.now().toString(36).slice(-6)}`;
const tenantB = await service.provisioningOrchestrator({
  subdomain: subdomainB,
  companyName: 'Isolation Academy',
  subscriptionPlan: 'basic',
  admin: {
    email: `admin-${subdomainB}@example.com`,
    password: 'OtherPass123!',
    firstName: 'Iso',
    lastName: 'Admin'
  }
});
const tenantBRow = (
  await centralPool.query(
    `SELECT id, subdomain, company_name, status, subscription_plan, database_url_encrypted, database_name FROM tenants WHERE id = $1`,
    [tenantB.id]
  )
).rows[0];
const poolB = await getTenantPool(tenantBRow);
const cross = await poolB.query(`SELECT COUNT(*)::int AS c FROM users WHERE LOWER(email) = LOWER($1)`, [adminEmail]);
assert.equal(cross.rows[0].c, 0, 'tenant B must not see tenant A admin');
console.log('✓ tenant isolation verified');

// Duplicate subdomain rejected
let dupFailed = false;
try {
  await service.provisioningOrchestrator({
    subdomain,
    companyName: 'Dup',
    subscriptionPlan: 'basic',
    admin: { email: 'dup@example.com', password: 'x' }
  });
} catch (error) {
  dupFailed = true;
  console.log('✓ duplicate subdomain rejected:', error.message);
}
assert.ok(dupFailed, 'duplicate subdomain must fail');

console.log('=== E2E SUCCESS ===');
console.log(JSON.stringify({
  tenantId: tenant.id,
  subdomain,
  academyUrl: `https://${subdomain}.<MAIN_DOMAIN>`,
  adminEmail,
  status: 'active'
}, null, 2));

await pool.end().catch(() => {});
await poolB.end().catch(() => {});
await service.rollbackProvisioning(tenant.id, { reason: 'e2e cleanup', dropDatabase: true }).catch(console.error);
await service.rollbackProvisioning(tenantB.id, { reason: 'e2e cleanup', dropDatabase: true }).catch(console.error);
await centralPool.end().catch(() => {});
process.exit(0);
