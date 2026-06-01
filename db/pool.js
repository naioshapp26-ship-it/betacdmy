import { AsyncLocalStorage } from 'async_hooks';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Pool } = pg;

// Tenant-facing app data (courses, users, etc.) can live in a separate DB.
// If TENANT_DATABASE_URL is provided, prefer it; otherwise fall back to DATABASE_URL.
const connectionString = process.env.TENANT_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('No tenant database connection configured. Set TENANT_DATABASE_URL or DATABASE_URL in your environment.');
}

const isLocalConnection = /localhost|127\.0\.0\.1/i.test(connectionString);
const shouldUseSSL = process.env.PGSSL ? process.env.PGSSL === 'true' : !isLocalConnection;

const createPool = () =>
  new Pool({
    connectionString,
    ...(shouldUseSSL ? { ssl: { rejectUnauthorized: false } } : {})
  });

const basePool = createPool();
basePool.on('error', (err) => {
  console.error('Unexpected PG pool error', err);
});

const storage = new AsyncLocalStorage();

const proxyPool = new Proxy(basePool, {
  get(_target, prop, receiver) {
    const activePool = (storage.getStore() ?? basePool);
    const value = Reflect.get(activePool, prop, receiver);
    if (typeof value === 'function') {
      return value.bind(activePool);
    }
    return value;
  }
});

export const getDefaultPool = () => basePool;
export const runWithPoolContext = (poolInstance, callback) => {
  const target = poolInstance ?? basePool;
  return storage.run(target, callback);
};

export default proxyPool;
