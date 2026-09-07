/**
 * Host helpers for platform (main site) vs tenant subdomain routing.
 *
 * Railway TLS certificates cover `*.up.railway.app` (ONE DNS label only).
 * Nested hosts like `tenant.service.up.railway.app` are NOT covered and cause
 * NET::ERR_CERT_COMMON_NAME_INVALID. On Railway we therefore use path-based
 * tenant URLs: https://service.up.railway.app/t/{subdomain}
 *
 * Classic host subdomains remain for real domains (e.g. academy.betacdmy.com).
 */

export const TENANT_PATH_PREFIX = '/t';
export const TENANT_SUBDOMAIN_COOKIE = 'ba_tenant_sub';
export const TENANT_SUBDOMAIN_HEADER = 'x-tenant-subdomain';

export const normalizePlatformHost = (host) => {
  if (!host) return '';
  return host.split(':')[0].trim().toLowerCase().replace(/^www\./, '');
};

export const isRailwayDeploymentHost = (host) => {
  const normalized = normalizePlatformHost(host);
  return normalized.endsWith('.up.railway.app');
};

export const isPlatformMainHost = (host, options = {}) => {
  const normalized = normalizePlatformHost(host);
  if (!normalized || normalized === 'localhost' || normalized === '127.0.0.1') {
    return true;
  }

  if (isRailwayDeploymentHost(normalized)) {
    return true;
  }

  const railwayDomain = normalizePlatformHost(options.railwayPublicDomain || '');
  if (railwayDomain && normalized === railwayDomain) {
    return true;
  }

  const mainDomain = normalizePlatformHost(options.mainDomain || 'betacdmy.com');
  return normalized === mainDomain;
};

/**
 * Host-based tenant subdomains require a real apex domain with wildcard DNS/SSL.
 * Railway public hosts cannot safely use nested subdomains.
 */
export const supportsHostSubdomainTenants = (host, options = {}) => {
  const normalized = normalizePlatformHost(host);
  if (!normalized) return false;
  if (normalized === 'localhost' || normalized === '127.0.0.1') return false;
  if (isRailwayDeploymentHost(normalized)) return false;
  if (options.railwayPublicDomain && normalized === normalizePlatformHost(options.railwayPublicDomain)) {
    return false;
  }
  return true;
};

export const extractTenantPathSubdomain = (pathname = '') => {
  const path = String(pathname || '');
  const match = path.match(new RegExp(`^${TENANT_PATH_PREFIX}/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:/|$)`, 'i'));
  return match ? match[1].toLowerCase() : null;
};

export const stripTenantPathPrefix = (pathname = '', subdomain = null) => {
  const sub = subdomain || extractTenantPathSubdomain(pathname);
  if (!sub) return pathname || '/';
  const prefix = `${TENANT_PATH_PREFIX}/${sub}`;
  const path = String(pathname || '');
  if (path === prefix) return '/';
  if (path.startsWith(`${prefix}/`)) {
    const rest = path.slice(prefix.length);
    return rest.startsWith('/') ? rest : `/${rest}`;
  }
  return path;
};

export const buildTenantPublicUrl = ({
  subdomain,
  mainDomain,
  host,
  protocol = 'https',
  path = '/',
  railwayPublicDomain,
} = {}) => {
  const sub = String(subdomain || '')
    .trim()
    .toLowerCase();
  if (!sub) return null;

  const effectiveHost = normalizePlatformHost(host || mainDomain || '');
  const safePath = path.startsWith('/') ? path : `/${path}`;
  const railwayHost = normalizePlatformHost(railwayPublicDomain || '');

  if (!supportsHostSubdomainTenants(effectiveHost, { railwayPublicDomain: railwayHost })) {
    const base = `${protocol}://${effectiveHost}${TENANT_PATH_PREFIX}/${sub}`;
    return safePath === '/' ? base : `${base}${safePath}`;
  }

  const apex = normalizePlatformHost(mainDomain || effectiveHost);
  const base = `${protocol}://${sub}.${apex}`;
  return safePath === '/' ? base : `${base}${safePath}`;
};
