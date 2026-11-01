/**
 * Provision an isolated NAIOSH demo tenant (idempotent if already active).
 * Passwords come from env — never logged.
 */
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config();

process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@127.0.0.1:5432/railway';
process.env.CENTRAL_DATABASE_URL ||= process.env.DATABASE_URL;
process.env.TENANT_DATABASE_URL ||= process.env.DATABASE_URL;
process.env.TENANT_DB_ENCRYPTION_KEY ||=
  process.env.JWT_SECRET || randomBytes(16).toString('hex');
process.env.JWT_SECRET ||= 'demo-provision-jwt-secret';

const subdomain = (process.env.TENANT_SUBDOMAIN || 'naiosh').toLowerCase();
const adminEmail = process.env.DEMO_ADMIN_EMAIL || 'demo-admin@naiosh.local';
const adminPassword = process.env.DEMO_ADMIN_PASSWORD;
if (!adminPassword) {
  throw new Error('DEMO_ADMIN_PASSWORD is required');
}

const { ProvisioningService } = await import('../backend/dist/services/provisioning.service.js');
const { centralPool } = await import('../backend/dist/central-db.js');
const { clearAllPools } = await import('../backend/dist/services/db-manager.js');

const existing = await centralPool.query(
  `SELECT id, subdomain, status FROM tenants WHERE LOWER(subdomain) = LOWER($1) AND status != 'deleted'`,
  [subdomain]
);

if (existing.rows[0]?.status === 'active') {
  console.log(`Tenant ${subdomain} already active (${existing.rows[0].id})`);
  await clearAllPools().catch(() => undefined);
  await centralPool.end().catch(() => undefined);
  process.exit(0);
}

const service = new ProvisioningService(centralPool);
console.log('Provisioning tenant:', subdomain);

const tenant = await service.provisioningOrchestrator({
  subdomain,
  companyName: 'NAIOSH Academy',
  subscriptionPlan: 'basic',
  admin: {
    email: adminEmail,
    password: adminPassword,
    firstName: 'Demo',
    lastName: 'Admin'
  }
});

console.log('Provisioned tenant id:', tenant.id, 'status:', tenant.status);

const logs = await service.getProvisioningLogs(tenant.id);
const failed = logs.filter((l) => l.status === 'failed');
if (failed.length) {
  console.error('Failed steps:', failed.map((f) => f.step));
  process.exitCode = 1;
} else {
  console.log('All provisioning steps succeeded');
}

await clearAllPools().catch(() => undefined);
await centralPool.end().catch(() => undefined);
