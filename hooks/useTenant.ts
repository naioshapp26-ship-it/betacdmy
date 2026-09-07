import { useEffect, useMemo, useState } from 'react';
import { TenantBrandingConfig, TenantPricingConfig } from '../types';
import {
  defaultMainDomain,
  normalizeHost,
  normalizeMainDomain,
  resolveMainDomainForHost
} from '../utils/resolveMainDomain';
import {
  TENANT_PATH_PREFIX,
  TENANT_SUBDOMAIN_COOKIE,
  TENANT_SUBDOMAIN_HEADER,
  extractTenantPathSubdomain,
  supportsHostSubdomainTenants
} from '../utils/platform-host.js';

type TenantConfig = {
  id?: string;
  name?: string;
  companyName?: string;
  branding?: TenantBrandingConfig;
  pricing?: TenantPricingConfig;
  limits?: {
    maxUsers?: number;
    maxCourses?: number;
    storageQuotaGb?: number;
  };
  appearanceUpdatedAt?: string;
  appearanceUpdatedBy?: string | null;
};

const normalizeTenantConfig = (value: any): TenantConfig => {
  const safeValue = value && typeof value === 'object' ? value : {};
  const normalizedName = [safeValue.companyName, safeValue.name]
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .find(Boolean);

  return {
    ...safeValue,
    name: normalizedName,
    companyName: normalizedName
  };
};

const setTenantCookie = (subdomain: string | null) => {
  if (typeof document === 'undefined') return;
  if (subdomain) {
    document.cookie = `${TENANT_SUBDOMAIN_COOKIE}=${encodeURIComponent(subdomain)}; path=/; SameSite=Lax`;
  } else {
    document.cookie = `${TENANT_SUBDOMAIN_COOKIE}=; path=/; Max-Age=0; SameSite=Lax`;
  }
};

export function useTenant() {
  // Compute subdomain first so loading can be initialised correctly below
  const { subdomain, mainDomain, isMainSite, tenantUrlMode } = useMemo(() => {
    const host = typeof window !== 'undefined' ? normalizeHost(window.location.hostname) : '';
    const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
    const envMainDomainRaw = (import.meta as any)?.env?.VITE_MAIN_DOMAIN;
    const envMainDomain = envMainDomainRaw ? normalizeMainDomain(envMainDomainRaw) : null;
    const isLocalHost = host === 'localhost' || host === '127.0.0.1';
    const main = host
      ? resolveMainDomainForHost(host, envMainDomain)
      : normalizeMainDomain(envMainDomain || defaultMainDomain);

    if (!host) {
      return { subdomain: null, mainDomain: main, isMainSite: true, tenantUrlMode: 'path' as const };
    }

    if (isLocalHost) {
      const pathTenant = extractTenantPathSubdomain(pathname);
      if (pathTenant) {
        return { subdomain: pathTenant, mainDomain: main, isMainSite: false, tenantUrlMode: 'path' as const };
      }
      const devTenant = (import.meta as any)?.env?.VITE_DEV_TENANT_SUBDOMAIN || null;
      return {
        subdomain: devTenant,
        mainDomain: main,
        isMainSite: !devTenant,
        tenantUrlMode: 'path' as const
      };
    }

    // Railway (and other hosts without wildcard TLS): path-based tenants.
    if (!supportsHostSubdomainTenants(host)) {
      const pathTenant = extractTenantPathSubdomain(pathname);
      return {
        subdomain: pathTenant,
        mainDomain: main,
        isMainSite: !pathTenant,
        tenantUrlMode: 'path' as const
      };
    }

    if (!host.endsWith(main)) {
      return { subdomain: null, mainDomain: main, isMainSite: true, tenantUrlMode: 'host' as const };
    }

    const withoutDomain = host.slice(0, -main.length).replace(/\.$/, '');
    if (!withoutDomain || withoutDomain === 'www') {
      // Apex host may still use /t/{sub} during migration.
      const pathTenant = extractTenantPathSubdomain(pathname);
      if (pathTenant) {
        return { subdomain: pathTenant, mainDomain: main, isMainSite: false, tenantUrlMode: 'path' as const };
      }
      return { subdomain: null, mainDomain: main, isMainSite: true, tenantUrlMode: 'host' as const };
    }

    return { subdomain: withoutDomain, mainDomain: main, isMainSite: false, tenantUrlMode: 'host' as const };
  }, []);

  const [config, setConfig] = useState<TenantConfig | null>(null);
  // Start loading=true immediately when there is a subdomain to avoid a flash
  // of the full platform before the tenant check completes.
  const [loading, setLoading] = useState(() => Boolean(subdomain));
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    setTenantCookie(subdomain);
  }, [subdomain]);

  useEffect(() => {
    if (!subdomain && !isMainSite) return;
    let abort = false;
    const load = async () => {
      if (subdomain) {
        setLoading(true);
        setError(null);
        setNotFound(false);
      }
      try {
        if (subdomain) {
          const res = await fetch('/api/tenant/config', {
            headers: { [TENANT_SUBDOMAIN_HEADER]: subdomain }
          });
          if (res.status === 404) {
            if (!abort) {
              setNotFound(true);
              setLoading(false);
            }
            return;
          }
          if (!res.ok) throw new Error('Failed to load tenant config');
          const data = await res.json();
          if (!abort) setConfig(normalizeTenantConfig(data));
          return;
        }

        const appearanceRes = await fetch('/api/tenant/appearance');
        if (!appearanceRes.ok) {
          throw new Error('Failed to load central appearance');
        }
        const appearance = await appearanceRes.json();
        if (!abort) {
          setConfig((current) => normalizeTenantConfig({
            ...(current || {}),
            branding: appearance?.branding,
            pricing: appearance?.pricing,
            appearanceUpdatedAt: appearance?.updatedAt,
            appearanceUpdatedBy: appearance?.updatedBy
          }));
        }
      } catch (err: any) {
        if (!abort) setError(err?.message || 'Unable to load tenant config');
      } finally {
        if (!abort && subdomain) setLoading(false);
      }
    };
    load();
    return () => {
      abort = true;
    };
  }, [subdomain, isMainSite, reloadToken]);

  useEffect(() => {
    if (typeof window === 'undefined' || (!subdomain && !isMainSite)) {
      return;
    }
    const handleAppearanceUpdate = () => {
      setReloadToken((current) => current + 1);
    };
    window.addEventListener('tenant-appearance-updated', handleAppearanceUpdate);
    return () => {
      window.removeEventListener('tenant-appearance-updated', handleAppearanceUpdate);
    };
  }, [subdomain, isMainSite]);

  return {
    subdomain,
    mainDomain,
    isMainSite,
    tenantUrlMode,
    tenantPathPrefix: subdomain && tenantUrlMode === 'path' ? `${TENANT_PATH_PREFIX}/${subdomain}` : '',
    config,
    loading,
    notFound,
    error
  };
}

export default useTenant;
