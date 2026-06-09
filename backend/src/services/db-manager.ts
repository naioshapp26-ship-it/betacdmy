import { Pool } from 'pg';
import { TenantRow, centralPool } from '../central-db.js';
import { decryptField } from '../utils/field-encryption.js';

type PoolEntry = {
  pool: Pool;
  timeout?: NodeJS.Timeout;
};

const TTL_MS = 5 * 60 * 1000;
const pools = new Map<string, PoolEntry>();
const ensuredPasswordHashPools = new WeakSet<Pool>();
const SELF_SIGNED_CODES = new Set(['SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT']);
const SELF_SIGNED_KEYWORDS = ['self signed certificate', 'self-signed certificate'];
const allowSelfSignedConnections = (process.env.TENANT_DB_SSL_ALLOW_SELF_SIGNED ?? 'true') !== 'false';

const isSelfSignedCertificateError = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code && SELF_SIGNED_CODES.has(code)) return true;
  const message = (error as Error)?.message?.toLowerCase() ?? '';
  return SELF_SIGNED_KEYWORDS.some((snippet) => message.includes(snippet));
};

const ensurePoolReady = async (
  tenant: TenantRow,
  createPool: (rejectUnauthorizedOverride?: boolean) => Pool,
  canRelaxSSL: boolean
): Promise<Pool> => {
  let pool = createPool();
  try {
    await pool.query('SELECT 1');
    return pool;
  } catch (error) {
    if (allowSelfSignedConnections && canRelaxSSL && isSelfSignedCertificateError(error)) {
      console.warn(
        `[db-manager] Tenant ${tenant.subdomain} presented a self-signed certificate; retrying with relaxed validation.`
      );
      await pool.end().catch(() => undefined);
      pool = createPool(false);
      await pool.query('SELECT 1');
      return pool;
    }
    await pool.end().catch(() => undefined);
    throw error;
  }
};

const stripSSLModeParam = (connectionString: string): string => {
  // Remove sslmode query parameter to let our explicit SSL config take precedence
  return connectionString.replace(/[?&]sslmode=[^&]*/gi, '').replace(/\?&/, '?').replace(/\?$/, '');
};

const ensurePasswordHashColumn = async (pool: Pool) => {
  if (ensuredPasswordHashPools.has(pool)) return;

  try {
    // First check if the users table exists (it won't during initial provisioning before migrations)
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'users'
      ) AS table_exists
    `);
    
    if (!tableCheck.rows[0]?.table_exists) {
      // Users table doesn't exist yet - this is normal during provisioning before migrations run
      // Skip the password_hash check for now; it will be created by migrations
      console.log('[db-manager] Users table does not exist yet - skipping password_hash column check');
      return;
    }

    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT');
    await pool.query(
      'CREATE INDEX IF NOT EXISTS idx_users_password_hash ON users(password_hash) WHERE password_hash IS NOT NULL'
    );
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_country_code TEXT');
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS national_id TEXT');
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT');
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS specialization TEXT');
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT');
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS follow_up_status TEXT');
    ensuredPasswordHashPools.add(pool);
  } catch (error) {
    console.error('[db-manager] Failed to ensure password_hash column exists in tenant database', error);
    throw error;
  }
};

const decryptConnectionString = async (tenant: TenantRow): Promise<string | null> => {
  const override = process.env.TENANT_DATABASE_URL_OVERRIDE;
  if (override) return stripSSLModeParam(override);

  const hasEncryptedConnection = tenant.database_url_encrypted && tenant.database_url_encrypted.length > 0;
  if (hasEncryptedConnection) {
    const encryptionKey = process.env.TENANT_DB_ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new Error('TENANT_DB_ENCRYPTION_KEY must be configured to decrypt tenant databases');
    }

    const decrypted = decryptField(tenant.database_url_encrypted, encryptionKey);
    if (decrypted) {
      return stripSSLModeParam(decrypted);
    }
    throw new Error('Failed to decrypt tenant database connection string');
  }

  const fallback = process.env.TENANT_DATABASE_URL || process.env.DATABASE_URL || process.env.CENTRAL_DATABASE_URL;
  if (fallback) return stripSSLModeParam(fallback);

  return null;
};

export async function getTenantPool(tenant: TenantRow): Promise<Pool> {
  // Central virtual tenant uses the central pool directly
  if (tenant.id === 'central') {
    return centralPool;
  }

  const key = tenant.id;
  const cached = pools.get(key);
  if (cached) {
    if (cached.timeout) clearTimeout(cached.timeout);
    cached.timeout = setTimeout(() => evictPool(key), TTL_MS);
    return cached.pool;
  }

  const connectionString = await decryptConnectionString(tenant);
  if (!connectionString) {
    throw new Error('Missing tenant database connection string');
  }

  const isLocal = /localhost|127\.0\.0\.1/i.test(connectionString);
  const tenantSSLOverride = process.env.TENANT_PGSSL;
  const useSSL = tenantSSLOverride
    ? tenantSSLOverride === 'true'
    : process.env.PGSSL
      ? process.env.PGSSL === 'true'
      : !isLocal;
  const rejectUnauthorizedEnv =
    process.env.TENANT_PGSSL_REJECT_UNAUTHORIZED ?? process.env.PGSSL_REJECT_UNAUTHORIZED;
  let rejectUnauthorized =
    rejectUnauthorizedEnv !== undefined ? rejectUnauthorizedEnv === 'true' : false;

  if (allowSelfSignedConnections && useSSL) {
    // If we explicitly allow self-signed tenant databases, skip strict verification upfront
    rejectUnauthorized = false;
  }

  const instantiatePool = (overrideReject?: boolean) => {
    let sslConfig: Record<string, unknown> | undefined;
    if (useSSL) {
      const finalReject = overrideReject ?? rejectUnauthorized;
      sslConfig =
        finalReject === false
          ? {
              rejectUnauthorized: false,
              // Skip host validation when we explicitly allow self-signed certs
              checkServerIdentity: () => undefined
            }
          : { rejectUnauthorized: finalReject };
    }

    return new Pool({
      connectionString,
      ...(sslConfig ? { ssl: sslConfig } : {})
    });
  };

  const pool = await ensurePoolReady(tenant, instantiatePool, useSSL && !allowSelfSignedConnections);

  await ensurePasswordHashColumn(pool);

  const timeout = setTimeout(() => evictPool(key), TTL_MS);
  pools.set(key, { pool, timeout });
  return pool;
}

export const evictPool = (tenantId: string) => {
  const entry = pools.get(tenantId);
  if (!entry) return;
  if (entry.timeout) clearTimeout(entry.timeout);
  entry.pool.end().catch((err) => console.warn('Error closing tenant pool', err));
  pools.delete(tenantId);
};

export const clearAllPools = async () => {
  await Promise.all(
    Array.from(pools.values()).map(async (entry) => {
      if (entry.timeout) clearTimeout(entry.timeout);
      await entry.pool.end();
    })
  );
  pools.clear();
};

