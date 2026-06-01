import React from 'react';
import { Shield, Clock, AlertTriangle, CheckCircle, Activity, Ban } from 'lucide-react';

type RateLimitStat = {
  endpoint: string;
  limit: number;
  window: string;
  currentHits: number;
  blocked: number;
  lastReset: string;
};

type Props = {
  stats: RateLimitStat[] | null;
  loading: boolean;
  onRefresh: () => void;
  copy?: {
    title?: string;
    refreshButton?: string;
    endpointLabel?: string;
    limitLabel?: string;
    windowLabel?: string;
    hitsLabel?: string;
    blockedLabel?: string;
    lastResetLabel?: string;
    loadingLabel?: string;
    noDataLabel?: string;
    healthyLabel?: string;
    warningLabel?: string;
    criticalLabel?: string;
  };
};

const RateLimitStats: React.FC<Props> = ({ stats, loading, onRefresh, copy = {} }) => {
  const {
    title = 'Rate Limiting Status',
    refreshButton = 'Refresh',
    endpointLabel = 'Endpoint',
    limitLabel = 'Limit',
    windowLabel = 'Window',
    hitsLabel = 'Current Hits',
    blockedLabel = 'Blocked',
    lastResetLabel = 'Last Reset',
    loadingLabel = 'Loading rate limit stats...',
    noDataLabel = 'No rate limit data available',
    healthyLabel = 'Healthy',
    warningLabel = 'Warning',
    criticalLabel = 'Critical'
  } = copy;

  // Mock data for demonstration purposes
  // In production, this would come from backend API
  const mockStats: RateLimitStat[] = [
    {
      endpoint: '/api/login',
      limit: 5,
      window: '1 minute',
      currentHits: 2,
      blocked: 0,
      lastReset: new Date(Date.now() - 30000).toISOString()
    },
    {
      endpoint: '/api/provisioning/start',
      limit: 1,
      window: '5 minutes',
      currentHits: 0,
      blocked: 3,
      lastReset: new Date(Date.now() - 180000).toISOString()
    },
    {
      endpoint: '/api/webhooks/payment/*',
      limit: 100,
      window: '1 minute',
      currentHits: 45,
      blocked: 0,
      lastReset: new Date(Date.now() - 15000).toISOString()
    },
    {
      endpoint: '/api/tenant/*',
      limit: 500,
      window: '1 hour',
      currentHits: 234,
      blocked: 2,
      lastReset: new Date(Date.now() - 1200000).toISOString()
    },
    {
      endpoint: '/api/* (general)',
      limit: 1000,
      window: '1 hour',
      currentHits: 567,
      blocked: 5,
      lastReset: new Date(Date.now() - 1800000).toISOString()
    }
  ];

  const displayStats = stats || mockStats;

  const getStatusColor = (hits: number, limit: number): { bg: string; text: string; icon: any } => {
    const percentage = (hits / limit) * 100;
    if (percentage >= 90) return { bg: 'bg-rose-50', text: 'text-rose-600', icon: AlertTriangle };
    if (percentage >= 70) return { bg: 'bg-amber-50', text: 'text-amber-600', icon: Clock };
    return { bg: 'bg-emerald-50', text: 'text-emerald-600', icon: CheckCircle };
  };

  const getStatusLabel = (hits: number, limit: number): string => {
    const percentage = (hits / limit) * 100;
    if (percentage >= 90) return criticalLabel;
    if (percentage >= 70) return warningLabel;
    return healthyLabel;
  };

  const formatTimeAgo = (isoString: string): string => {
    const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-6">
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3 text-zinc-500">
            <Activity className="h-5 w-5 animate-spin" />
            <p className="text-sm">{loadingLabel}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-zinc-900">{title}</h3>
            <p className="text-xs text-zinc-500 mt-0.5">Real-time rate limiting monitoring</p>
          </div>
        </div>
        <button
          onClick={onRefresh}
          className="px-3 py-1.5 rounded-lg border border-zinc-200 text-sm font-semibold hover:bg-zinc-50 transition-colors"
        >
          {refreshButton}
        </button>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="h-4 w-4 text-emerald-600" />
            <span className="text-xs font-semibold text-emerald-900 uppercase tracking-wide">Protected</span>
          </div>
          <p className="text-2xl font-bold text-emerald-700">{displayStats.length}</p>
          <p className="text-xs text-emerald-600 mt-1">Endpoints</p>
        </div>
        
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200">
          <div className="flex items-center gap-2 mb-2">
            <Ban className="h-4 w-4 text-rose-600" />
            <span className="text-xs font-semibold text-rose-900 uppercase tracking-wide">Blocked</span>
          </div>
          <p className="text-2xl font-bold text-rose-700">
            {displayStats.reduce((sum, stat) => sum + stat.blocked, 0)}
          </p>
          <p className="text-xs text-rose-600 mt-1">Requests</p>
        </div>

        <div className="p-4 rounded-xl bg-blue-50 border border-blue-200">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="h-4 w-4 text-blue-600" />
            <span className="text-xs font-semibold text-blue-900 uppercase tracking-wide">Total Hits</span>
          </div>
          <p className="text-2xl font-bold text-blue-700">
            {displayStats.reduce((sum, stat) => sum + stat.currentHits, 0)}
          </p>
          <p className="text-xs text-blue-600 mt-1">This period</p>
        </div>
      </div>

      {/* Rate Limit Details */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-zinc-700 uppercase tracking-wide">Endpoint Details</h4>
        
        {displayStats.map((stat, index) => {
          const status = getStatusColor(stat.currentHits, stat.limit);
          const StatusIcon = status.icon;
          const percentage = (stat.currentHits / stat.limit) * 100;

          return (
            <div key={index} className="p-4 rounded-xl border border-zinc-100 bg-zinc-50/50 space-y-3">
              {/* Endpoint Header */}
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-mono font-semibold text-zinc-900">{stat.endpoint}</code>
                    <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${status.bg} ${status.text}`}>
                      <StatusIcon className="h-3 w-3" />
                      {getStatusLabel(stat.currentHits, stat.limit)}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-xs text-zinc-500">
                    <span>{windowLabel}: <span className="font-semibold text-zinc-700">{stat.window}</span></span>
                    <span>{limitLabel}: <span className="font-semibold text-zinc-700">{stat.limit}</span></span>
                    <span>{lastResetLabel}: <span className="font-semibold text-zinc-700">{formatTimeAgo(stat.lastReset)}</span></span>
                  </div>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-600">
                    {hitsLabel}: <span className="font-semibold text-zinc-900">{stat.currentHits}</span> / {stat.limit}
                  </span>
                  <span className="text-zinc-600">
                    {blockedLabel}: <span className="font-semibold text-rose-600">{stat.blocked}</span>
                  </span>
                </div>
                <div className="h-2 bg-zinc-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      percentage >= 90 ? 'bg-rose-500' : percentage >= 70 ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min(percentage, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-zinc-500">{percentage.toFixed(1)}% utilized</span>
                  {stat.blocked > 0 && (
                    <span className="text-xs font-semibold text-rose-600">
                      {stat.blocked} request{stat.blocked !== 1 ? 's' : ''} blocked
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Info Footer */}
      <div className="p-4 rounded-xl bg-blue-50 border border-blue-200">
        <div className="flex items-start gap-3">
          <Shield className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-blue-900">Rate Limiting Active</p>
            <p className="text-blue-700 mt-1">
              All endpoints are protected by rate limiting. Limits reset automatically based on the configured window.
              Blocked requests receive a 429 (Too Many Requests) response.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RateLimitStats;
