/**
 * Prepare Betacdmy.sql for cPanel PostgreSQL (no pgcrypto / uuid-ossp extensions).
 *
 * Usage:
 *   node scripts/prepare-betacdmy-dump.mjs "C:/Users/.../DATA BASE/Betacdmy.sql"
 *
 * Output:
 *   data/Betacdmy.cpanel.sql
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultInput = path.resolve(__dirname, '..', '..', 'DATA BASE', 'Betacdmy.sql');
const outputPath = path.resolve(__dirname, '..', 'data', 'Betacdmy.cpanel.sql');

const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultInput;

const prepare = (sql) => {
  let out = sql;

  // pg_dump 17 markers / settings (not supported on older PostgreSQL on cPanel)
  out = out.replace(/^\\restrict[^\n]*\n/gm, '');
  out = out.replace(/^\\unrestrict[^\n]*\n/gm, '');
  // Extensions unavailable on many cPanel hosts; strip PG17-only session vars
  out = out
    .split(/\r?\n/)
    .filter((line) => {
      if (/^SET transaction_timeout\b/.test(line)) return false;
      if (/^CREATE EXTENSION IF NOT EXISTS (pgcrypto|"uuid-ossp")/.test(line)) return false;
      if (/^COMMENT ON EXTENSION (pgcrypto|"uuid-ossp")/.test(line)) return false;
      return true;
    })
    .join('\n');

  // Use built-in UUID generator (PostgreSQL 13+)
  out = out.replace(/public\.uuid_generate_v4\(\)/g, 'gen_random_uuid()');
  out = out.replace(/uuid_generate_v4\(\)/g, 'gen_random_uuid()');

  // Safer re-import when functions already exist
  out = out.replace(/^CREATE FUNCTION /gm, 'CREATE OR REPLACE FUNCTION ');
  out = out.replace(/^CREATE PROCEDURE /gm, 'CREATE OR REPLACE PROCEDURE ');

  // Site URL migration for cPanel hostname
  const replacements = [
    ['https://www.betacdmy.com', 'https://betacdmy.com.vendoworld.com'],
    ['http://www.betacdmy.com', 'https://betacdmy.com.vendoworld.com'],
    ['https://betacdmy.com', 'https://betacdmy.com.vendoworld.com'],
    ['http://betacdmy.com', 'https://betacdmy.com.vendoworld.com']
  ];
  for (const [from, to] of replacements) {
    out = out.split(from).join(to);
  }

  return out;
};

const main = async () => {
  console.log('Reading:', inputPath);
  const sql = await fs.readFile(inputPath, 'utf8');
  const prepared = prepare(sql);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, prepared, 'utf8');
  console.log('Wrote:', outputPath);
  console.log('Size:', (prepared.length / 1024 / 1024).toFixed(2), 'MB');
};

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
