import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';
import { encryptField } from '../db/field-encryption.js';

dotenv.config();

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const required = (name, fallback) => {
  const value = process.env[name] || fallback;
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
};

const CENTRAL_DATABASE_URL = required('CENTRAL_DATABASE_URL');
const LEGACY_DATABASE_URL = required('LEGACY_DATABASE_URL', process.env.DATABASE_URL);
const TENANT_TARGET_DATABASE_URL = required('TENANT_MIGRATION_TARGET_URL', process.env.TENANT_DATABASE_URL);
const TENANT_SUBDOMAIN = required('MIGRATION_TENANT_SUBDOMAIN', 'main');
const TENANT_COMPANY = required('MIGRATION_TENANT_COMPANY', 'Default Academy');
const TENANT_PLAN = process.env.MIGRATION_TENANT_PLAN || 'enterprise';
const ENCRYPTION_KEY = required('TENANT_DB_ENCRYPTION_KEY', 'placeholder_secret');

const shouldUseSSL = (conn) => {
  const isLocal = /localhost|127\.0\.0\.1/i.test(conn);
  return process.env.PGSSL ? process.env.PGSSL === 'true' : !isLocal;
};

const makePool = (conn) =>
  new Pool({
    connectionString: conn,
    ...(shouldUseSSL(conn) ? { ssl: { rejectUnauthorized: false } } : {})
  });

const central = makePool(CENTRAL_DATABASE_URL);
const legacy = makePool(LEGACY_DATABASE_URL);
const target = makePool(TENANT_TARGET_DATABASE_URL);

const runTenantMigrations = async () => {
  const dir = path.join(__dirname, '..', 'migrations', 'tenant');
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = await fs.readFile(path.join(dir, file), 'utf8');
    await target.query(sql);
  }
};

const ensureTenantRecord = async () => {
  const result = await central.query(
    `INSERT INTO tenants (subdomain, company_name, subscription_plan, database_url_encrypted, database_name)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (subdomain) DO UPDATE SET company_name = EXCLUDED.company_name
     RETURNING *`,
    [
      TENANT_SUBDOMAIN,
      TENANT_COMPANY,
      TENANT_PLAN,
      encryptField(TENANT_TARGET_DATABASE_URL, ENCRYPTION_KEY),
      `tenant_${TENANT_SUBDOMAIN}`
    ]
  );
  return result.rows[0];
};

const copyTable = async (table) => {
  const colsResult = await legacy.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
    [table]
  );
  if (!colsResult.rowCount) {
    console.log(`- Skip ${table} (no columns)`);
    return;
  }
  const columns = colsResult.rows.map((r) => `"${r.column_name}"`).join(', ');
  const insertSQL = `INSERT INTO "${table}" (${columns}) SELECT ${columns} FROM "${table}"`;
  try {
    await target.query('BEGIN');
    await target.query(insertSQL);
    await target.query('COMMIT');
    console.log(`- Copied ${table}`);
  } catch (err) {
    await target.query('ROLLBACK');
    console.warn(`- Skipped ${table} (error: ${err.message})`);
  }
};

const TABLES_TO_COPY = [
  'users',
  'courses',
  'blog_posts',
  'notifications',
  'course_progress',
  'credit_redemption_options',
  'credit_transactions',
  'credit_redemptions',
  'course_payments',
  'attendance_records',
  'certificates',
  'discounts',
  'live_classes',
  'live_class_invites',
  'static_pages',
  'career_applications',
  'message_conversations',
  'message_participants',
  'messages',
  'message_receipts',
  'message_blocks',
  'message_audit_logs',
  'rewards_config',
  'payment_gateway_config',
  'live_platform_config'
];

const main = async () => {
  console.log('Starting single-tenant → multi-tenant migration');
  const tenant = await ensureTenantRecord();
  console.log(`Tenant ensured: ${tenant.subdomain} (${tenant.id})`);

  console.log('Running tenant migrations...');
  await runTenantMigrations();

  console.log('Copying data tables...');
  for (const table of TABLES_TO_COPY) {
    await copyTable(table);
  }

  console.log('Migration complete.');
};

main()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all([central.end(), legacy.end(), target.end()]);
  });

