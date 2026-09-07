/**
 * Optional live integration test for tenant provisioning.
 * Skips automatically when DATABASE_URL / CENTRAL_DATABASE_URL is not set.
 *
 * Run:
 *   DATABASE_URL=... TENANT_DB_ENCRYPTION_KEY=testkey npm run test:api
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const hasDb = Boolean(
  process.env.DATABASE_URL ||
    process.env.CENTRAL_DATABASE_URL ||
    process.env.TENANT_DATABASE_URL
);

test(
  'live provisioning creates tenant DB, migrations, and admin',
  { skip: !hasDb },
  async () => {
    process.env.TENANT_DB_ENCRYPTION_KEY =
      process.env.TENANT_DB_ENCRYPTION_KEY || randomBytes(16).toString('hex');
    process.env.NODE_ENV = process.env.NODE_ENV || 'test';

    const { ProvisioningService } = await import('../../backend/dist/services/provisioning.service.js');
    const { centralPool } = await import('../../backend/dist/central-db.js');
    const { getTenantPool } = await import('../../backend/dist/services/db-manager.js');

    const subdomain = `t${Date.now().toString(36).slice(-8)}`;
    const service = new ProvisioningService(centralPool);

    const tenant = await service.provisioningOrchestrator({
      subdomain,
      companyName: `Test Academy ${subdomain}`,
      subscriptionPlan: 'basic',
      admin: {
        email: `admin-${subdomain}@example.com`,
        password: 'TestPass123!',
        firstName: 'Test',
        lastName: 'Admin'
      }
    });

    assert.ok(tenant?.id);
    assert.equal(tenant.subdomain, subdomain);
    assert.equal(tenant.status, 'active');

    const summary = await service.getTenantSummary(tenant.id);
    assert.equal(summary.status, 'active');
    assert.ok(summary.database_name);

    const pool = await getTenantPool(tenant);
    const users = await pool.query(
      `SELECT email, role, password_hash IS NOT NULL AS has_hash FROM users WHERE LOWER(email) = $1`,
      [`admin-${subdomain}@example.com`]
    );
    assert.equal(users.rowCount, 1);
    assert.equal(users.rows[0].role, 'ADMIN');
    assert.equal(users.rows[0].has_hash, true);

    const tables = await pool.query(
      `SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'`
    );
    assert.ok(tables.rows[0].count > 5, 'tenant migrations should create tables');

    // Cleanup: end pools before DROP DATABASE to avoid "terminating connection" noise
    try {
      await pool.end();
    } catch {
      // ignore
    }
    await service.rollbackProvisioning(tenant.id, {
      reason: 'integration test cleanup',
      dropDatabase: true
    });
  }
);
