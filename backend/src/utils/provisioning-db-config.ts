/**
 * Derive tenant provisioning DB URLs from Railway/shared DATABASE_URL when
 * dedicated env vars are not configured.
 */

const PENDING_PLACEHOLDER_PREFIX = 'postgresql://pending.invalid/';

export const buildPendingDatabaseUrl = (databaseName: string) =>
  `${PENDING_PLACEHOLDER_PREFIX}${encodeURIComponent(databaseName)}`;

export const isPendingDatabaseUrl = (url: string | null | undefined) =>
  typeof url === 'string' && url.startsWith(PENDING_PLACEHOLDER_PREFIX);

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, '');

/**
 * Replace the database name segment in a postgres URL with `{db}` or a concrete name.
 * Supports URLs with or without query strings.
 * Keeps `{db}` literally unencoded so template.replace('{db}', name) works.
 */
export const replaceDatabaseNameInUrl = (connectionString: string, databaseName: string) => {
  if (!connectionString || typeof connectionString !== 'string') {
    return undefined;
  }

  try {
    const parsed = new URL(connectionString);
    const query = parsed.search || '';
    const auth = parsed.username
      ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ''}@`
      : '';
    const host = parsed.host; // includes port when present
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    if (pathParts.length === 0) {
      pathParts.push(databaseName);
    } else {
      pathParts[pathParts.length - 1] = databaseName;
    }
    return `${parsed.protocol}//${auth}${host}/${pathParts.join('/')}${query}`;
  } catch {
    const [base, query = ''] = connectionString.split('?');
    const withoutSlash = stripTrailingSlash(base);
    const replaced = withoutSlash.replace(/\/[^/?]+$/, `/${databaseName}`);
    return query ? `${replaced}?${query}` : replaced;
  }
};

export const resolveTenantDatabaseUrlTemplate = (env: NodeJS.ProcessEnv = process.env) => {
  const configured = env.TENANT_DATABASE_URL_TEMPLATE;
  if (configured && configured.includes('{db}')) {
    return configured;
  }

  const source =
    env.DATABASE_URL ||
    env.CENTRAL_DATABASE_URL ||
    env.PROVISIONING_ADMIN_DATABASE_URL ||
    env.TENANT_DATABASE_URL;

  if (!source || source.includes('******')) {
    return undefined;
  }

  return replaceDatabaseNameInUrl(source, '{db}');
};

export const resolveProvisioningAdminDatabaseUrl = (env: NodeJS.ProcessEnv = process.env) => {
  if (env.PROVISIONING_ADMIN_DATABASE_URL && !env.PROVISIONING_ADMIN_DATABASE_URL.includes('******')) {
    return env.PROVISIONING_ADMIN_DATABASE_URL;
  }

  const source = env.DATABASE_URL || env.CENTRAL_DATABASE_URL || env.TENANT_DATABASE_URL;
  if (!source || source.includes('******')) {
    return undefined;
  }

  // CREATE DATABASE can run while connected to the existing app database.
  return source;
};

export const quotePgIdentifier = (identifier: string) => `"${String(identifier).replace(/"/g, '""')}"`;
