import { isRailwayDeploymentHost, normalizePlatformHost } from './platform-host.js';

export const defaultMainDomain = 'betacdmy.com';

export const normalizeHost = (host: string) => host.toLowerCase().split(':')[0];

export const normalizeMainDomain = (domain: string) =>
  normalizeHost(domain).replace(/^www\./, '');

export const deriveMainDomainFromHost = (host: string): string | null => {
  const normalized = normalizeHost(host).replace(/^www\./, '');
  if (!normalized || normalized === 'localhost' || normalized === '127.0.0.1') {
    return null;
  }
  const parts = normalized.split('.').filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  return parts.slice(-2).join('.');
};

/** Prefer explicit env/default domains over naive last-two-label inference (fixes cPanel hosts). */
export const resolveMainDomainForHost = (
  host: string,
  envMainDomain: string | null
): string => {
  const normalizedHost = normalizePlatformHost(host);
  const isLocalHost = normalizedHost === 'localhost' || normalizedHost === '127.0.0.1';
  if (isLocalHost) {
    return normalizeMainDomain(
      envMainDomain || deriveMainDomainFromHost(host) || defaultMainDomain
    );
  }

  // Railway URLs (e.g. betacdmy-production.up.railway.app) are the main platform site.
  if (isRailwayDeploymentHost(normalizedHost)) {
    return normalizedHost;
  }

  const candidates = [envMainDomain, defaultMainDomain].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const normalized = normalizeMainDomain(candidate);
    if (host === normalized || host.endsWith(`.${normalized}`)) {
      return normalized;
    }
  }

  const inferred = deriveMainDomainFromHost(host);
  return normalizeMainDomain(envMainDomain || inferred || defaultMainDomain);
};
