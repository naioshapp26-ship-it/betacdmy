import { useEffect, useMemo, useState } from 'react';
import { TenantBrandingConfig, TenantPricingConfig } from '../types';
import {
  defaultMainDomain,
  normalizeHost,
  normalizeMainDomain,
  resolveMainDomainForHost
} from '../utils/resolveMainDomain';

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

export function useTenant() {
  // Compute subdomain first so loading can be initialised correctly below
  const { subdomain, mainDomain, isMainSite } = useMemo(() => {
    const host = typeof window !== 'undefined' ? normalizeHost(window.location.hostname) : '';
    const envMainDomainRaw = (import.meta as any)?.env?.VITE_MAIN_DOMAIN;
    const envMainDomain = envMainDomainRaw ? normalizeMainDomain(envMainDomainRaw) : null;
    const isLocalHost = host === 'localhost' || host === '127.0.0.1';
    const main = host
      ? resolveMainDomainForHost(host, envMainDomain)
      : normalizeMainDomain(envMainDomain || defaultMainDomain);

    if (!host) {
      return { subdomain: null, mainDomain: main, isMainSite: true };
    }

    if (isLocalHost) {
      const devTenant = (import.meta as any)?.env?.VITE_DEV_TENANT_SUBDOMAIN || null;
      return {
        subdomain: devTenant,
        mainDomain: main,
        isMainSite: !devTenant
      };
    }

    if (!host.endsWith(main)) {
      return { subdomain: null, mainDomain: main, isMainSite: true };
    }

    const withoutDomain = host.slice(0, -main.length).replace(/\.$/, '');
    if (!withoutDomain || withoutDomain === 'www') {
      return { subdomain: null, mainDomain: main, isMainSite: true };
    }

    return { subdomain: withoutDomain, mainDomain: main, isMainSite: false };
  }, []);

  const [config, setConfig] = useState<TenantConfig | null>(null);
  // Start loading=true immediately when there is a subdomain to avoid a flash
  // of the full platform before the tenant check completes.
  const [loading, setLoading] = useState(() => Boolean(subdomain));
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

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
          const res = await fetch('/api/tenant/config');
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
    config,
    loading,
    notFound,
    error
  };
}

export default useTenant;

