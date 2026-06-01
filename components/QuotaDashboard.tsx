import React from 'react';
import { Activity, Users, Book, HardDrive, Zap, TrendingUp, AlertCircle } from 'lucide-react';

type QuotaUsage = {
  plan: string;
  users: { current: number; limit: number; percentage: number };
  courses: { current: number; limit: number; percentage: number };
  storage: { current: number; limit: number; percentage: number };
};

type Props = {
  quota: QuotaUsage | null;
  loading: boolean;
  onRefresh: () => void;
  copy?: {
    title?: string;
    refreshButton?: string;
    planLabel?: string;
    usersLabel?: string;
    coursesLabel?: string;
    storageLabel?: string;
    apiRequestsLabel?: string;
    usageLabel?: string;
    limitLabel?: string;
    unlimitedLabel?: string;
    loadingLabel?: string;
    errorLabel?: string;
  };
};

const QuotaDashboard: React.FC<Props> = ({ quota, loading, onRefresh, copy = {} }) => {
  const {
    title = 'Quota Usage',
    refreshButton = 'Refresh',
    planLabel = 'Current Plan',
    usersLabel = 'Users',
    coursesLabel = 'Courses',
    storageLabel = 'Storage',
    apiRequestsLabel = 'API Requests/Hour',
    usageLabel = 'Usage',
    limitLabel = 'Limit',
    unlimitedLabel = 'Unlimited',
    loadingLabel = 'Loading quota information...',
    errorLabel = 'Unable to load quota data'
  } = copy;

  const getProgressColor = (percentage: number): string => {
    if (percentage >= 90) return 'bg-rose-500';
    if (percentage >= 75) return 'bg-amber-500';
    return 'bg-emerald-500';
  };

  const getPlanBadgeColor = (plan: string): string => {
    switch (plan?.toLowerCase()) {
      case 'enterprise':
        return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'pro':
        return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'basic':
        return 'bg-zinc-100 text-zinc-700 border-zinc-200';
      default:
        return 'bg-zinc-100 text-zinc-600 border-zinc-200';
    }
  };

  const formatLimit = (limit: number): string => {
    if (limit === -1 || limit === Infinity) return unlimitedLabel;
    return limit.toLocaleString();
  };

  const formatStorage = (gb: number): string => {
    return `${gb.toFixed(2)} GB`;
  };

  const getApiRequestLimit = (plan: string): number => {
    switch (plan?.toLowerCase()) {
      case 'enterprise':
        return 10000;
      case 'pro':
        return 2000;
      case 'basic':
        return 500;
      default:
        return 500;
    }
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

  if (!quota) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-6">
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3 text-zinc-500">
            <AlertCircle className="h-5 w-5" />
            <p className="text-sm">{errorLabel}</p>
          </div>
        </div>
      </div>
    );
  }

  const quotaItems = [
    {
      icon: Users,
      label: usersLabel,
      current: quota.users.current,
      limit: quota.users.limit,
      percentage: quota.users.percentage,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50'
    },
    {
      icon: Book,
      label: coursesLabel,
      current: quota.courses.current,
      limit: quota.courses.limit,
      percentage: quota.courses.percentage,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50'
    },
    {
      icon: HardDrive,
      label: storageLabel,
      current: quota.storage.current,
      limit: quota.storage.limit,
      percentage: quota.storage.percentage,
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-50',
      formatter: formatStorage
    }
  ];

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-red-500 to-red-600">
            <TrendingUp className="h-5 w-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-zinc-900">{title}</h3>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-zinc-500">{planLabel}:</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${getPlanBadgeColor(quota.plan)}`}>
                {quota.plan.toUpperCase()}
              </span>
            </div>
          </div>
        </div>
        <button
          onClick={onRefresh}
          className="px-3 py-1.5 rounded-lg border border-zinc-200 text-sm font-semibold hover:bg-zinc-50 transition-colors"
        >
          {refreshButton}
        </button>
      </div>

      {/* Quota Items */}
      <div className="space-y-4">
        {quotaItems.map((item, index) => {
          const Icon = item.icon;
          const isUnlimited = item.limit === -1 || item.limit === Infinity;
          
          return (
            <div key={index} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-lg ${item.bgColor}`}>
                    <Icon className={`h-4 w-4 ${item.color}`} />
                  </div>
                  <span className="text-sm font-semibold text-zinc-700">{item.label}</span>
                </div>
                <div className="text-sm">
                  <span className="font-semibold text-zinc-900">
                    {item.formatter ? item.formatter(item.current) : item.current.toLocaleString()}
                  </span>
                  <span className="text-zinc-500"> / </span>
                  <span className="text-zinc-600">
                    {isUnlimited ? unlimitedLabel : (item.formatter ? item.formatter(item.limit) : formatLimit(item.limit))}
                  </span>
                </div>
              </div>
              
              {!isUnlimited && (
                <>
                  <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${getProgressColor(item.percentage)}`}
                      style={{ width: `${Math.min(item.percentage, 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-zinc-500">
                      {item.percentage.toFixed(0)}% {usageLabel.toLowerCase()}
                    </span>
                    {item.percentage >= 90 && (
                      <span className="flex items-center gap-1 text-xs font-semibold text-rose-600">
                        <AlertCircle className="h-3 w-3" />
                        Approaching limit
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}

        {/* API Requests (static based on plan) */}
        <div className="pt-4 border-t border-zinc-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-amber-50">
                <Zap className="h-4 w-4 text-amber-600" />
              </div>
              <span className="text-sm font-semibold text-zinc-700">{apiRequestsLabel}</span>
            </div>
            <div className="text-sm">
              <span className="font-semibold text-zinc-900">
                {getApiRequestLimit(quota.plan).toLocaleString()}
              </span>
              <span className="text-zinc-500"> / hour</span>
            </div>
          </div>
          <p className="text-xs text-zinc-500 mt-2">
            Rate limit resets every hour
          </p>
        </div>
      </div>

      {/* Upgrade prompt for high usage */}
      {(quota.users.percentage >= 80 || quota.courses.percentage >= 80 || quota.storage.percentage >= 80) && quota.plan.toLowerCase() !== 'enterprise' && (
        <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200">
          <div className="flex items-start gap-3">
            <TrendingUp className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-900">Consider upgrading your plan</p>
              <p className="text-xs text-amber-700 mt-1">
                You're approaching your quota limits. Upgrade to get more resources and avoid service interruptions.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QuotaDashboard;
