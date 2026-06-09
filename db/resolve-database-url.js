/**
 * Resolve a PostgreSQL connection string from common env var patterns.
 * Supports Railway when DATABASE_URL is linked, or when PG* vars are referenced.
 */
export const resolveDatabaseUrl = (env = process.env) => {
  const directCandidates = [
    env.CENTRAL_DATABASE_URL,
    env.DATABASE_URL,
    env.DATABASE_PRIVATE_URL,
    env.DATABASE_PUBLIC_URL,
    env.PROVISIONING_ADMIN_DATABASE_URL,
    env.TENANT_DATABASE_URL,
  ];

  for (const candidate of directCandidates) {
    if (candidate && typeof candidate === 'string' && !candidate.includes('******')) {
      return candidate;
    }
  }

  const { PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE } = env;
  if (PGHOST && PGUSER && PGDATABASE) {
    const port = PGPORT || '5432';
    const user = encodeURIComponent(PGUSER);
    const password = PGPASSWORD ? encodeURIComponent(PGPASSWORD) : '';
    const auth = password ? `${user}:${password}` : user;
    const sslmode = env.PGSSLMODE || 'require';
    return `postgresql://${auth}@${PGHOST}:${port}/${PGDATABASE}?sslmode=${sslmode}`;
  }

  return undefined;
};

export const hasDatabaseConfig = (env = process.env) => Boolean(resolveDatabaseUrl(env));
