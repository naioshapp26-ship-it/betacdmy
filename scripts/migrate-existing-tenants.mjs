import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';
import { decryptField } from '../db/field-encryption.js';

dotenv.config();

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CENTRAL_DATABASE_URL = process.env.CENTRAL_DATABASE_URL || process.env.DATABASE_URL;
const TENANT_DB_ENCRYPTION_KEY = process.env.TENANT_DB_ENCRYPTION_KEY;
const ONLY_SUBDOMAIN = process.env.TENANT_MIGRATION_SUBDOMAIN?.trim().toLowerCase() || '';
const ONLY_MIGRATION_FILES = new Set(
  (process.env.TENANT_MIGRATION_ONLY || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);
const migrationsDir = path.join(__dirname, '..', 'migrations', 'tenant');

if (!CENTRAL_DATABASE_URL) {
  throw new Error('CENTRAL_DATABASE_URL or DATABASE_URL must be configured.');
}

if (!TENANT_DB_ENCRYPTION_KEY) {
  throw new Error('TENANT_DB_ENCRYPTION_KEY must be configured to decrypt tenant databases.');
}

const shouldUseSSL = (connectionString) => {
  const isLocal = /localhost|127\.0\.0\.1/i.test(connectionString);
  return process.env.PGSSL ? process.env.PGSSL === 'true' : !isLocal;
};

const makePool = (connectionString) =>
  new Pool({
    connectionString,
    ...(shouldUseSSL(connectionString) ? { ssl: { rejectUnauthorized: false } } : {})
  });

const safeConnection = (connectionString) => connectionString.replace(/:\/\/[^:]*:[^@]*@/, '://****:****@');

const central = makePool(CENTRAL_DATABASE_URL);

const getMigrationFiles = async () => {
  let files = (await fs.readdir(migrationsDir))
    .filter((file) => file.toLowerCase().endsWith('.sql'))
    .sort();

  if (ONLY_MIGRATION_FILES.size > 0) {
    files = files.filter((file) => ONLY_MIGRATION_FILES.has(file));
  }

  if (!files.length) {
    throw new Error(`No tenant migrations found in ${migrationsDir}`);
  }

  return files;
};

const fetchTenants = async () => {
  const values = [];
  let query = `
    SELECT id, subdomain, database_url_encrypted
    FROM tenants
    WHERE status != 'deleted'
      AND database_url_encrypted IS NOT NULL
  `;

  if (ONLY_SUBDOMAIN) {
    values.push(ONLY_SUBDOMAIN);
    query += ` AND LOWER(subdomain) = $1`;
  }

  query += ' ORDER BY subdomain ASC';
  const result = await central.query(query, values);
  return result.rows;
};

const decryptTenantConnection = async (encrypted) => {
  const connectionString = decryptField(encrypted, TENANT_DB_ENCRYPTION_KEY);
  if (!connectionString) {
    throw new Error('Failed to decrypt tenant connection string.');
  }
  return connectionString;
};

const detectMigrationStorage = async (pool) => {
  const exists = await pool.query(`SELECT to_regclass('public.schema_migrations') AS table_name`);
  if (!exists.rows[0]?.table_name) {
    await pool.query(`
      CREATE TABLE schema_migrations (
        id SERIAL PRIMARY KEY,
        migration_name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    return 'migration_name';
  }

  const columns = await pool.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'schema_migrations'`
  );
  const names = new Set(columns.rows.map((row) => row.column_name));

  if (names.has('migration_name')) {
    return 'migration_name';
  }
  if (names.has('scope') && names.has('filename')) {
    return 'scope_filename';
  }

  throw new Error('Unsupported schema_migrations table format.');
};

const hasMigration = async (pool, storage, filename) => {
  if (storage === 'migration_name') {
    const result = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE migration_name = $1 LIMIT 1',
      [filename]
    );
    return result.rowCount > 0;
  }

  const result = await pool.query(
    'SELECT 1 FROM schema_migrations WHERE scope = $1 AND filename = $2 LIMIT 1',
    ['tenant', filename]
  );
  return result.rowCount > 0;
};

const recordMigration = async (client, storage, filename) => {
  if (storage === 'migration_name') {
    await client.query(
      `INSERT INTO schema_migrations (migration_name, applied_at)
       VALUES ($1, NOW())
       ON CONFLICT (migration_name) DO NOTHING`,
      [filename]
    );
    return;
  }

  await client.query(
    `INSERT INTO schema_migrations (scope, filename)
     VALUES ($1, $2)
     ON CONFLICT (scope, filename) DO NOTHING`,
    ['tenant', filename]
  );
};

const applyTenantMigrations = async (tenant, files) => {
  const connectionString = await decryptTenantConnection(tenant.database_url_encrypted);
  const pool = makePool(connectionString);

  try {
    const storage = await detectMigrationStorage(pool);
    console.log(`\n[tenant:${tenant.subdomain}] Connected to ${safeConnection(connectionString)}`);

    for (const file of files) {
      if (await hasMigration(pool, storage, file)) {
        console.log(`[tenant:${tenant.subdomain}] Skipping ${file} (already applied)`);
        continue;
      }

      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await recordMigration(client, storage, file);
        await client.query('COMMIT');
        console.log(`[tenant:${tenant.subdomain}] Applied ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Failed to apply ${file}: ${error.message}`);
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
};

const main = async () => {
  const files = await getMigrationFiles();
  const tenants = await fetchTenants();

  if (!tenants.length) {
    console.log('No tenant databases found for migration.');
    return;
  }

  console.log(`Applying ${files.length} tenant migration(s) to ${tenants.length} tenant database(s).`);

  for (const tenant of tenants) {
    await applyTenantMigrations(tenant, files);
  }

  console.log('\nTenant migrations completed successfully.');
};

main()
  .catch((error) => {
    console.error('Tenant migration rollout failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await central.end();
  });