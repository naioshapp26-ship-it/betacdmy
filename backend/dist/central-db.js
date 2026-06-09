import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const DEFAULT_CONNECTION = '******shortline.proxy.rlwy.net:25275/railway';
const resolveConnectionString = () => {
    const candidates = [
        process.env.CENTRAL_DATABASE_URL,
        process.env.DATABASE_URL,
        process.env.PROVISIONING_ADMIN_DATABASE_URL,
        process.env.TENANT_DATABASE_URL
    ];
    for (const candidate of candidates) {
        if (candidate && !candidate.includes('******')) {
            if (candidate !== process.env.CENTRAL_DATABASE_URL) {
                console.warn('[central-db] Falling back to secondary connection string for central database');
            }
            return candidate;
        }
    }
    return DEFAULT_CONNECTION.includes('******') ? undefined : DEFAULT_CONNECTION;
};
const connectionString = resolveConnectionString();
if (!connectionString) {
    throw new Error('No database URL configured. Set DATABASE_URL or CENTRAL_DATABASE_URL (Railway: link PostgreSQL via Variables → Add Reference).');
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
