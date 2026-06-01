import fs from 'fs/promises';
import path from 'path';
import { centralPool } from '../central-db.js';
const MIGRATIONS_TABLE = 'central_schema_migrations';
let migrationsPromise = null;
const ensureMigrationsTable = async () => {
    await centralPool.query(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
};
const hasMigrationRun = async (filename) => {
    const result = await centralPool.query(`SELECT EXISTS (SELECT 1 FROM ${MIGRATIONS_TABLE} WHERE filename = $1) AS exists`, [filename]);
    return result.rows[0]?.exists ?? false;
};
const applyMigration = async (filePath, filename) => {
    const sql = await fs.readFile(filePath, 'utf8');
    await centralPool.query('BEGIN');
    try {
        await centralPool.query(sql);
        await centralPool.query(`INSERT INTO ${MIGRATIONS_TABLE} (filename) VALUES ($1) ON CONFLICT DO NOTHING`, [filename]);
        await centralPool.query('COMMIT');
    }
    catch (error) {
        await centralPool.query('ROLLBACK');
        throw error;
    }
};
export const runCentralMigrations = async (migrationsDir = path.join(process.cwd(), 'migrations', 'central')) => {
    if (migrationsPromise)
        return migrationsPromise;
    migrationsPromise = (async () => {
        try {
            await ensureMigrationsTable();
            const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
            for (const file of files) {
                const alreadyRan = await hasMigrationRun(file);
                if (alreadyRan)
                    continue;
                const absolute = path.join(migrationsDir, file);
                await applyMigration(absolute, file);
                console.info('[Central Migrations] Applied %s', file);
            }
        }
        catch (error) {
            console.error('[Central Migrations] Failed to apply migrations', error);
            throw error;
        }
    })();
    return migrationsPromise;
};
