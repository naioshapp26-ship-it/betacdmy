/**
 * Host helpers for platform (main site) vs tenant subdomain routing.
 * Railway assigns URLs like betacdmy-production.up.railway.app — the full hostname
 * is the main app URL, not a tenant subdomain.
 */

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
