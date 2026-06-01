import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const scope = (process.argv[2] || 'central').toLowerCase();
if (!['central', 'tenant'].includes(scope)) {
  console.error(`Invalid scope "${scope}". Use "central" or "tenant".`);
  process.exit(1);
}

const migrationsDir = path.join(__dirname, '..', 'migrations', scope);

const resolveConnectionString = () => {
  const scopedValue =
    scope === 'central' ? process.env.CENTRAL_DATABASE_URL : process.env.TENANT_DATABASE_URL;
  const fallback = process.env.DATABASE_URL;
  const resolved = scopedValue || fallback;

  if (!resolved) {
    throw new Error(
      `No connection string provided for ${scope} migrations. Set ${
        scope === 'central' ? 'CENTRAL_DATABASE_URL' : 'TENANT_DATABASE_URL'
      } or DATABASE_URL.`
    );
  }

  return resolved;
};

const connectionString = resolveConnectionString();
const isLocalConnection = /localhost|127\.0\.0\.1/i.test(connectionString);
const shouldUseSSL = process.env.PGSSL ? process.env.PGSSL === 'true' : !isLocalConnection;
const rejectUnauthorized =
  process.env.PGSSL_REJECT_UNAUTHORIZED !== undefined
    ? process.env.PGSSL_REJECT_UNAUTHORIZED === 'true'
    : false;

const pool = new Pool({
  connectionString,
  ...(shouldUseSSL ? { ssl: { rejectUnauthorized } } : {})
});

pool.on('error', (err) => {
  console.error('Unexpected PG pool error', err);
});

const runMigrations = async () => {
  const exists = await fs
    .stat(migrationsDir)
    .then((stat) => stat.isDirectory())
    .catch(() => false);

  if (!exists) {
    console.error(`Migration directory not found: ${migrationsDir}`);
    process.exit(1);
  }

  const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.toLowerCase().endsWith('.sql'))
    .sort();

  if (!files.length) {
    console.log(`No SQL migrations found for scope "${scope}".`);
    return;
  }

  const safeConnection = connectionString.replace(/:\/\/[^:]*:[^@]*@/, '://****:****@');
  console.log(`Running ${files.length} ${scope} migration(s) against ${safeConnection}`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      scope TEXT NOT NULL,
      filename TEXT NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (scope, filename)
    );
  `);

  for (const file of files) {
    const fullPath = path.join(migrationsDir, file);
    const sql = await fs.readFile(fullPath, 'utf8');
    console.log(`\nApplying ${scope} migration: ${file}`);

    const alreadyApplied = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE scope = $1 AND filename = $2 LIMIT 1',
      [scope, file]
    );
    if (alreadyApplied.rowCount > 0) {
      console.log(`Skipping ${file} (already applied)`);
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (scope, filename) VALUES ($1, $2)',
        [scope, file]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  console.log(`\n${scope.charAt(0).toUpperCase() + scope.slice(1)} migrations completed successfully.`);
};

runMigrations()
  .catch((error) => {
    console.error(`Migration run failed for scope "${scope}"`, error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
