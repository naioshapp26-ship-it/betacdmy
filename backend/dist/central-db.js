import { Pool } from 'pg';
import dotenv from 'dotenv';
import { resolveDatabaseUrl } from '../../db/resolve-database-url.js';
dotenv.config();
const connectionString = resolveDatabaseUrl();
if (!connectionString) {
    throw new Error('No database URL configured. Railway: open Postgres → Connect → betacdmy, or add DATABASE_URL reference in Variables.');
}
if (!process.env.CENTRAL_DATABASE_URL && process.env.DATABASE_URL) {
    console.warn('[central-db] Using DATABASE_URL for central database');
}
const isLocalConnection = /localhost|127\.0\.0\.1/i.test(connectionString);
const shouldUseSSL = process.env.PGSSL ? process.env.PGSSL === 'true' : !isLocalConnection;
const rejectUnauthorized = process.env.PGSSL_REJECT_UNAUTHORIZED !== undefined
    ? process.env.PGSSL_REJECT_UNAUTHORIZED === 'true'
    : false;
export const centralPool = new Pool({
    connectionString,
    ...(shouldUseSSL ? { ssl: { rejectUnauthorized } } : {})
});
centralPool.on('error', (err) => {
    console.error('Unexpected central DB pool error', err);
});
