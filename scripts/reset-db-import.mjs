/**
 * Clear public tables and import data/Betacdmy.cpanel.sql via psql.
 * Does NOT drop schema (cPanel users are often not schema owners).
 *
 *   npm run db:prepare:betacdmy
 *   npm run db:reset:import
 */
import fs from 'fs/promises';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dumpPath = path.resolve(__dirname, '..', 'data', 'Betacdmy.cpanel.sql');
const dropTablesPath = path.resolve(__dirname, 'drop-public-tables.sql');

const databaseUrl = process.env.DATABASE_URL || process.env.CENTRAL_DATABASE_URL;
if (!databaseUrl) {
  console.error('Set DATABASE_URL in .env');
  process.exit(1);
}

const runPsql = (args, label) => {
  console.log(label);
  const result = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', ...args], {
    stdio: 'inherit',
    env: process.env
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`psql failed (${label})`);
  }
};

const run = async () => {
  await fs.access(dumpPath);
  await fs.access(dropTablesPath);
  runPsql(['-f', dropTablesPath], 'Dropping existing public tables...');
  runPsql(['-f', dumpPath], 'Importing dump (may take a few minutes)...');
  console.log('');
  console.log('Import complete.');
  console.log('Ensure .env has TENANT_DATABASE_URL_OVERRIDE and MAIN_DOMAIN=betacdmy.com.vendoworld.com');
  console.log('Then restart the app from cPanel.');
};

run().catch((err) => {
  console.error('Import failed:', err.message || err);
  process.exitCode = 1;
});
