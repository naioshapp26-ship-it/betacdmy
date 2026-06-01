import { useCallback, useEffect, useState } from 'react';

export type PublicPaymentConfig = {
  stripeEnabled: boolean;
  stripePublicKey: string | null;
  stripePriceBasicMonthly: string | null;
  stripePriceBasicYearly: string | null;
  stripePriceProMonthly: string | null;
  stripePriceProYearly: string | null;
  stripePriceEnterpriseMonthly: string | null;
  stripePriceEnterpriseYearly: string | null;
  planBasicMonthlyAmount: number | null;
  planBasicMonthlyCurrency: string | null;
  planBasicYearlyAmount: number | null;
  planBasicYearlyCurrency: string | null;
  planProMonthlyAmount: number | null;
  planProMonthlyCurrency: string | null;
  planProYearlyAmount: number | null;
  planProYearlyCurrency: string | null;
  planEnterpriseMonthlyAmount: number | null;
  planEnterpriseMonthlyCurrency: string | null;
  planEnterpriseYearlyAmount: number | null;
  planEnterpriseYearlyCurrency: string | null;
  paypalEnabled: boolean;
  paypalClientId: string | null;
  visaEnabled: boolean;
  visaPublicKey: string | null;
};

export type PlanPricingMap = Partial<Record<'basic' | 'pro' | 'enterprise', {
  monthlyAmount: number;
  currency: string;
  formatted: string;
}>>;

type Options = {
  enabled?: boolean;
  endpoint?: string;
};

type ApiPayload = {
  success?: boolean;
  data?: PublicPaymentConfig;
};

export function usePublicPaymentConfig(options: Options = {}) {
  const { enabled = true, endpoint = '/saas/api/public/payment-config' } = options;
  const [data, setData] = useState<PublicPaymentConfig | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refresh = useCallback(() => {
    if (!enabled) {
      return;
    }
    setReloadToken((token) => token + 1);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const fetchConfig = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(endpoint, { signal: controller.signal });
        if (!response.ok) {
          throw new Error('Failed to load payment configuration');
        }
        const payload = (await response.json()) as ApiPayload | PublicPaymentConfig;
        if (cancelled) {
          return;
        }
        const resolved = (payload as ApiPayload)?.data ?? (payload as PublicPaymentConfig);
        setData(resolved ?? null);
      } catch (err: any) {
        if (cancelled || err?.name === 'AbortError') {
          return;
        }
        setError(err?.message || 'Failed to load payment configuration');
        setData(null);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchConfig();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, endpoint, reloadToken]);

  return { data, loading, error, refresh };
}

export default usePublicPaymentConfig;
