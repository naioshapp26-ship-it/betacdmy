/**
 * Resolve the key used to encrypt/decrypt tenant database connection strings.
 * Prefer TENANT_DB_ENCRYPTION_KEY; fall back to a JWT_SECRET-derived key so Railway
 * can provision when only JWT_SECRET was configured.
 */
export const resolveTenantDbEncryptionKey = (env: NodeJS.ProcessEnv = process.env): string => {
  const configured = env.TENANT_DB_ENCRYPTION_KEY;
  if (configured && configured !== 'placeholder_key') {
    return configured;
  }

  if (env.JWT_SECRET) {
    if (env.NODE_ENV === 'production') {
      console.warn(
        '[tenant-encryption] TENANT_DB_ENCRYPTION_KEY missing; deriving key from JWT_SECRET (set TENANT_DB_ENCRYPTION_KEY explicitly)'
      );
    }
    return `tenant-db:${env.JWT_SECRET}`;
  }

  if (env.NODE_ENV === 'production') {
    throw new Error(
      'TENANT_DB_ENCRYPTION_KEY (or JWT_SECRET) must be configured to encrypt/decrypt tenant databases'
    );
  }

  console.warn('[tenant-encryption] TENANT_DB_ENCRYPTION_KEY missing; using insecure development placeholder');
  return 'placeholder_key';
};
