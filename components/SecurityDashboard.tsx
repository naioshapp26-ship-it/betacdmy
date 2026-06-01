import React, { useState, useEffect, useCallback } from 'react';
import QuotaDashboard from './QuotaDashboard';
import RateLimitStats from './RateLimitStats';
import { Shield, TrendingUp } from 'lucide-react';

type QuotaUsage = {
  plan: string;
  users: { current: number; limit: number; percentage: number };
  courses: { current: number; limit: number; percentage: number };
  storage: { current: number; limit: number; percentage: number };
};

type Props = {
  variant?: 'tenant-admin' | 'super-admin';
  tenantId?: string;
  copy?: {
    title?: string;
    subtitle?: string;
    quotaTab?: string;
    rateLimitTab?: string;
    overviewTab?: string;
  };
};

const SecurityDashboard: React.FC<Props> = ({ variant = 'tenant-admin', tenantId, copy = {} }) => {
  const {
    title = variant === 'super-admin' ? 'Platform Security Overview' : 'Security & Usage',
    subtitle = variant === 'super-admin' 
      ? 'Monitor rate limiting and quotas across all tenants'
      : 'Monitor your usage and rate limit status',
    quotaTab = 'Quota Usage',
    rateLimitTab = 'Rate Limits',
    overviewTab = 'Overview'
  } = copy;

  const [activeTab, setActiveTab] = useState<'overview' | 'quota' | 'ratelimit'>('overview');
  const [quotaData, setQuotaData] = useState<QuotaUsage | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [rateLimitLoading, setRateLimitLoading] = useState(false);

  const loadQuotaData = useCallback(async () => {
    if (variant === 'super-admin') {
      // Super admin would see aggregated data or select tenant
      return;
    }

    setQuotaLoading(true);
    try {
      const response = await fetch('/api/tenant/quota', {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('Quota data loaded:', data);
        setQuotaData(data);
      } else {
        const errorText = await response.text();
        console.error('Failed to load quota data:', response.status, errorText);
      }
    } catch (error) {
      console.error('Error loading quota data:', error);
    } finally {
      setQuotaLoading(false);
    }
  }, [variant]);

  const loadRateLimitData = useCallback(async () => {
    setRateLimitLoading(true);
    try {
      // This would call a new endpoint for rate limit stats
      // For now, the component uses mock data
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error('Error loading rate limit data:', error);
    } finally {
      setRateLimitLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQuotaData();
    loadRateLimitData();
  }, [loadQuotaData, loadRateLimitData]);

  const tabs = [
    { key: 'overview' as const, label: overviewTab },
    { key: 'quota' as const, label: quotaTab },
    { key: 'ratelimit' as const, label: rateLimitTab }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Shield className="h-5 w-5 text-red-600" />
            <span className="text-xs uppercase tracking-wide text-red-600 font-semibold">
              {variant === 'super-admin' ? 'Platform Security' : 'Account Security'}
            </span>
          </div>
          <h2 className="text-2xl font-bold text-zinc-900">{title}</h2>
          <p className="text-sm text-zinc-500 mt-1">{subtitle}</p>
        </div>

        {/* Tab Navigation */}
        <div className="inline-flex rounded-full border border-zinc-200 bg-white p-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-semibold rounded-full transition ${
                activeTab === tab.key
                  ? 'bg-red-900 text-white shadow'
                  : 'text-zinc-600 hover:text-red-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <QuotaDashboard
            quota={quotaData}
            loading={quotaLoading}
            onRefresh={loadQuotaData}
          />
          <RateLimitStats
            stats={null}
            loading={rateLimitLoading}
            onRefresh={loadRateLimitData}
          />
        </div>
      )}

      {activeTab === 'quota' && (
        <div className="max-w-3xl">
          <QuotaDashboard
            quota={quotaData}
            loading={quotaLoading}
            onRefresh={loadQuotaData}
          />
        </div>
      )}

      {activeTab === 'ratelimit' && (
        <div className="max-w-3xl">
          <RateLimitStats
            stats={null}
            loading={rateLimitLoading}
            onRefresh={loadRateLimitData}
          />
        </div>
      )}
    </div>
  );
};

export default SecurityDashboard;
